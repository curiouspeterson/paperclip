import type {
  PluginDetailTabProps,
  PluginPageProps,
  PluginSettingsPageProps,
  PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";

const panelStyle = {
  display: "grid",
  gap: "0.75rem",
  padding: "1rem",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: "0.75rem",
  background: "rgba(255, 255, 255, 0.88)",
} as const;

const metaGridStyle = {
  display: "grid",
  gap: "0.5rem",
} as const;

function ScaffoldPanel(props: {
  title: string;
  summary: string;
  meta: Array<{ label: string; value: string }>;
}) {
  return (
    <section style={panelStyle}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{props.title}</h2>
        <p style={{ margin: "0.5rem 0 0", color: "rgba(15, 23, 42, 0.72)" }}>{props.summary}</p>
      </div>
      <div style={metaGridStyle}>
        {props.meta.map((entry) => (
          <div key={entry.label}>
            <strong>{entry.label}:</strong> {entry.value}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PodcastControlPlanePage({ context }: PluginPageProps) {
  return (
    <ScaffoldPanel
      title="Podcast Control Plane"
      summary="Phase 1 reserves the product surfaces for workflow configuration, run visibility, and curated project actions."
      meta={[
        { label: "Company", value: context.companyId ?? "unknown" },
        { label: "Project", value: context.projectId ?? "none selected" },
        { label: "Surface", value: "Standalone page" },
      ]}
    />
  );
}

export function PodcastControlPlaneSettingsPage({ context }: PluginSettingsPageProps) {
  return (
    <ScaffoldPanel
      title="Podcast Control Plane Settings"
      summary="Future slices will move project bindings, secret references, and workflow defaults into plugin-managed configuration."
      meta={[
        { label: "Company", value: context.companyId ?? "unknown" },
        { label: "Surface", value: "Plugin settings page" },
      ]}
    />
  );
}

export function PodcastControlPlaneDashboardWidget({ context }: PluginWidgetProps) {
  return (
    <ScaffoldPanel
      title="Podcast Control Plane"
      summary="This widget placeholder will become the run queue, health, and action entry point for podcast operations."
      meta={[
        { label: "Company", value: context.companyId ?? "unknown" },
        { label: "Surface", value: "Dashboard widget" },
      ]}
    />
  );
}

export function PodcastProjectDetailTab({ context }: PluginDetailTabProps) {
  return (
    <ScaffoldPanel
      title="Podcast Project"
      summary="Project-level workflow controls will attach here once bindings, curated actions, and run history are implemented."
      meta={[
        { label: "Project", value: context.entityId ?? "unknown" },
        { label: "Company", value: context.companyId ?? "unknown" },
        { label: "Surface", value: "Project detail tab" },
      ]}
    />
  );
}
