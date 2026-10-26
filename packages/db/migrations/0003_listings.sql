CREATE TABLE "extraction_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extraction_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"message_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request" jsonb NOT NULL,
	"raw_output" text,
	"parsed" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_runs_purpose_check" CHECK ("extraction_runs"."purpose" in ('classify', 'extract')),
	CONSTRAINT "extraction_runs_status_check" CHECK ("extraction_runs"."status" in ('ok', 'invalid', 'error', 'rate_limited', 'timeout'))
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "units_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"category" text,
	"developer_id" integer,
	"project_id" integer,
	"city_id" integer,
	"unit_type" text,
	"unit_code" text,
	"floor" text,
	"finishing_specs" text,
	"min_area" numeric(12, 2),
	"max_area" numeric(12, 2),
	"land_area" numeric(12, 2),
	"garden_area" numeric(12, 2),
	"outdoor_area" numeric(12, 2),
	"min_price" bigint,
	"max_price" bigint,
	"delivery_year" smallint,
	"maintenance" numeric(12, 2),
	"maintenance_currency" text,
	"cash_discount" numeric(12, 2),
	"cash_discount_currency" text,
	"cash_discount_type" text,
	"down_payment" numeric(12, 2),
	"installments_count" smallint,
	"bedrooms" smallint,
	"bathrooms" smallint,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"price_currency" text DEFAULT 'EGP' NOT NULL,
	"down_payment_amount" bigint,
	"installment_years" numeric(12, 2),
	"installment_frequency" text,
	"ready_to_move" boolean DEFAULT false NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"needs_review" boolean NOT NULL,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_message_id" bigint NOT NULL,
	"extraction_run_id" bigint,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_category_check" CHECK ("units"."category" in ('Residential', 'Commercial', 'Administrative', 'Medical')),
	CONSTRAINT "units_unit_type_check" CHECK ("units"."unit_type" in ('Apartment', 'Studio', 'Duplex', 'Penthouse', 'Townhouse', 'Twin House', 'Villa', 'Chalet', 'Office', 'Retail', 'Clinic')),
	CONSTRAINT "units_finishing_specs_check" CHECK ("units"."finishing_specs" in ('Core & Shell', 'Semi-finished', 'Fully finished', 'Furnished')),
	CONSTRAINT "units_maintenance_currency_check" CHECK ("units"."maintenance_currency" in ('EGP', 'USD', '%')),
	CONSTRAINT "units_cash_discount_currency_check" CHECK ("units"."cash_discount_currency" in ('EGP', 'USD')),
	CONSTRAINT "units_cash_discount_type_check" CHECK ("units"."cash_discount_type" in ('Percentage', 'Fixed amount')),
	CONSTRAINT "units_status_check" CHECK ("units"."status" in ('active', 'stale', 'sold', 'withdrawn')),
	CONSTRAINT "units_price_currency_check" CHECK ("units"."price_currency" in ('EGP', 'USD')),
	CONSTRAINT "units_installment_frequency_check" CHECK ("units"."installment_frequency" in ('monthly', 'quarterly', 'semi-annual', 'annual')),
	CONSTRAINT "units_down_payment_range" CHECK ("units"."down_payment" between 0 and 100),
	CONSTRAINT "units_price_order" CHECK ("units"."max_price" is null or "units"."min_price" is null or "units"."min_price" <= "units"."max_price")
);
--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_runs_message_idx" ON "extraction_runs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_created_at_idx" ON "extraction_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "units_source_message_idx" ON "units" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "units_project_idx" ON "units" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "units_city_type_idx" ON "units" USING btree ("city_id","unit_type");--> statement-breakpoint
CREATE INDEX "units_status_idx" ON "units" USING btree ("status");--> statement-breakpoint
CREATE INDEX "units_needs_review_idx" ON "units" USING btree ("needs_review") WHERE "units"."needs_review";