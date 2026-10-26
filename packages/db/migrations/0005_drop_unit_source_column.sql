-- Units created before dedup (Phase 2) pointed at one source message.
-- Copy that link into unit_sources and their current terms into
-- unit_prices, so nothing is lost when the column goes.
INSERT INTO "unit_sources" ("unit_id", "message_id", "role")
SELECT "id", "source_message_id", 'listing' FROM "units" WHERE "source_message_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "unit_prices" (
  "unit_id", "min_price", "max_price", "price_currency", "down_payment", "down_payment_amount",
  "installments_count", "installment_years", "installment_frequency", "cash_discount",
  "cash_discount_type", "cash_discount_currency", "observed_at", "source_message_id"
)
SELECT "id", "min_price", "max_price", "price_currency", "down_payment", "down_payment_amount",
  "installments_count", "installment_years", "installment_frequency", "cash_discount",
  "cash_discount_type", "cash_discount_currency", "first_seen_at", "source_message_id"
FROM "units"
WHERE "source_message_id" IS NOT NULL AND ("min_price" IS NOT NULL OR "max_price" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "units" DROP CONSTRAINT "units_source_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "units" DROP COLUMN "source_message_id";
