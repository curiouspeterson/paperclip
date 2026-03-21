import { ExternalLink, Globe, KeyRound, Lightbulb, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import type {
  BrowserSessionHandoffApprovalPayload,
  SecretProvisioningRequiredApprovalPayload,
} from "@paperclipai/shared";
import { formatCents } from "../lib/utils";

export const typeLabel: Record<string, string> = {
  hire_agent: "Hire Agent",
  approve_ceo_strategy: "CEO Strategy",
  budget_override_required: "Budget Override",
  browser_session_handoff: "Browser Session Handoff",
  secret_provisioning_required: "Secret Provisioning",
};

/** Build a contextual label for an approval, e.g. "Hire Agent: Designer" */
export function approvalLabel(type: string, payload?: Record<string, unknown> | null): string {
  const base = typeLabel[type] ?? type;
  if (type === "hire_agent" && payload?.name) {
    return `${base}: ${String(payload.name)}`;
  }
  if (type === "browser_session_handoff" && payload?.service) {
    return `${base}: ${String(payload.service)}`;
  }
  if (type === "secret_provisioning_required" && Array.isArray(payload?.secretNames)) {
    return `${base}: ${payload.secretNames.join(", ")}`;
  }
  return base;
}

export const typeIcon: Record<string, typeof UserPlus> = {
  hire_agent: UserPlus,
  approve_ceo_strategy: Lightbulb,
  budget_override_required: ShieldAlert,
  browser_session_handoff: Globe,
  secret_provisioning_required: KeyRound,
};

export const defaultTypeIcon = ShieldCheck;

function PayloadField({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">{label}</span>
      <span>{String(value)}</span>
    </div>
  );
}

function SkillList({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Skills</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HireAgentPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Name</span>
        <span className="font-medium">{String(payload.name ?? "—")}</span>
      </div>
      <PayloadField label="Role" value={payload.role} />
      <PayloadField label="Title" value={payload.title} />
      <PayloadField label="Icon" value={payload.icon} />
      {!!payload.capabilities && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Capabilities</span>
          <span className="text-muted-foreground">{String(payload.capabilities)}</span>
        </div>
      )}
      {!!payload.adapterType && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Adapter</span>
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            {String(payload.adapterType)}
          </span>
        </div>
      )}
      <SkillList values={payload.desiredSkills} />
    </div>
  );
}

export function CeoStrategyPayload({ payload }: { payload: Record<string, unknown> }) {
  const plan = payload.plan ?? payload.description ?? payload.strategy ?? payload.text;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Title" value={payload.title} />
      {!!plan && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {String(plan)}
        </div>
      )}
      {!plan && (
        <pre className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-48">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function BudgetOverridePayload({ payload }: { payload: Record<string, unknown> }) {
  const budgetAmount = typeof payload.budgetAmount === "number" ? payload.budgetAmount : null;
  const observedAmount = typeof payload.observedAmount === "number" ? payload.observedAmount : null;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Scope" value={payload.scopeName ?? payload.scopeType} />
      <PayloadField label="Window" value={payload.windowKind} />
      <PayloadField label="Metric" value={payload.metric} />
      {(budgetAmount !== null || observedAmount !== null) ? (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Limit {budgetAmount !== null ? formatCents(budgetAmount) : "—"} · Observed {observedAmount !== null ? formatCents(observedAmount) : "—"}
        </div>
      ) : null}
      {!!payload.guidance && (
        <p className="text-muted-foreground">{String(payload.guidance)}</p>
      )}
    </div>
  );
}

export function BrowserSessionHandoffPayload({ payload }: { payload: BrowserSessionHandoffApprovalPayload }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Service</span>
        <span className="font-medium">{String(payload.service || "—")}</span>
      </div>
      <PayloadField label="Profile" value={payload.browserProfileName} />
      <PayloadField label="Profile path" value={payload.browserProfilePath} />
      {!!payload.agentInstruction && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">After login</span>
          <span className="text-muted-foreground">{String(payload.agentInstruction)}</span>
        </div>
      )}
      {!!payload.completionNote && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {String(payload.completionNote)}
        </div>
      )}
      {!!payload.loginUrl && (
        <a
          href={String(payload.loginUrl)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-border bg-accent/30 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          Open login page
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export function SecretProvisioningRequiredPayload({ payload }: { payload: SecretProvisioningRequiredApprovalPayload }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Service" value={payload.service} />
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Secrets</span>
        <div className="flex flex-wrap gap-1">
          {payload.secretNames.map((secretName) => (
            <span key={secretName} className="rounded-md border border-border bg-accent/30 px-2 py-0.5 text-xs font-mono">
              {secretName}
            </span>
          ))}
        </div>
      </div>
      {!!payload.agentInstruction && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">After secret</span>
          <span className="text-muted-foreground">{String(payload.agentInstruction)}</span>
        </div>
      )}
      {!!payload.completionNote && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {String(payload.completionNote)}
        </div>
      )}
    </div>
  );
}

export function ApprovalPayloadRenderer({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  if (type === "hire_agent") return <HireAgentPayload payload={payload} />;
  if (type === "budget_override_required") return <BudgetOverridePayload payload={payload} />;
  if (type === "browser_session_handoff") {
    return <BrowserSessionHandoffPayload payload={payload as unknown as BrowserSessionHandoffApprovalPayload} />;
  }
  if (type === "secret_provisioning_required") {
    return <SecretProvisioningRequiredPayload payload={payload as unknown as SecretProvisioningRequiredApprovalPayload} />;
  }
  return <CeoStrategyPayload payload={payload} />;
}
