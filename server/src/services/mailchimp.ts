import type { Db } from "@paperclipai/db";
import type {
  CreateMailchimpCampaign,
  CreateMailchimpCampaignResult,
  MailchimpAudienceSummary,
  MailchimpCampaignSummary,
  MailchimpMarketingOverview,
  SendMailchimpCampaignResult,
} from "@paperclipai/shared";
import { badRequest, HttpError, unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";

type MailchimpApiKeyResolution =
  | {
    source: "company_secret";
    datacenter: string;
    secretName: string;
    value: string;
  }
  | {
    source: "process_env";
    datacenter: string;
    secretName: "MAILCHIMP_API_KEY";
    value: string;
  };

type MailchimpAccountResponse = {
  account_name?: string | null;
  username?: string | null;
  email?: string | null;
  role?: string | null;
  pricing_plan_type?: string | null;
};

type MailchimpPingResponse = {
  health_status?: string | null;
};

type MailchimpAudienceResponse = {
  id?: string | null;
  name?: string | null;
  permission_reminder?: string | null;
  campaign_defaults?: {
    from_name?: string | null;
    from_email?: string | null;
  } | null;
  stats?: {
    member_count?: number | null;
  } | null;
};

type MailchimpCampaignResponse = {
  id?: string | null;
  status?: string | null;
  emails_sent?: number | null;
  send_time?: string | null;
  settings?: {
    title?: string | null;
    subject_line?: string | null;
    preview_text?: string | null;
    from_name?: string | null;
    reply_to?: string | null;
  } | null;
  recipients?: {
    list_id?: string | null;
  } | null;
};

function getDatacenterFromKey(key: string) {
  const parts = key.trim().split("-");
  const datacenter = parts.at(-1)?.trim();
  if (!datacenter || parts.length < 2) {
    throw badRequest("MAILCHIMP_API_KEY must include a datacenter suffix like us19");
  }
  return datacenter;
}

function mapAudience(audience: MailchimpAudienceResponse): MailchimpAudienceSummary {
  return {
    id: audience.id ?? "",
    name: audience.name ?? "",
    memberCount: audience.stats?.member_count ?? 0,
    permissionReminder: audience.permission_reminder ?? null,
    fromName: audience.campaign_defaults?.from_name ?? null,
    fromEmail: audience.campaign_defaults?.from_email ?? null,
  };
}

function mapCampaign(campaign: MailchimpCampaignResponse): MailchimpCampaignSummary {
  return {
    id: campaign.id ?? "",
    title: campaign.settings?.title ?? "",
    status: campaign.status ?? "unknown",
    emailsSent: campaign.emails_sent ?? 0,
    sendTime: campaign.send_time ?? null,
    subjectLine: campaign.settings?.subject_line ?? null,
    previewText: campaign.settings?.preview_text ?? null,
    fromName: campaign.settings?.from_name ?? null,
    replyTo: campaign.settings?.reply_to ?? null,
    listId: campaign.recipients?.list_id ?? null,
  };
}

export function mailchimpService(db: Db) {
  const secrets = secretService(db);

  async function resolveApiKey(companyId: string): Promise<MailchimpApiKeyResolution> {
    const fromSecret = await secrets.resolveSecretValueByName(companyId, "MAILCHIMP_API_KEY");
    if (fromSecret) {
      return {
        source: "company_secret",
        datacenter: getDatacenterFromKey(fromSecret.value),
        secretName: fromSecret.secretName,
        value: fromSecret.value,
      };
    }

    const fromEnv = process.env.MAILCHIMP_API_KEY?.trim();
    if (fromEnv) {
      return {
        source: "process_env",
        datacenter: getDatacenterFromKey(fromEnv),
        secretName: "MAILCHIMP_API_KEY",
        value: fromEnv,
      };
    }

    throw unprocessable(
      "Missing Mailchimp API key. Create a company secret named MAILCHIMP_API_KEY or set MAILCHIMP_API_KEY in the server environment.",
    );
  }

  async function request<T>(
    apiKey: MailchimpApiKeyResolution,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    headers.set("Authorization", `Basic ${Buffer.from(`paperclip:${apiKey.value}`).toString("base64")}`);
    headers.set("Accept", "application/json");
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`https://${apiKey.datacenter}.api.mailchimp.com/3.0${path}`, {
      ...init,
      headers,
    });

    const body = await response.text();
    const parsed = body ? JSON.parse(body) as Record<string, unknown> : null;
    if (!response.ok) {
      throw new HttpError(
        response.status,
        typeof parsed?.detail === "string" ? parsed.detail : `Mailchimp request failed: ${response.status}`,
        parsed,
      );
    }
    return parsed as T;
  }

  return {
    getOverview: async (companyId: string): Promise<MailchimpMarketingOverview> => {
      const apiKey = await resolveApiKey(companyId);
      const [ping, account, lists, campaigns] = await Promise.all([
        request<MailchimpPingResponse>(apiKey, "/ping"),
        request<MailchimpAccountResponse>(apiKey, "/"),
        request<{ total_items?: number; lists?: MailchimpAudienceResponse[] }>(
          apiKey,
          "/lists?count=25&fields=total_items,lists.id,lists.name,lists.permission_reminder,lists.campaign_defaults.from_name,lists.campaign_defaults.from_email,lists.stats.member_count",
        ),
        request<{ total_items?: number; campaigns?: MailchimpCampaignResponse[] }>(
          apiKey,
          "/campaigns?count=25&fields=total_items,campaigns.id,campaigns.status,campaigns.emails_sent,campaigns.send_time,campaigns.settings.title,campaigns.settings.subject_line,campaigns.settings.preview_text,campaigns.settings.from_name,campaigns.settings.reply_to,campaigns.recipients.list_id",
        ),
      ]);

      return {
        ok: true,
        source: apiKey.source,
        datacenter: apiKey.datacenter,
        secretName: apiKey.secretName,
        accountName: account.account_name ?? null,
        username: account.username ?? null,
        accountEmail: account.email ?? null,
        role: account.role ?? null,
        pricingPlanType: account.pricing_plan_type ?? null,
        healthStatus: ping.health_status ?? null,
        totalAudiences: lists.total_items ?? 0,
        totalCampaigns: campaigns.total_items ?? 0,
        audiences: (lists.lists ?? []).map(mapAudience),
        campaigns: (campaigns.campaigns ?? []).map(mapCampaign),
      };
    },

    createCampaign: async (
      companyId: string,
      input: CreateMailchimpCampaign,
    ): Promise<CreateMailchimpCampaignResult> => {
      const apiKey = await resolveApiKey(companyId);
      const created = await request<MailchimpCampaignResponse>(apiKey, "/campaigns", {
        method: "POST",
        body: JSON.stringify({
          type: "regular",
          recipients: {
            list_id: input.listId,
          },
          settings: {
            subject_line: input.subjectLine,
            title: input.title,
            from_name: input.fromName,
            reply_to: input.replyTo,
            preview_text: input.previewText ?? "",
          },
        }),
      });

      if (!created.id) {
        throw badRequest("Mailchimp did not return a campaign id");
      }

      await request<Record<string, unknown>>(apiKey, `/campaigns/${created.id}/content`, {
        method: "PUT",
        body: JSON.stringify({
          html: input.html,
          plain_text: input.plainText ?? "",
        }),
      });

      const details = await request<MailchimpCampaignResponse>(
        apiKey,
        `/campaigns/${created.id}?fields=id,status,emails_sent,send_time,settings.title,settings.subject_line,settings.preview_text,settings.from_name,settings.reply_to,recipients.list_id`,
      );

      return {
        ok: true,
        campaign: mapCampaign(details),
      };
    },

    sendCampaign: async (
      companyId: string,
      campaignId: string,
    ): Promise<SendMailchimpCampaignResult> => {
      const apiKey = await resolveApiKey(companyId);
      await request<Record<string, unknown>>(apiKey, `/campaigns/${campaignId}/actions/send`, {
        method: "POST",
      });
      return {
        ok: true,
        campaignId,
        status: "sent",
      };
    },
  };
}
