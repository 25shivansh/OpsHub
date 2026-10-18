CREATE TYPE "activity_event_type" AS ENUM('CREATED', 'UPDATED', 'CLAIMED', 'ASSIGNED', 'STATUS_CHANGED', 'COMMENT_ADDED');--> statement-breakpoint
CREATE TYPE "outbox_event_status" AS ENUM('PENDING', 'PUBLISHED', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "team_membership_role" AS ENUM('VIEWER', 'MEMBER', 'LEAD', 'ADMIN');--> statement-breakpoint
CREATE TYPE "work_item_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "work_item_status" AS ENUM('OPEN', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "work_item_type" AS ENUM('TASK', 'INCIDENT', 'REQUEST');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" "activity_event_type" NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_not_blank" CHECK (length(trim("body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipient_id" uuid NOT NULL,
	"activity_event_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"activity_event_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_event_status" DEFAULT 'PENDING'::"outbox_event_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"user_id" uuid,
	"team_id" uuid,
	"role" "team_membership_role" DEFAULT 'MEMBER'::"team_membership_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_not_blank" CHECK (length(trim("name")) > 0),
	CONSTRAINT "teams_slug_not_blank" CHECK (length(trim("slug")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(120) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_name_not_blank" CHECK (length(trim("name")) > 0),
	CONSTRAINT "users_email_not_blank" CHECK (length(trim("email")) > 0)
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"type" "work_item_type" DEFAULT 'TASK'::"work_item_type" NOT NULL,
	"status" "work_item_status" DEFAULT 'OPEN'::"work_item_status" NOT NULL,
	"priority" "work_item_priority" DEFAULT 'NORMAL'::"work_item_priority" NOT NULL,
	"created_by_id" uuid NOT NULL,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_version_check" CHECK ("version" >= 1),
	CONSTRAINT "work_items_title_not_blank" CHECK (length(trim("title")) > 0)
);
--> statement-breakpoint
CREATE INDEX "activity_events_item_created_at_id_idx" ON "activity_events" ("item_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "comments_item_created_at_idx" ON "comments" ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_actor_key_idx" ON "idempotency_records" ("actor_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_activity_event_idx" ON "notifications" ("recipient_id","activity_event_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_at_idx" ON "notifications" ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" ("recipient_id","created_at" DESC NULLS LAST) WHERE "read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_activity_event_id_idx" ON "outbox_events" ("activity_event_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_created_at_idx" ON "outbox_events" ("created_at") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships" ("team_id");--> statement-breakpoint
CREATE INDEX "team_memberships_team_role_idx" ON "team_memberships" ("team_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));--> statement-breakpoint
CREATE INDEX "work_items_team_created_at_idx" ON "work_items" ("team_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_items_team_status_created_at_idx" ON "work_items" ("team_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_items_assignee_status_created_at_idx" ON "work_items" ("assignee_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_items_team_priority_created_at_idx" ON "work_items" ("team_id","priority","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_item_id_work_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_item_id_work_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_activity_event_id_activity_events_id_fkey" FOREIGN KEY ("activity_event_id") REFERENCES "activity_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_activity_event_id_activity_events_id_fkey" FOREIGN KEY ("activity_event_id") REFERENCES "activity_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_id_users_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL;