ALTER TABLE "entity_aliases" ADD COLUMN "review_unit_id" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "flagged_on_arrival" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE units SET flagged_on_arrival = true WHERE needs_review OR id IN (SELECT unit_id FROM review_corrections);
