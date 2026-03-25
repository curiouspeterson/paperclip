ALTER TABLE "companies" ADD COLUMN "agent_default_hermes_toolsets" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_hermes_allowed_mcp_servers" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "agent_default_hermes_mcp_servers" jsonb;