import { z } from "zod";
import { AGENT_ADAPTER_TYPES, APPROVAL_TYPES, type ApprovalType } from "../constants.js";
import { createAgentSchema } from "./agent.js";

const genericApprovalPayloadSchema = z.record(z.unknown());
const nullableTrimmedStringSchema = z.string().trim().min(1).optional().nullable();

export const browserSessionHandoffApprovalPayloadSchema = z.object({
  service: z.string().trim().min(1),
  loginUrl: z.string().trim().url(),
  browserProfileName: nullableTrimmedStringSchema,
  browserProfilePath: nullableTrimmedStringSchema,
  completionNote: nullableTrimmedStringSchema,
  agentInstruction: nullableTrimmedStringSchema,
});

export const secretProvisioningRequiredApprovalPayloadSchema = z.object({
  service: nullableTrimmedStringSchema,
  secretNames: z.array(z.string().trim().min(1)).min(1),
  completionNote: nullableTrimmedStringSchema,
  agentInstruction: nullableTrimmedStringSchema,
});

export const hireAgentApprovalPayloadSchema = createAgentSchema.extend({
  agentId: z.string().uuid().optional().nullable(),
  requestedByAgentId: z.string().uuid().optional().nullable(),
  requestedConfigurationSnapshot: z
    .object({
      adapterType: z.enum(AGENT_ADAPTER_TYPES),
      adapterConfig: z.record(z.unknown()).optional().default({}),
      runtimeConfig: z.record(z.unknown()).optional().default({}),
      desiredSkills: z.array(z.string().min(1)).optional().default([]),
    })
    .optional()
    .nullable(),
});

export const approvalPayloadSchemaByType = {
  hire_agent: hireAgentApprovalPayloadSchema,
  approve_ceo_strategy: genericApprovalPayloadSchema,
  budget_override_required: genericApprovalPayloadSchema,
  browser_session_handoff: browserSessionHandoffApprovalPayloadSchema,
  secret_provisioning_required: secretProvisioningRequiredApprovalPayloadSchema,
} as const satisfies Record<ApprovalType, z.ZodTypeAny>;

type ApprovalPayloadSchemaByType = typeof approvalPayloadSchemaByType;
export type ApprovalPayloadByType<T extends ApprovalType> = z.infer<ApprovalPayloadSchemaByType[T]>;

export function parseApprovalPayload<T extends ApprovalType>(
  type: T,
  payload: unknown,
): ApprovalPayloadByType<T> {
  return approvalPayloadSchemaByType[type].parse(payload) as ApprovalPayloadByType<T>;
}

function appendPayloadValidationIssues(
  ctx: z.RefinementCtx,
  issues: z.ZodIssue[],
) {
  for (const issue of issues) {
    ctx.addIssue({
      ...issue,
      path: ["payload", ...issue.path],
    });
  }
}

export const createApprovalSchema = z
  .object({
    type: z.enum(APPROVAL_TYPES),
    requestedByAgentId: z.string().uuid().optional().nullable(),
    payload: z.unknown(),
    issueIds: z.array(z.string().uuid()).optional(),
  })
  .superRefine((value, ctx) => {
    const parsed = approvalPayloadSchemaByType[value.type].safeParse(value.payload);
    if (!parsed.success) {
      appendPayloadValidationIssues(ctx, parsed.error.issues);
    }
  })
  .transform((value) => ({
    ...value,
    payload: parseApprovalPayload(value.type, value.payload),
  }));

export type CreateApproval = z.infer<typeof createApprovalSchema>;

export const resolveApprovalSchema = z.object({
  decisionNote: z.string().optional().nullable(),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: z.string().optional().nullable(),
});

export type RequestApprovalRevision = z.infer<typeof requestApprovalRevisionSchema>;

export const resubmitApprovalSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});

export type ResubmitApproval = z.infer<typeof resubmitApprovalSchema>;

export const addApprovalCommentSchema = z.object({
  body: z.string().min(1),
});

export type AddApprovalComment = z.infer<typeof addApprovalCommentSchema>;
