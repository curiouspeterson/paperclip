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
