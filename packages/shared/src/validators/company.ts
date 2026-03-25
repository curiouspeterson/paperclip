import { z } from "zod";
import { AGENT_ADAPTER_TYPES } from "../constants.js";

const logoAssetIdSchema = z.string().uuid().nullable().optional();
const brandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional();
const companyProfileTextSchema = z.string().trim().min(1).max(10_000).nullable().optional();
const companyVoiceSampleSchema = z.string().trim().min(1).max(10_000);
const voiceExamplesRightSchema = z.array(companyVoiceSampleSchema).max(10).optional();
const voiceExamplesWrongSchema = z.array(companyVoiceSampleSchema).max(3).optional();
const mailchimpTemplateIdSchema = z.string().trim().regex(/^\d+$/).nullable().optional();
const mailchimpListIdSchema = z.string().trim().min(1).nullable().optional();
const mailchimpFromNameSchema = z.string().trim().min(1).max(255).nullable().optional();
const mailchimpReplyToSchema = z.string().trim().email().nullable().optional();
const agentDefaultAdapterTypeSchema = z.enum(AGENT_ADAPTER_TYPES).nullable().optional();
const agentDefaultStringSchema = z.string().trim().min(1).max(255).nullable().optional();
const agentDefaultLongTextSchema = z.string().trim().min(1).max(20_000).nullable().optional();
const agentDefaultPositiveIntSchema = z.number().int().positive().nullable().optional();
const agentDefaultNonNegativeIntSchema = z.number().int().nonnegative().nullable().optional();
const agentDefaultBooleanSchema = z.boolean().nullable().optional();
const agentDefaultHermesMcpServersSchema = z.record(z.unknown()).nullable().optional();

export const createCompanySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
    requireBoardApprovalForNewAgents: z.boolean().optional(),
    brandColor: brandColorSchema,
    voiceDescription: companyProfileTextSchema,
    targetAudience: companyProfileTextSchema,
    defaultChannel: companyProfileTextSchema,
    defaultGoal: companyProfileTextSchema,
    voiceExamplesRight: voiceExamplesRightSchema,
    voiceExamplesWrong: voiceExamplesWrongSchema,
    mailchimpDefaultListId: mailchimpListIdSchema,
    mailchimpDefaultTemplateId: mailchimpTemplateIdSchema,
    mailchimpDefaultFromName: mailchimpFromNameSchema,
    mailchimpDefaultReplyTo: mailchimpReplyToSchema,
    agentDefaultAdapterType: agentDefaultAdapterTypeSchema,
    agentDefaultProvider: agentDefaultStringSchema,
    agentDefaultModel: agentDefaultStringSchema,
    agentDefaultHeartbeatIntervalSec: agentDefaultPositiveIntSchema,
    agentDefaultWakeOnDemand: agentDefaultBooleanSchema,
    agentDefaultCooldownSec: agentDefaultNonNegativeIntSchema,
    agentDefaultMaxConcurrentRuns: agentDefaultPositiveIntSchema,
    agentDefaultMaxTurnsPerRun: agentDefaultPositiveIntSchema,
    agentDefaultBrowserAutomationProvider: agentDefaultStringSchema,
    agentDefaultHermesManagedHome: agentDefaultBooleanSchema,
    agentDefaultHermesSeedCompanyProfileMemory: agentDefaultBooleanSchema,
    agentDefaultHermesToolsets: agentDefaultLongTextSchema,
    agentDefaultHermesAllowedMcpServers: agentDefaultLongTextSchema,
    agentDefaultHermesMcpServers: agentDefaultHermesMcpServersSchema,
    agentDefaultDangerouslySkipPermissions: agentDefaultBooleanSchema,
    agentDefaultDangerouslyBypassSandbox: agentDefaultBooleanSchema,
    logoAssetId: logoAssetIdSchema,
  })
  .strict();

export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const updateCompanyBrandingSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    brandColor: brandColorSchema,
    logoAssetId: logoAssetIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined
      || value.description !== undefined
      || value.brandColor !== undefined
      || value.logoAssetId !== undefined,
    "At least one branding field must be provided",
  );

export type UpdateCompanyBranding = z.infer<typeof updateCompanyBrandingSchema>;
