CREATE TYPE "incident_impact" AS ENUM('TOTAL_OUTAGE', 'MAJOR_DEGRADATION', 'MINOR_DEGRADATION', 'NO_IMPACT');--> statement-breakpoint
CREATE TYPE "incident_responder_role" AS ENUM('COMMANDER', 'COMMUNICATIONS', 'OPERATIONS', 'SUBJECT_MATTER_EXPERT', 'OBSERVER');--> statement-breakpoint
CREATE TYPE "incident_severity" AS ENUM('SEV1', 'SEV2', 'SEV3', 'SEV4');--> statement-breakpoint
CREATE TYPE "incident_status" AS ENUM('DECLARED', 'INVESTIGATING', 'IDENTIFIED', 'MITIGATING', 'MONITORING', 'RESOLVED', 'POSTMORTEM', 'CLOSED');--> statement-breakpoint
CREATE TYPE "incident_timeline_event_type" AS ENUM('DECLARED', 'SEVERITY_CHANGED', 'IMPACT_CHANGED', 'STATUS_CHANGED', 'COMMANDER_CHANGED', 'RESPONDER_ADDED', 'RESPONDER_REMOVED', 'NOTE_ADDED', 'MITIGATION_STARTED', 'MITIGATION_COMPLETED', 'WORK_ITEM_LINKED', 'WORK_ITEM_UNLINKED', 'RESOLVED', 'POSTMORTEM_STARTED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "incident_linked_items" (
	"incident_id" uuid,
	"work_item_id" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by_id" uuid,
	CONSTRAINT "incident_linked_items_pk" PRIMARY KEY("incident_id","work_item_id")
);
--> statement-breakpoint
CREATE TABLE "incident_responders" (
	"incident_id" uuid,
	"user_id" uuid,
	"role" "incident_responder_role" DEFAULT 'OPERATIONS'::"incident_responder_role" NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_responders_pk" PRIMARY KEY("incident_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "incident_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"incident_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" "incident_timeline_event_type" NOT NULL,
	"message" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"summary" text,
	"severity" "incident_severity" DEFAULT 'SEV3'::"incident_severity" NOT NULL,
	"impact" "incident_impact" DEFAULT 'NO_IMPACT'::"incident_impact" NOT NULL,
	"status" "incident_status" DEFAULT 'DECLARED'::"incident_status" NOT NULL,
	"commander_id" uuid,
	"declared_by_id" uuid NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"mitigation_notes" text,
	"postmortem_url" varchar(2048),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_version_check" CHECK ("version" >= 1),
	CONSTRAINT "incidents_title_not_blank" CHECK (length(trim("title")) > 0)
);
--> statement-breakpoint
CREATE INDEX "incident_linked_items_work_item_idx" ON "incident_linked_items" ("work_item_id");--> statement-breakpoint
CREATE INDEX "incident_responders_user_idx" ON "incident_responders" ("user_id");--> statement-breakpoint
CREATE INDEX "incident_timeline_incident_created_at_idx" ON "incident_timeline_events" ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incidents_team_declared_at_idx" ON "incidents" ("team_id","declared_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_team_status_idx" ON "incidents" ("team_id","status");--> statement-breakpoint
CREATE INDEX "incidents_team_severity_idx" ON "incidents" ("team_id","severity");--> statement-breakpoint
CREATE INDEX "incidents_commander_idx" ON "incidents" ("commander_id");--> statement-breakpoint
ALTER TABLE "incident_linked_items" ADD CONSTRAINT "incident_linked_items_incident_id_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_linked_items" ADD CONSTRAINT "incident_linked_items_work_item_id_work_items_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_linked_items" ADD CONSTRAINT "incident_linked_items_linked_by_id_users_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "incident_responders" ADD CONSTRAINT "incident_responders_incident_id_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_responders" ADD CONSTRAINT "incident_responders_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_timeline_events" ADD CONSTRAINT "incident_timeline_events_incident_id_incidents_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_timeline_events" ADD CONSTRAINT "incident_timeline_events_actor_id_users_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_commander_id_users_id_fkey" FOREIGN KEY ("commander_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_declared_by_id_users_id_fkey" FOREIGN KEY ("declared_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;