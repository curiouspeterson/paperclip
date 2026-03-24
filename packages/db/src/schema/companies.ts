import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    issuePrefix: text("issue_prefix").notNull().default("PAP"),
    issueCounter: integer("issue_counter").notNull().default(0),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    requireBoardApprovalForNewAgents: boolean("require_board_approval_for_new_agents")
      .notNull()
      .default(true),
    brandColor: text("brand_color"),
    voiceDescription: text("voice_description"),
    targetAudience: text("target_audience"),
    defaultChannel: text("default_channel"),
    defaultGoal: text("default_goal"),
    voiceExamplesRight: jsonb("voice_examples_right").$type<string[]>().notNull().default([]),
    voiceExamplesWrong: jsonb("voice_examples_wrong").$type<string[]>().notNull().default([]),
    mailchimpDefaultListId: text("mailchimp_default_list_id"),
    mailchimpDefaultTemplateId: text("mailchimp_default_template_id"),
    mailchimpDefaultFromName: text("mailchimp_default_from_name"),
    mailchimpDefaultReplyTo: text("mailchimp_default_reply_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issuePrefixUniqueIdx: uniqueIndex("companies_issue_prefix_idx").on(table.issuePrefix),
  }),
);
