import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

export const podcastWorkflows = pgTable(
  "podcast_workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").references(() => projects.id),
    issueId: uuid("issue_id").references(() => issues.id),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id),
    type: text("type").notNull(),
    status: text("status").notNull().default("planned"),
    title: text("title").notNull(),
    description: text("description"),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull().default({}),
    stageStatus: jsonb("stage_status").$type<Record<string, unknown>>().notNull().default({}),
    scriptRefs: jsonb("script_refs").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyTypeIdx: index("podcast_workflows_company_type_idx").on(table.companyId, table.type),
    companyStatusIdx: index("podcast_workflows_company_status_idx").on(table.companyId, table.status),
    projectIdx: index("podcast_workflows_project_idx").on(table.projectId),
    issueIdx: index("podcast_workflows_issue_idx").on(table.issueId),
  }),
);
