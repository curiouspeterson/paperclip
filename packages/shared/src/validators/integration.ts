import { z } from "zod";

export const validateMailchimpMarketingApiSchema = z.object({
  secretId: z.string().uuid(),
});

export type ValidateMailchimpMarketingApi = z.infer<typeof validateMailchimpMarketingApiSchema>;

export const createMailchimpCampaignSchema = z.object({
  listId: z.string().min(1),
  subjectLine: z.string().trim().min(1),
  title: z.string().trim().min(1),
  fromName: z.string().trim().min(1),
  replyTo: z.string().trim().email(),
  previewText: z.string().trim().max(150).optional().nullable(),
  html: z.string().min(1),
  plainText: z.string().optional().nullable(),
});

export type CreateMailchimpCampaign = z.infer<typeof createMailchimpCampaignSchema>;

export const sendMailchimpCampaignSchema = z.object({
  campaignId: z.string().min(1),
});

export type SendMailchimpCampaign = z.infer<typeof sendMailchimpCampaignSchema>;
