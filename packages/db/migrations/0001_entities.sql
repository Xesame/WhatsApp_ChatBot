CREATE TABLE "cities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_name_en_unique" UNIQUE("name_en")
);
--> statement-breakpoint
CREATE TABLE "developers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "developers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developers_name_en_unique" UNIQUE("name_en")
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entity_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alias" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"city_id" integer,
	"developer_id" integer,
	"project_id" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_aliases_exactly_one_entity" CHECK (num_nonnulls("entity_aliases"."city_id", "entity_aliases"."developer_id", "entity_aliases"."project_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"developer_id" integer NOT NULL,
	"city_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_developer_id_developers_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_aliases_city_alias_key" ON "entity_aliases" USING btree ("city_id","alias_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_aliases_developer_alias_key" ON "entity_aliases" USING btree ("developer_id","alias_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_aliases_project_alias_key" ON "entity_aliases" USING btree ("project_id","alias_normalized");--> statement-breakpoint
CREATE INDEX "entity_aliases_alias_trgm_idx" ON "entity_aliases" USING gin ("alias_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "projects_developer_name_en_key" ON "projects" USING btree ("developer_id","name_en");--> statement-breakpoint
CREATE INDEX "projects_city_id_idx" ON "projects" USING btree ("city_id");