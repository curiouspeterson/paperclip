import type {
  CreateMailchimpCampaign,
  CreateMailchimpCampaignResult,
  MailchimpMarketingOverview,
  SendMailchimpCampaignResult,
} from "@paperclipai/shared";
import { api } from "./client";

export const mailchimpApi = {
  overview: (companyId: string) =>
    api.get<MailchimpMarketingOverview>(`/companies/${companyId}/integrations/mailchimp/marketing`),
  createCampaign: (companyId: string, data: CreateMailchimpCampaign) =>
    api.post<CreateMailchimpCampaignResult>(
      `/companies/${companyId}/integrations/mailchimp/marketing/campaigns`,
      data,
    ),
  sendCampaign: (companyId: string, campaignId: string) =>
    api.post<SendMailchimpCampaignResult>(
      `/companies/${companyId}/integrations/mailchimp/marketing/campaigns/${campaignId}/send`,
      {},
    ),
};
