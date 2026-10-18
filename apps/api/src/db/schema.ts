import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================================================
// Enums
// ============================================================================

export const teamMembershipRoleEnum = pgEnum("team_membership_role", [
  "VIEWER",
  "MEMBER",
  "LEAD",
  "ADMIN",
]);

export const workItemTypeEnum = pgEnum("work_item_type", [
  "TASK",
  "INCIDENT",
  "REQUEST",
]);

export const workItemStatusEnum = pgEnum("work_item_status", [
  "OPEN",
  "IN_PROGRESS",
  "AWAITING_APPROVAL",
  "RESOLVED",
  "CLOSED",
]);

export const workItemPriorityEnum = pgEnum("work_item_priority", [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "CREATED",
  "UPDATED",
  "CLAIMED",
  "ASSIGNED",
  "STATUS_CHANGED",
  "COMMENT_ADDED",
  "SLA_WARNING",
  "SLA_BREACHED",
]);

export const outboxEventStatusEnum = pgEnum("outbox_event_status", [
  "PENDING",
  "PUBLISHED",
  "PROCESSED",
  "FAILED",
]);

// ============================================================================
// Tables
// ============================================================================

/**
 * A. users
 * Application authentication is managed by the backend; Supabase Auth is not used.
 * Case-insensitive email uniqueness is enforced via lower(email) unique index.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`),
    check("users_name_not_blank", sql`length(trim("name")) > 0`),
    check("users_email_not_blank", sql`length(trim("email")) > 0`),
  ]
);

/**
 * B. teams
 * Operational group containing work items and members.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("teams_name_not_blank", sql`length(trim("name")) > 0`),
    check("teams_slug_not_blank", sql`length(trim("slug")) > 0`),
  ]
);

/**
 * C. team_memberships
 * Composite PK on (user_id, team_id).
 * Restrictive foreign key deletion prevents accidental cascade deletes of users/teams.
 */
export const teamMemberships = pgTable(
  "team_memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    role: teamMembershipRoleEnum("role").default("MEMBER").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.teamId],
      name: "team_memberships_user_id_team_id_pk",
    }),
    index("team_memberships_team_id_idx").on(table.teamId),
    index("team_memberships_team_role_idx").on(table.teamId, table.role),
  ]
);

/**
 * D. work_items
 * Operational work items.
 *
 * Invariant Note: An assigned user must belong to the item's team.
 * Enforced as an application transaction invariant on creation / assignment update.
 * Assignee foreign key uses onDelete: "set null" so user removal retains the item,
 * while team and creator deletion are restricted.
 */
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    type: workItemTypeEnum("type").default("TASK").notNull(),
    status: workItemStatusEnum("status").default("OPEN").notNull(),
    priority: workItemPriorityEnum("priority").default("NORMAL").notNull(),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("work_items_version_check", sql`"version" >= 1`),
    check("work_items_title_not_blank", sql`length(trim("title")) > 0`),
    index("work_items_team_created_at_idx").on(
      table.teamId,
      table.createdAt.desc()
    ),
    index("work_items_team_status_created_at_idx").on(
      table.teamId,
      table.status,
      table.createdAt.desc()
    ),
    index("work_items_assignee_status_created_at_idx").on(
      table.assigneeId,
      table.status,
      table.createdAt.desc()
    ),
    index("work_items_team_priority_created_at_idx").on(
      table.teamId,
      table.priority,
      table.createdAt.desc()
    ),
  ]
);

