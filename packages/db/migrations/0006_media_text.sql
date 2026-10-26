ALTER TABLE "extraction_runs" DROP CONSTRAINT "extraction_runs_purpose_check";--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "derived_text" text;--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "derived_method" text;--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "derived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_files" ADD COLUMN "derived_error" text;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD COLUMN "media_file_id" bigint;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_media_file_id_media_files_id_fk" FOREIGN KEY ("media_file_id") REFERENCES "public"."media_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_derived_method_check" CHECK ("media_files"."derived_method" in ('vision', 'pdf', 'spreadsheet', 'skipped', 'failed'));--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_purpose_check" CHECK ("extraction_runs"."purpose" in ('classify', 'extract', 'transcribe'));