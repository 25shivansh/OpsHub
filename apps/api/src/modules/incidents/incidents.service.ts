import { and, desc, asc, eq, sql } from "drizzle-orm";
import {
  db,
  incidents,
  incidentResponders,
  incidentTimelineEvents,
  incidentLinkedItems,
  teamMemberships,
  users,
  workItems,
  Incident,
} from "../../db";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors";
import { AuthenticatedUser } from "../../middleware/auth";
import {
  getTeamMembership,
  hasMinimumRole,
  TeamMembershipRole,
} from "../../middleware/authorize";
import {
  DeclareIncidentInput,
  UpdateIncidentInput,
  TransitionIncidentInput,
  ListIncidentsQuery,
  AddResponderInput,
  RemoveResponderInput,
  AddTimelineNoteInput,
  LinkWorkItemInput,
  IncidentStatus,
} from "./incidents.schemas";

// =============================================================================
import { PaginatedResult } from "../work-items/work-items.service";

// =============================================================================
// Types
// =============================================================================

export interface IncidentTransitionRule {
  allowedRoles: TeamMembershipRole[];
}

export interface IncidentWithDetails extends Incident {
  responders: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    role: string;
    assignedAt: Date;
  }>;
  linkedItemCount: number;
}

// =============================================================================
// Workflow transition matrix
// =============================================================================

/**
 * Incident lifecycle transition rules.
 *
 * DECLARED → INVESTIGATING: Start investigation (MEMBER+)
 * INVESTIGATING → IDENTIFIED: Root cause identified (MEMBER+)
 * IDENTIFIED → MITIGATING: Mitigation underway (MEMBER+)
 * MITIGATING → MONITORING: Mitigation applied, monitoring for stability (MEMBER+)
 * MONITORING → RESOLVED: Confirmed stable (LEAD+)
 * RESOLVED → POSTMORTEM: Begin post-incident review (LEAD+)
 * POSTMORTEM → CLOSED: Postmortem complete, incident closed (LEAD+)
 *
 * Backward transitions available for re-investigation.
 */
export const INCIDENT_TRANSITIONS: Record<
  string,
  Record<string, IncidentTransitionRule>
> = {
  DECLARED: {
    INVESTIGATING: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] },
    CLOSED: { allowedRoles: ["LEAD", "ADMIN"] }, // False alarm
  },
  INVESTIGATING: {
    IDENTIFIED: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] },
    MITIGATING: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] }, // Skip to mitigation
    DECLARED: { allowedRoles: ["LEAD", "ADMIN"] }, // Revert
  },
  IDENTIFIED: {
    MITIGATING: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] },
    INVESTIGATING: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] }, // Re-investigate
  },
  MITIGATING: {
    MONITORING: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] },
    INVESTIGATING: { allowedRoles: ["LEAD", "ADMIN"] }, // Mitigation failed
  },
  MONITORING: {
    RESOLVED: { allowedRoles: ["LEAD", "ADMIN"] },
    MITIGATING: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] }, // Regression
  },
  RESOLVED: {
    POSTMORTEM: { allowedRoles: ["LEAD", "ADMIN"] },
    INVESTIGATING: { allowedRoles: ["LEAD", "ADMIN"] }, // Reopen
  },
  POSTMORTEM: {
    CLOSED: { allowedRoles: ["LEAD", "ADMIN"] },
  },
  CLOSED: {
    INVESTIGATING: { allowedRoles: ["ADMIN"] }, // Reopen closed incident
  },
};

function validateIncidentTransition(
  currentStatus: string,
  targetStatus: string,
  userRole: TeamMembershipRole
): void {
  if (currentStatus === targetStatus) return;

  const allowedForCurrent = INCIDENT_TRANSITIONS[currentStatus];
  if (!allowedForCurrent || !allowedForCurrent[targetStatus]) {
    throw new BadRequestError(
      `Invalid incident transition from ${currentStatus} to ${targetStatus}`
    );
  }

  const rule = allowedForCurrent[targetStatus];
  if (!rule.allowedRoles.includes(userRole)) {
    throw new ForbiddenError(
      `Insufficient permissions: transitioning incident from ${currentStatus} to ${targetStatus} requires ${rule.allowedRoles.join(" or ")} role`
    );
  }
}

