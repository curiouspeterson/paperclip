ALTER TABLE "companies" ADD COLUMN "agent_default_adapter_type" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_provider" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_model" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_heartbeat_interval_sec" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_wake_on_demand" boolean;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_cooldown_sec" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_max_concurrent_runs" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_max_turns_per_run" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_browser_automation_provider" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_dangerously_skip_permissions" boolean;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_dangerously_bypass_sandbox" boolean;