CREATE TABLE "unit_payment_plans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unit_payment_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"unit_id" bigint NOT NULL,
	"source_message_id" bigint,
	"source" text NOT NULL,
	"position" smallint NOT NULL,
	"label" text,
	"down_payment_percent" numeric(12, 2),
	"down_payment_amount" bigint,
	"installment_amount" bigint,
	"installment_frequency" text,
	"installments_count" smallint,
	"installment_years" numeric(12, 2),
	"plan_price" bigint,
	"cash" boolean DEFAULT false NOT NULL,
	"notes" text,
	"currency" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_payment_plans_source_check" CHECK ("unit_payment_plans"."source" in ('message', 'review')),
	CONSTRAINT "unit_payment_plans_currency_check" CHECK ("unit_payment_plans"."currency" in ('EGP', 'USD')),
	CONSTRAINT "unit_payment_plans_installment_frequency_check" CHECK ("unit_payment_plans"."installment_frequency" in ('monthly', 'quarterly', 'semi-annual', 'annual')),
	CONSTRAINT "unit_payment_plans_source_message" CHECK (("unit_payment_plans"."source" = 'message') = ("unit_payment_plans"."source_message_id" is not null)),
	CONSTRAINT "unit_payment_plans_down_payment_range" CHECK ("unit_payment_plans"."down_payment_percent" between 0 and 100),
	CONSTRAINT "unit_payment_plans_years_positive" CHECK ("unit_payment_plans"."installment_years" > 0),
	CONSTRAINT "unit_payment_plans_count_positive" CHECK ("unit_payment_plans"."installments_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "unit_payment_plans" ADD CONSTRAINT "unit_payment_plans_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_payment_plans" ADD CONSTRAINT "unit_payment_plans_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_payment_plans_unit_observed_idx" ON "unit_payment_plans" USING btree ("unit_id","observed_at");--> statement-breakpoint
CREATE INDEX "unit_payment_plans_message_idx" ON "unit_payment_plans" USING btree ("source_message_id");