// =============================================================================
// Service
// =============================================================================

export class IncidentsService {
  /**
   * Lists incidents for a team with pagination, filtering, and sorting.
   */
  async listIncidents(
    user: AuthenticatedUser,
    query: ListIncidentsQuery
  ): Promise<PaginatedResult<Incident>> {
    let targetTeamId = query.teamId;

    if (!targetTeamId) {
      const [firstMembership] = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(eq(teamMemberships.userId, user.id))
        .limit(1);

      if (!firstMembership) {
        return {
          data: [],
          pagination: {
            page: query.page,
            limit: query.limit,
            total: 0,
            totalPages: 1,
          },
        };
      }
      targetTeamId = firstMembership.teamId;
    }

    const membership = await getTeamMembership(user.id, targetTeamId);
    if (!membership) {
      throw new NotFoundError("Team not found or inaccessible");
    }

    const conditions = [eq(incidents.teamId, targetTeamId)];

    if (query.status) {
      conditions.push(eq(incidents.status, query.status));
    }
    if (query.severity) {
      conditions.push(eq(incidents.severity, query.severity));
    }

    const whereClause = and(...conditions);

    const sortColumn = incidents[query.sortBy as keyof typeof incidents.$inferSelect] ?? incidents.declaredAt;
    const sortOrder =
      query.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

    const offset = (query.page - 1) * query.limit;

    const [data, totalCountResult] = await Promise.all([
      db
        .select()
        .from(incidents)
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(query.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(incidents)
        .where(whereClause),
    ]);

    const total = totalCountResult[0]?.count ?? 0;

    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  /**
   * Get a single incident by ID with responder details and linked item count.
   */
  async getIncidentById(
    user: AuthenticatedUser,
    incidentId: string
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    // Fetch responders
    const responders = await db
      .select({
        userId: incidentResponders.userId,
        userName: users.name,
        userEmail: users.email,
        role: incidentResponders.role,
        assignedAt: incidentResponders.assignedAt,
      })
      .from(incidentResponders)
      .innerJoin(users, eq(users.id, incidentResponders.userId))
      .where(eq(incidentResponders.incidentId, incidentId));

    // Fetch linked item count
    const [linkedCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(incidentLinkedItems)
      .where(eq(incidentLinkedItems.incidentId, incidentId));

    return {
      ...incident,
      responders,
      linkedItemCount: linkedCount?.count ?? 0,
    };
  }

  /**
   * Declares a new incident within a team.
   * The declaring user is automatically added as a responder.
   * If a commander is specified, they are also added.
   */
  async declareIncident(
    user: AuthenticatedUser,
    input: DeclareIncidentInput
  ): Promise<IncidentWithDetails> {
    const membership = await getTeamMembership(user.id, input.teamId);
    if (!membership) {
      throw new NotFoundError("Team not found or inaccessible");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to declare incidents");
    }

    // Validate commander membership if specified
    let commanderId = input.commanderId ?? null;
    if (commanderId) {
      const commanderMembership = await getTeamMembership(
        commanderId,
        input.teamId
      );
      if (!commanderMembership) {
        throw new BadRequestError(
          "Incident commander must be a member of the team"
        );
      }
      if (!hasMinimumRole(commanderMembership.role, "MEMBER")) {
        throw new BadRequestError(
          "Incident commander must have at least MEMBER role"
        );
      }
    }

    // Default: declaring user is the commander
    if (!commanderId) {
      commanderId = user.id;
    }

    const result = await db.transaction(async (tx) => {
      const [newIncident] = await tx
        .insert(incidents)
        .values({
          teamId: input.teamId,
          title: input.title,
          summary: input.summary ?? null,
          severity: input.severity,
          impact: input.impact,
          status: "DECLARED",
          commanderId,
          declaredById: user.id,
          version: 1,
        })
        .returning();

      // Add declaring user as COMMANDER responder
      await tx.insert(incidentResponders).values({
        incidentId: newIncident.id,
        userId: commanderId!,
        role: "COMMANDER",
      });

      // If a different user declared (not the commander), add them as OPERATIONS
      if (commanderId !== user.id) {
        await tx.insert(incidentResponders).values({
          incidentId: newIncident.id,
          userId: user.id,
          role: "OPERATIONS",
        });
      }

      // Record DECLARED timeline event
      await tx.insert(incidentTimelineEvents).values({
        incidentId: newIncident.id,
        actorId: user.id,
        eventType: "DECLARED",
        message: `Incident declared: ${input.title}`,
        newValue: {
          severity: input.severity,
          impact: input.impact,
          commanderId,
        },
      });

      return newIncident;
    });

    return this.getIncidentById(user, result.id);
  }

  /**
   * Updates mutable fields of an incident with optimistic concurrency control.
   */
  async updateIncident(
    user: AuthenticatedUser,
    incidentId: string,
    input: UpdateIncidentInput
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to update incidents");
    }

    // Optimistic concurrency
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== incident.version
    ) {
      throw new ConflictError(
        "Version conflict: incident was modified concurrently",
        { currentVersion: incident.version, expectedVersion: input.expectedVersion }
      );
    }

    const targetVersion = input.expectedVersion ?? incident.version;

    const updateFields: Record<string, any> = {
      version: targetVersion + 1,
      updatedAt: new Date(),
    };

    const timelineEvents: Array<{
      eventType: string;
      message: string;
      oldValue: any;
      newValue: any;
    }> = [];

    if (input.title !== undefined) {
      updateFields.title = input.title;
    }
    if (input.summary !== undefined) {
      updateFields.summary = input.summary;
    }
    if (input.mitigationNotes !== undefined) {
      updateFields.mitigationNotes = input.mitigationNotes;
    }
    if (input.postmortemUrl !== undefined) {
      updateFields.postmortemUrl = input.postmortemUrl;
    }

    if (input.severity !== undefined && input.severity !== incident.severity) {
      updateFields.severity = input.severity;
      timelineEvents.push({
        eventType: "SEVERITY_CHANGED",
        message: `Severity changed from ${incident.severity} to ${input.severity}`,
        oldValue: { severity: incident.severity },
        newValue: { severity: input.severity },
      });
    }

    if (input.impact !== undefined && input.impact !== incident.impact) {
      updateFields.impact = input.impact;
      timelineEvents.push({
        eventType: "IMPACT_CHANGED",
        message: `Impact changed from ${incident.impact} to ${input.impact}`,
        oldValue: { impact: incident.impact },
        newValue: { impact: input.impact },
      });
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(incidents)
        .set(updateFields)
        .where(
          and(
            eq(incidents.id, incidentId),
            eq(incidents.version, targetVersion)
          )
        )
        .returning();

      if (!updated) {
        throw new ConflictError(
          "Version conflict: incident was modified concurrently by another process"
        );
      }

      // Record timeline events for tracked changes
      for (const evt of timelineEvents) {
        await tx.insert(incidentTimelineEvents).values({
          incidentId,
          actorId: user.id,
          eventType: evt.eventType as any,
          message: evt.message,
          oldValue: evt.oldValue,
          newValue: evt.newValue,
        });
      }

      return updated;
    });

    return this.getIncidentById(user, result.id);
  }

