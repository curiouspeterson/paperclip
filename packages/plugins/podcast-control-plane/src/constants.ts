export const PLUGIN_ID = "paperclip.podcast-control-plane";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "podcast";

export const SLOT_IDS = {
  page: "podcast-control-plane-page",
  settingsPage: "podcast-control-plane-settings-page",
  dashboardWidget: "podcast-control-plane-dashboard-widget",
  projectTab: "podcast-control-plane-project-tab",
} as const;

export const EXPORT_NAMES = {
  page: "PodcastControlPlanePage",
  settingsPage: "PodcastControlPlaneSettingsPage",
  dashboardWidget: "PodcastControlPlaneDashboardWidget",
  projectTab: "PodcastProjectDetailTab",
} as const;

export const DATA_KEYS = {
  workflowTemplates: "workflow-templates",
  workflowList: "workflow-list",
  workflowDetail: "workflow-detail",
} as const;

export const ACTION_KEYS = {
  upsertWorkflow: "upsert-workflow",
  deleteWorkflow: "delete-workflow",
} as const;

export const STATE_KEYS = {
  workflowIndex: "workflow-index",
} as const;

export const STATE_NAMESPACES = {
  workflowIndex: "podcast-control-plane",
  workflowRecord: "podcast-control-plane.workflow",
} as const;
