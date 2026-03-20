// Canonical re-export of adapter environment contract types.
// The structural definitions live in @paperclipai/adapter-utils.
// @paperclipai/shared re-exports them here so API consumers get one import
// surface, without owning a second structural copy.
export type {
  AdapterEnvironmentCheckLevel,
  AdapterEnvironmentTestStatus,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
