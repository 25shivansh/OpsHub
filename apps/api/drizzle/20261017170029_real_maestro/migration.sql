CREATE TYPE "sla_risk_state" AS ENUM('ON_TRACK', 'AT_RISK', 'BREACHED', 'COMPLETED');--> statement-breakpoint
ALTER TYPE "activity_event_type" ADD VALUE 'SLA_WARNING';--> statement-breakpoint
ALTER TYPE "activity_event_type" ADD VALUE 'SLA_BREACHED';--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"work_item_type" "work_item_type",
	"priority" "work_item_priority",
	"response_target_minutes" integer NOT NULL,
	"resolution_target_minutes" integer NOT NULL,
	"warning_threshold_percent" integer DEFAULT 75 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_policies_name_not_blank" CHECK (length(trim("name")) > 0),
	CONSTRAINT "sla_policies_response_target_check" CHECK ("response_target_minutes" > 0),
	CONSTRAINT "sla_policies_resolution_target_check" CHECK ("resolution_target_minutes" >= "response_target_minutes"),
	CONSTRAINT "sla_policies_warning_threshold_check" CHECK ("warning_threshold_percent" >= 1 AND "warning_threshold_percent" <= 99)
);
--> statement-breakpoint
CREATE TABLE "work_item_slas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"work_item_id" uuid NOT NULL,
	"policy_id" uuid,
	"risk_state" "sla_risk_state" DEFAULT 'ON_TRACK'::"sla_risk_state" NOT NULL,
	"response_target_minutes" integer NOT NULL,
	"resolution_target_minutes" integer NOT NULL,
	"warning_threshold_percent" integer NOT NULL,
	"response_deadline" timestamp with time zone NOT NULL,
	"resolution_deadline" timestamp with time zone NOT NULL,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"notified_at_risk_at" timestamp with time zone,
	"notified_breached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_slas_response_target_check" CHECK ("response_target_minutes" > 0),
	CONSTRAINT "work_item_slas_resolution_target_check" CHECK ("resolution_target_minutes" >= "response_target_minutes"),
	CONSTRAINT "work_item_slas_warning_threshold_check" CHECK ("warning_threshold_percent" >= 1 AND "warning_threshold_percent" <= 99)
);
--> statement-breakpoint
CREATE INDEX "sla_policies_team_id_idx" ON "sla_policies" ("team_id");--> statement-breakpoint
CREATE INDEX "sla_policies_team_active_idx" ON "sla_policies" ("team_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policies_tier1_active_idx" ON "sla_policies" ("team_id","work_item_type","priority") WHERE "is_active" = true AND "work_item_type" IS NOT NULL AND "priority" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policies_tier2_active_idx" ON "sla_policies" ("team_id","work_item_type") WHERE "is_active" = true AND "priority" IS NULL AND "work_item_type" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policies_tier3_active_idx" ON "sla_policies" ("team_id","priority") WHERE "is_active" = true AND "work_item_type" IS NULL AND "priority" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policies_tier4_active_idx" ON "sla_policies" ("team_id") WHERE "is_active" = true AND "work_item_type" IS NULL AND "priority" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_slas_work_item_id_idx" ON "work_item_slas" ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_slas_policy_id_idx" ON "work_item_slas" ("policy_id");--> statement-breakpoint
CREATE INDEX "work_item_slas_risk_resolution_idx" ON "work_item_slas" ("risk_state","resolution_deadline");--> statement-breakpoint
CREATE INDEX "work_item_slas_risk_response_idx" ON "work_item_slas" ("risk_state","response_deadline");--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_item_slas" ADD CONSTRAINT "work_item_slas_work_item_id_work_items_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_item_slas" ADD CONSTRAINT "work_item_slas_policy_id_sla_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "sla_policies"("id") ON DELETE SET NULL;