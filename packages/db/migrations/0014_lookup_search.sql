ALTER TABLE "name_lookups" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "name_lookups" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "name_lookups" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "name_lookups" ADD CONSTRAINT "name_lookups_method_check" CHECK ("name_lookups"."method" in ('memory', 'search'));--> statement-breakpoint
ALTER TABLE "name_lookups" ADD CONSTRAINT "name_lookups_provider_check" CHECK ("name_lookups"."provider" in ('gemini', 'groq'));--> statement-breakpoint
-- Answers saved before lookups searched the web came from Gemini's memory.
UPDATE "name_lookups" SET "method" = 'memory' WHERE "method" IS NULL;