CREATE TABLE "unit_prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unit_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"unit_id" bigint NOT NULL,
	"min_price" bigint,
	"max_price" bigint,
	"price_currency" text NOT NULL,
	"down_payment" numeric(12, 2),
	"down_payment_amount" bigint,
	"installments_count" smallint,
	"installment_years" numeric(12, 2),
	"installment_frequency" text,
	"cash_discount" numeric(12, 2),
	"cash_discount_type" text,
	"cash_discount_currency" text,
	"observed_at" timestamp with time zone NOT NULL,
	"source_message_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_prices_price_currency_check" CHECK ("unit_prices"."price_currency" in ('EGP', 'USD'))
);
--> statement-breakpoint
CREATE TABLE "unit_sources" (
	"unit_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_sources_unit_id_message_id_pk" PRIMARY KEY("unit_id","message_id"),
	CONSTRAINT "unit_sources_role_check" CHECK ("unit_sources"."role" in ('listing', 'price_update', 'sold'))
);
--> statement-breakpoint
DROP INDEX "units_source_message_idx";--> statement-breakpoint
DROP INDEX "units_project_idx";--> statement-breakpoint
ALTER TABLE "units" ALTER COLUMN "source_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "sold_by_message_id" bigint;--> statement-breakpoint
ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sources" ADD CONSTRAINT "unit_sources_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sources" ADD CONSTRAINT "unit_sources_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_prices_unit_observed_idx" ON "unit_prices" USING btree ("unit_id","observed_at");--> statement-breakpoint
CREATE INDEX "unit_prices_message_idx" ON "unit_prices" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "unit_sources_message_idx" ON "unit_sources" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_sold_by_message_id_messages_id_fk" FOREIGN KEY ("sold_by_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_project_type_status_idx" ON "units" USING btree ("project_id","unit_type","status");