  /**
   * Transitions the incident lifecycle status with role-based governance.
   */
  async transitionIncident(
    user: AuthenticatedUser,
    incidentId: string,
    input: TransitionIncidentInput
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    validateIncidentTransition(incident.status, input.status, membership.role);

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== incident.version
    ) {
      throw new ConflictError(
        "Version conflict: incident was modified concurrently",
        { currentVersion: incident.version, expectedVersion: input.expectedVersion }
      );
    }

    const targetVersion = input.expectedVersion ?? incident.version;

    const updateFields: Record<string, any> = {
      status: input.status,
      version: targetVersion + 1,
      updatedAt: new Date(),
    };

    // Auto-set timestamp fields based on target status
    if (input.status === "RESOLVED" && !incident.resolvedAt) {
      updateFields.resolvedAt = new Date();
    }
    if (input.status === "CLOSED" && !incident.closedAt) {
      updateFields.closedAt = new Date();
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(incidents)
        .set(updateFields)
        .where(
          and(
            eq(incidents.id, incidentId),
            eq(incidents.version, targetVersion)
          )
        )
        .returning();

      if (!updated) {
        throw new ConflictError(
          "Version conflict: incident was modified concurrently by another process"
        );
      }

      await tx.insert(incidentTimelineEvents).values({
        incidentId,
        actorId: user.id,
        eventType: "STATUS_CHANGED",
        message:
          input.message ??
          `Status transitioned from ${incident.status} to ${input.status}`,
        oldValue: { status: incident.status },
        newValue: { status: input.status },
      });

      return updated;
    });

    return this.getIncidentById(user, result.id);
  }

  /**
   * Adds a responder to an incident.
   */
  async addResponder(
    user: AuthenticatedUser,
    incidentId: string,
    input: AddResponderInput
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers cannot manage responders");
    }

    // Verify target user is a team member
    const targetMembership = await getTeamMembership(
      input.userId,
      incident.teamId
    );
    if (!targetMembership) {
      throw new BadRequestError("User must be a member of the incident's team");
    }

    // Check for duplicate
    const [existing] = await db
      .select()
      .from(incidentResponders)
      .where(
        and(
          eq(incidentResponders.incidentId, incidentId),
          eq(incidentResponders.userId, input.userId)
        )
      )
      .limit(1);

    if (existing) {
      throw new ConflictError("User is already a responder on this incident");
    }

    await db.transaction(async (tx) => {
      await tx.insert(incidentResponders).values({
        incidentId,
        userId: input.userId,
        role: input.role,
      });

      // Fetch responder name for timeline
      const [responderUser] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      await tx.insert(incidentTimelineEvents).values({
        incidentId,
        actorId: user.id,
        eventType: "RESPONDER_ADDED",
        message: `${responderUser?.name ?? "User"} added as ${input.role}`,
        newValue: { userId: input.userId, role: input.role },
      });
    });

    return this.getIncidentById(user, incidentId);
  }

  /**
   * Removes a responder from an incident.
   */
  async removeResponder(
    user: AuthenticatedUser,
    incidentId: string,
    input: RemoveResponderInput
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers cannot manage responders");
    }

    // Cannot remove the commander
    if (input.userId === incident.commanderId) {
      throw new BadRequestError(
        "Cannot remove the incident commander. Reassign the commander role first."
      );
    }

    const [existing] = await db
      .select()
      .from(incidentResponders)
      .where(
        and(
          eq(incidentResponders.incidentId, incidentId),
          eq(incidentResponders.userId, input.userId)
        )
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Responder not found on this incident");
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(incidentResponders)
        .where(
          and(
            eq(incidentResponders.incidentId, incidentId),
            eq(incidentResponders.userId, input.userId)
          )
        );

      const [responderUser] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);

      await tx.insert(incidentTimelineEvents).values({
        incidentId,
        actorId: user.id,
        eventType: "RESPONDER_REMOVED",
        message: `${responderUser?.name ?? "User"} removed from responders`,
        oldValue: { userId: input.userId, role: existing.role },
      });
    });

    return this.getIncidentById(user, incidentId);
  }

  /**
   * Adds a note to the incident timeline.
   */
  async addTimelineNote(
    user: AuthenticatedUser,
    incidentId: string,
    input: AddTimelineNoteInput
  ): Promise<{ id: string; message: string; createdAt: Date }> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers cannot add timeline notes");
    }

    const [event] = await db
      .insert(incidentTimelineEvents)
      .values({
        incidentId,
        actorId: user.id,
        eventType: "NOTE_ADDED",
        message: input.message,
      })
      .returning();

    return {
      id: event.id,
      message: event.message ?? "",
      createdAt: event.createdAt,
    };
  }

  /**
   * Gets the full incident timeline.
   */
  async getTimeline(
    user: AuthenticatedUser,
    incidentId: string
  ): Promise<
    Array<{
      id: string;
      eventType: string;
      message: string | null;
      actorId: string | null;
      actorName: string | null;
      oldValue: any;
      newValue: any;
      createdAt: Date;
    }>
  > {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    const timeline = await db
      .select({
        id: incidentTimelineEvents.id,
        eventType: incidentTimelineEvents.eventType,
        message: incidentTimelineEvents.message,
        actorId: incidentTimelineEvents.actorId,
        actorName: users.name,
        oldValue: incidentTimelineEvents.oldValue,
        newValue: incidentTimelineEvents.newValue,
        createdAt: incidentTimelineEvents.createdAt,
      })
      .from(incidentTimelineEvents)
      .leftJoin(users, eq(users.id, incidentTimelineEvents.actorId))
      .where(eq(incidentTimelineEvents.incidentId, incidentId))
      .orderBy(asc(incidentTimelineEvents.createdAt));

    return timeline;
  }

  /**
   * Links a work item to an incident.
   */
  async linkWorkItem(
    user: AuthenticatedUser,
    incidentId: string,
    input: LinkWorkItemInput
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers cannot link work items");
    }

    // Verify work item exists and belongs to the same team
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, input.workItemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError("Work item not found");
    }

    if (item.teamId !== incident.teamId) {
      throw new BadRequestError(
        "Work item must belong to the same team as the incident"
      );
    }

    // Check for duplicate link
    const [existingLink] = await db
      .select()
      .from(incidentLinkedItems)
      .where(
        and(
          eq(incidentLinkedItems.incidentId, incidentId),
          eq(incidentLinkedItems.workItemId, input.workItemId)
        )
      )
      .limit(1);

    if (existingLink) {
      throw new ConflictError("Work item is already linked to this incident");
    }

    await db.transaction(async (tx) => {
      await tx.insert(incidentLinkedItems).values({
        incidentId,
        workItemId: input.workItemId,
        linkedById: user.id,
      });

      await tx.insert(incidentTimelineEvents).values({
        incidentId,
        actorId: user.id,
        eventType: "WORK_ITEM_LINKED",
        message: `Linked work item: ${item.title}`,
        newValue: { workItemId: input.workItemId, title: item.title },
      });
    });

    return this.getIncidentById(user, incidentId);
  }

  /**
   * Unlinks a work item from an incident.
   */
  async unlinkWorkItem(
    user: AuthenticatedUser,
    incidentId: string,
    workItemId: string
  ): Promise<IncidentWithDetails> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers cannot unlink work items");
    }

    const [existingLink] = await db
      .select()
      .from(incidentLinkedItems)
      .where(
        and(
          eq(incidentLinkedItems.incidentId, incidentId),
          eq(incidentLinkedItems.workItemId, workItemId)
        )
      )
      .limit(1);

    if (!existingLink) {
      throw new NotFoundError("Work item link not found");
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(incidentLinkedItems)
        .where(
          and(
            eq(incidentLinkedItems.incidentId, incidentId),
            eq(incidentLinkedItems.workItemId, workItemId)
          )
        );

      // Fetch the item title for the timeline message
      const [item] = await tx
        .select({ title: workItems.title })
        .from(workItems)
        .where(eq(workItems.id, workItemId))
        .limit(1);

      await tx.insert(incidentTimelineEvents).values({
        incidentId,
        actorId: user.id,
        eventType: "WORK_ITEM_UNLINKED",
        message: `Unlinked work item: ${item?.title ?? workItemId}`,
        oldValue: { workItemId },
      });
    });

    return this.getIncidentById(user, incidentId);
  }

  /**
   * Gets linked work items for an incident.
   */
  async getLinkedItems(
    user: AuthenticatedUser,
    incidentId: string
  ): Promise<
    Array<{
      workItemId: string;
      title: string;
      status: string;
      priority: string;
      type: string;
      assigneeId: string | null;
      linkedAt: Date;
      linkedByName: string | null;
    }>
  > {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incident) {
      throw new NotFoundError("Incident not found");
    }

    const membership = await getTeamMembership(user.id, incident.teamId);
    if (!membership) {
      throw new NotFoundError("Incident not found");
    }

    const items = await db
      .select({
        workItemId: incidentLinkedItems.workItemId,
        title: workItems.title,
        status: workItems.status,
        priority: workItems.priority,
        type: workItems.type,
        assigneeId: workItems.assigneeId,
        linkedAt: incidentLinkedItems.linkedAt,
        linkedByName: users.name,
      })
      .from(incidentLinkedItems)
      .innerJoin(workItems, eq(workItems.id, incidentLinkedItems.workItemId))
      .leftJoin(users, eq(users.id, incidentLinkedItems.linkedById))
      .where(eq(incidentLinkedItems.incidentId, incidentId))
      .orderBy(desc(incidentLinkedItems.linkedAt));

    return items;
  }
}

export const incidentsService = new IncidentsService();
