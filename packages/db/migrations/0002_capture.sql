CREATE TABLE "media_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "media_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"message_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text,
	"file_name" text,
	"size_bytes" bigint,
	"sha256" text,
	"path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"media_ref" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_at" timestamp with time zone,
	CONSTRAINT "media_files_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "media_files_status_check" CHECK ("media_files"."status" in ('pending', 'downloaded', 'failed', 'skipped')),
	CONSTRAINT "media_files_kind_check" CHECK ("media_files"."kind" in ('image', 'video', 'audio', 'document'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"group_id" integer NOT NULL,
	"wa_message_id" text NOT NULL,
	"sender_hash" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"text" text,
	"quoted_wa_message_id" text,
	"edit_of_wa_message_id" text,
	"media_type" text DEFAULT 'none' NOT NULL,
	"is_forwarded" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_status_check" CHECK ("messages"."status" in ('pending', 'processing', 'processed', 'skipped', 'failed')),
	CONSTRAINT "messages_media_type_check" CHECK ("messages"."media_type" in ('none', 'image', 'video', 'audio', 'document'))
);
--> statement-breakpoint
CREATE TABLE "wa_auth" (
	"account" text NOT NULL,
	"category" text NOT NULL,
	"key_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_auth_account_category_key_id_pk" PRIMARY KEY("account","category","key_id")
);
--> statement-breakpoint
CREATE TABLE "wa_connections" (
	"account" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"qr" text,
	"pairing_code" text,
	"last_connected_at" timestamp with time zone,
	"last_disconnected_at" timestamp with time zone,
	"last_disconnect_reason" text,
	"last_message_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_connections_state_check" CHECK ("wa_connections"."state" in ('starting', 'awaiting_pairing', 'open', 'reconnecting', 'logged_out', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "wa_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wa_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"jid" text NOT NULL,
	"name" text,
	"watched" boolean DEFAULT false NOT NULL,
	"source_type" text,
	"is_member" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_groups_jid_unique" UNIQUE("jid"),
	CONSTRAINT "wa_groups_source_type_check" CHECK ("wa_groups"."source_type" in ('developer', 'broker'))
);
--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_wa_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."wa_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_files_sha256_idx" ON "media_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "media_files_status_idx" ON "media_files" USING btree ("status") WHERE "media_files"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "messages_group_wa_message_id_key" ON "messages" USING btree ("group_id","wa_message_id");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_group_sent_at_idx" ON "messages" USING btree ("group_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_sender_sent_at_idx" ON "messages" USING btree ("sender_hash","sent_at");