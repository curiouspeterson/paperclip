ALTER TABLE "companies" ADD COLUMN "voice_description" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "target_audience" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "default_channel" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "default_goal" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "voice_examples_right" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "voice_examples_wrong" jsonb DEFAULT '[]'::jsonb NOT NULL;