/**
 * E. activity_events
 * Append-only audit trail of events.
 * actor_id is nullable and set to NULL if the actor account is deleted, preserving event history.
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: activityEventTypeEnum("event_type").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("activity_events_item_created_at_id_idx").on(
      table.itemId,
      table.createdAt.desc(),
      table.id.desc()
    ),
  ]
);

/**
 * F. comments
 * Discussion on work items.
 * Author deletion is restricted; item deletion cascades to its comments.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("comments_body_not_blank", sql`length(trim("body")) > 0`),
    index("comments_item_created_at_idx").on(
      table.itemId,
      table.createdAt.asc()
    ),
  ]
);

/**
 * G. notifications
 * Recipient notifications spawned from activity events.
 * Enforces (recipientId, activityEventId) uniqueness to prevent duplicate alerts.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityEventId: uuid("activity_event_id")
      .notNull()
      .references(() => activityEvents.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("notifications_recipient_activity_event_idx").on(
      table.recipientId,
      table.activityEventId
    ),
    index("notifications_recipient_created_at_idx").on(
      table.recipientId,
      table.createdAt.desc()
    ),
    index("notifications_recipient_unread_idx")
      .on(table.recipientId, table.createdAt.desc())
      .where(sql`"read_at" IS NULL`),
  ]
);

/**
 * H. outbox_events
 * Reliable transactional outbox pattern for asynchronous job / event relay.
 * Unique on activityEventId guarantees exactly-once initial outbox record per activity.
 * Status lifecycle: PENDING -> PUBLISHED (queued) -> PROCESSED (consumed) or FAILED (retries exhausted).
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    activityEventId: uuid("activity_event_id")
      .notNull()
      .references(() => activityEvents.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxEventStatusEnum("status").default("PENDING").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("outbox_events_activity_event_id_idx").on(
      table.activityEventId
    ),
    index("outbox_events_pending_created_at_idx")
      .on(table.createdAt.asc())
      .where(sql`"status" = 'PENDING'`),
    check("outbox_events_attempts_check", sql`"attempts" >= 0`),
  ]
);

/**
 * I. idempotency_records
 * Prevents duplicate mutation execution on retried requests.
 * Future API services compare SHA-256 requestHash and persist results transactionally.
 */
export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_records_actor_key_idx").on(
      table.actorId,
      table.key
    ),
    index("idempotency_records_expires_at_idx").on(table.expiresAt.asc()),
  ]
);

// ============================================================================
// Incident Command Center — Enums
// ============================================================================

export const incidentSeverityEnum = pgEnum("incident_severity", [
  "SEV1",
  "SEV2",
  "SEV3",
  "SEV4",
]);

export const incidentImpactEnum = pgEnum("incident_impact", [
  "TOTAL_OUTAGE",
  "MAJOR_DEGRADATION",
  "MINOR_DEGRADATION",
  "NO_IMPACT",
]);

export const incidentStatusEnum = pgEnum("incident_status", [
  "DECLARED",
  "INVESTIGATING",
  "IDENTIFIED",
  "MITIGATING",
  "MONITORING",
  "RESOLVED",
  "POSTMORTEM",
  "CLOSED",
]);

export const incidentResponderRoleEnum = pgEnum("incident_responder_role", [
  "COMMANDER",
  "COMMUNICATIONS",
  "OPERATIONS",
  "SUBJECT_MATTER_EXPERT",
  "OBSERVER",
]);

export const incidentTimelineEventTypeEnum = pgEnum(
  "incident_timeline_event_type",
  [
    "DECLARED",
    "SEVERITY_CHANGED",
    "IMPACT_CHANGED",
    "STATUS_CHANGED",
    "COMMANDER_CHANGED",
    "RESPONDER_ADDED",
    "RESPONDER_REMOVED",
    "NOTE_ADDED",
    "MITIGATION_STARTED",
    "MITIGATION_COMPLETED",
    "WORK_ITEM_LINKED",
    "WORK_ITEM_UNLINKED",
    "RESOLVED",
    "POSTMORTEM_STARTED",
    "CLOSED",
  ]
);

// ============================================================================
// SLA Risk Engine — Enums
// ============================================================================

export const slaRiskStateEnum = pgEnum("sla_risk_state", [
  "ON_TRACK",
  "AT_RISK",
  "BREACHED",
  "COMPLETED",
]);

// ============================================================================
// Incident Command Center — Tables
// ============================================================================

