CREATE TABLE "name_lookups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "name_lookups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"developer" text,
	"city" text,
	"known" boolean NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "name_lookups_name_normalized_key" ON "name_lookups" USING btree ("name_normalized");