CREATE TABLE "podcast_workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "project_id" uuid REFERENCES "projects"("id"),
  "issue_id" uuid REFERENCES "issues"("id"),
  "owner_agent_id" uuid REFERENCES "agents"("id"),
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'planned',
  "title" text NOT NULL,
  "description" text,
  "manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "stage_status" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "script_refs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "podcast_workflows_company_type_idx" ON "podcast_workflows" ("company_id", "type");
CREATE INDEX "podcast_workflows_company_status_idx" ON "podcast_workflows" ("company_id", "status");
CREATE INDEX "podcast_workflows_project_idx" ON "podcast_workflows" ("project_id");
CREATE INDEX "podcast_workflows_issue_idx" ON "podcast_workflows" ("issue_id");
