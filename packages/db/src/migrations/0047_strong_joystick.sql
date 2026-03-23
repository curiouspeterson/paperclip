CREATE TABLE "podcast_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid,
	"owner_agent_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"script_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "general" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "delegation_key" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "blocker_details" jsonb;--> statement-breakpoint
ALTER TABLE "podcast_workflows" ADD CONSTRAINT "podcast_workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_workflows" ADD CONSTRAINT "podcast_workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_workflows" ADD CONSTRAINT "podcast_workflows_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_workflows" ADD CONSTRAINT "podcast_workflows_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "podcast_workflows_company_type_idx" ON "podcast_workflows" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "podcast_workflows_company_status_idx" ON "podcast_workflows" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "podcast_workflows_project_idx" ON "podcast_workflows" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "podcast_workflows_issue_idx" ON "podcast_workflows" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_open_delegation_key_uq" ON "issues" USING btree ("company_id","parent_id","delegation_key") WHERE "issues"."parent_id" is not null
          and "issues"."delegation_key" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked');