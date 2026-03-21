export interface MailchimpAudienceSummary {
  id: string;
  name: string;
  memberCount: number;
  permissionReminder: string | null;
  fromName: string | null;
  fromEmail: string | null;
}

export interface MailchimpMarketingValidationResult {
  ok: true;
  datacenter: string;
  secretId: string;
  secretName: string;
  healthStatus: string | null;
  accountName: string | null;
  loginId: string | null;
  totalAudiences: number;
  audiences: MailchimpAudienceSummary[];
}

export interface MailchimpCampaignSummary {
  id: string;
  title: string;
  status: string;
  emailsSent: number;
  sendTime: string | null;
  subjectLine: string | null;
  previewText: string | null;
  fromName: string | null;
  replyTo: string | null;
  listId: string | null;
}

export interface MailchimpMarketingOverview {
  ok: true;
  source: "company_secret" | "process_env";
  datacenter: string;
  secretName: string;
  accountName: string | null;
  username: string | null;
  accountEmail: string | null;
  role: string | null;
  pricingPlanType: string | null;
  healthStatus: string | null;
  totalAudiences: number;
  totalCampaigns: number;
  audiences: MailchimpAudienceSummary[];
  campaigns: MailchimpCampaignSummary[];
}

export interface CreateMailchimpCampaignResult {
  ok: true;
  campaign: MailchimpCampaignSummary;
}

export interface SendMailchimpCampaignResult {
  ok: true;
  campaignId: string;
  status: "sent";
}