/**
 * J. incidents
 * Core incident entity. Each incident belongs to a team and has a lifecycle
 * from DECLARED through investigation and mitigation to CLOSED.
 *
 * The incident commander is always a team member (enforced at application layer).
 * Version column enables optimistic concurrency control consistent with work_items.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 300 }).notNull(),
    summary: text("summary"),
    severity: incidentSeverityEnum("severity").default("SEV3").notNull(),
    impact: incidentImpactEnum("impact")
      .default("NO_IMPACT")
      .notNull(),
    status: incidentStatusEnum("status").default("DECLARED").notNull(),
    commanderId: uuid("commander_id").references(() => users.id, {
      onDelete: "set null",
    }),
    declaredById: uuid("declared_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    declaredAt: timestamp("declared_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    mitigationNotes: text("mitigation_notes"),
    postmortemUrl: varchar("postmortem_url", { length: 2048 }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("incidents_version_check", sql`"version" >= 1`),
    check("incidents_title_not_blank", sql`length(trim("title")) > 0`),
    index("incidents_team_declared_at_idx").on(
      table.teamId,
      table.declaredAt.desc()
    ),
    index("incidents_team_status_idx").on(table.teamId, table.status),
    index("incidents_team_severity_idx").on(table.teamId, table.severity),
    index("incidents_commander_idx").on(table.commanderId),
  ]
);

/**
 * K. incident_responders
 * Join table tracking team members assigned as incident responders.
 * Composite PK on (incident_id, user_id). Each responder has a role
 * within the incident command structure.
 */
export const incidentResponders = pgTable(
  "incident_responders",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: incidentResponderRoleEnum("role").default("OPERATIONS").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.incidentId, table.userId],
      name: "incident_responders_pk",
    }),
    index("incident_responders_user_idx").on(table.userId),
  ]
);

/**
 * L. incident_timeline_events
 * Append-only timeline of events during an incident.
 * Provides a complete narrative for postmortem analysis.
 */
export const incidentTimelineEvents = pgTable(
  "incident_timeline_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: incidentTimelineEventTypeEnum("event_type").notNull(),
    message: text("message"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("incident_timeline_incident_created_at_idx").on(
      table.incidentId,
      table.createdAt.asc()
    ),
  ]
);

/**
 * M. incident_linked_items
 * Many-to-many relationship between incidents and work items.
 * Allows tracking which work items were created or associated with an incident.
 */
export const incidentLinkedItems = pgTable(
  "incident_linked_items",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    linkedById: uuid("linked_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({
      columns: [table.incidentId, table.workItemId],
      name: "incident_linked_items_pk",
    }),
    index("incident_linked_items_work_item_idx").on(table.workItemId),
  ]
);

// ============================================================================
// SLA Risk Engine — Tables
// ============================================================================

/**
 * K. sla_policies
 * Team-scoped SLA policy configuration defining response and resolution
 * targets based on optional work item type and priority matching.
 *
 * Specificity matching hierarchy:
 * 1. Exact type + exact priority
 * 2. Exact priority (type is null)
 * 3. Exact type (priority is null)
 * 4. Team default (both type and priority are null)
 */
export const slaPolicies = pgTable(
  "sla_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    workItemType: workItemTypeEnum("work_item_type"),
    priority: workItemPriorityEnum("priority"),
    responseTargetMinutes: integer("response_target_minutes").notNull(),
    resolutionTargetMinutes: integer("resolution_target_minutes").notNull(),
    warningThresholdPercent: integer("warning_threshold_percent")
      .default(75)
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("sla_policies_name_not_blank", sql`length(trim("name")) > 0`),
    check(
      "sla_policies_response_target_check",
      sql`"response_target_minutes" > 0`
    ),
    check(
      "sla_policies_resolution_target_check",
      sql`"resolution_target_minutes" >= "response_target_minutes"`
    ),
    check(
      "sla_policies_warning_threshold_check",
      sql`"warning_threshold_percent" >= 1 AND "warning_threshold_percent" <= 99`
    ),
    index("sla_policies_team_id_idx").on(table.teamId),
    index("sla_policies_team_active_idx").on(table.teamId, table.isActive),
    // 4-tier specificity collision prevention for active policies:
    // Tier 1: Exact type + exact priority
    uniqueIndex("sla_policies_tier1_active_idx")
      .on(table.teamId, table.workItemType, table.priority)
      .where(
        sql`"is_active" = true AND "work_item_type" IS NOT NULL AND "priority" IS NOT NULL`
      ),
    // Tier 2: Exact type + wildcard priority
    uniqueIndex("sla_policies_tier2_active_idx")
      .on(table.teamId, table.workItemType)
      .where(
        sql`"is_active" = true AND "priority" IS NULL AND "work_item_type" IS NOT NULL`
      ),
    // Tier 3: Wildcard type + exact priority
    uniqueIndex("sla_policies_tier3_active_idx")
      .on(table.teamId, table.priority)
      .where(
        sql`"is_active" = true AND "work_item_type" IS NULL AND "priority" IS NOT NULL`
      ),
    // Tier 4: Catch-all team default policy (both wildcard)
    uniqueIndex("sla_policies_tier4_active_idx")
      .on(table.teamId)
      .where(
        sql`"is_active" = true AND "work_item_type" IS NULL AND "priority" IS NULL`
      ),
  ]
);

