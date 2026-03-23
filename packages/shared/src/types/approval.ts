import type { ApprovalStatus, ApprovalType } from "../constants.js";

export interface BrowserSessionHandoffApprovalPayload {
  service: string;
  loginUrl: string;
  browserProfileName?: string | null;
  browserProfilePath?: string | null;
  completionNote?: string | null;
  agentInstruction?: string | null;
}

export interface SecretProvisioningRequiredApprovalPayload {
  service?: string | null;
  secretNames: string[];
  completionNote?: string | null;
  agentInstruction?: string | null;
}

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalLinkedIssueSummary {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  issueNumber: number | null;
  identifier: string | null;
  requestDepth: number;
  billingCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}
