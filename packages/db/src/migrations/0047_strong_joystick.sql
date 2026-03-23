ALTER TABLE "issues" ADD COLUMN "delegation_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "issues_open_delegation_key_uq" ON "issues" USING btree ("company_id","parent_id","delegation_key") WHERE "issues"."parent_id" is not null
          and "issues"."delegation_key" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked');