/**
 * L. work_item_slas
 * 1:1 SLA tracking record for each tracked work item.
 * Snapshots target minutes, warning thresholds, and precomputes deadlines at assignment time
 * to guarantee that retrospective policy modifications do not rewrite agreed commitments.
 */
export const workItemSlas = pgTable(
  "work_item_slas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").references(() => slaPolicies.id, {
      onDelete: "set null",
    }),
    riskState: slaRiskStateEnum("risk_state").default("ON_TRACK").notNull(),
    responseTargetMinutes: integer("response_target_minutes").notNull(),
    resolutionTargetMinutes: integer("resolution_target_minutes").notNull(),
    warningThresholdPercent: integer("warning_threshold_percent").notNull(),
    responseDeadline: timestamp("response_deadline", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    resolutionDeadline: timestamp("resolution_deadline", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    firstRespondedAt: timestamp("first_responded_at", {
      withTimezone: true,
      mode: "date",
    }),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "date",
    }),
    breachedAt: timestamp("breached_at", {
      withTimezone: true,
      mode: "date",
    }),
    notifiedAtRiskAt: timestamp("notified_at_risk_at", {
      withTimezone: true,
      mode: "date",
    }),
    notifiedBreachedAt: timestamp("notified_breached_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("work_item_slas_work_item_id_idx").on(table.workItemId),
    index("work_item_slas_policy_id_idx").on(table.policyId),
    index("work_item_slas_risk_resolution_idx").on(
      table.riskState,
      table.resolutionDeadline
    ),
    index("work_item_slas_risk_response_idx").on(
      table.riskState,
      table.responseDeadline
    ),
    check(
      "work_item_slas_response_target_check",
      sql`"response_target_minutes" > 0`
    ),
    check(
      "work_item_slas_resolution_target_check",
      sql`"resolution_target_minutes" >= "response_target_minutes"`
    ),
    check(
      "work_item_slas_warning_threshold_check",
      sql`"warning_threshold_percent" >= 1 AND "warning_threshold_percent" <= 99`
    ),
  ]
);

// ============================================================================
// TypeScript Inferred Types
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type TeamMembership = typeof teamMemberships.$inferSelect;
export type NewTeamMembership = typeof teamMemberships.$inferInsert;

export type WorkItem = typeof workItems.$inferSelect;
export type NewWorkItem = typeof workItems.$inferInsert;

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyRecords.$inferInsert;

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;

export type IncidentResponder = typeof incidentResponders.$inferSelect;
export type NewIncidentResponder = typeof incidentResponders.$inferInsert;

export type IncidentTimelineEvent = typeof incidentTimelineEvents.$inferSelect;
export type NewIncidentTimelineEvent = typeof incidentTimelineEvents.$inferInsert;

export type IncidentLinkedItem = typeof incidentLinkedItems.$inferSelect;
export type NewIncidentLinkedItem = typeof incidentLinkedItems.$inferInsert;

export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type NewSlaPolicy = typeof slaPolicies.$inferInsert;

export type WorkItemSla = typeof workItemSlas.$inferSelect;
export type NewWorkItemSla = typeof workItemSlas.$inferInsert;
