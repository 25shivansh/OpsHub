import { and, desc, asc, eq, isNull, inArray, sql } from "drizzle-orm";
import { db, workItems, activityEvents, outboxEvents, teamMemberships, users, workItemSlas, WorkItem, WorkItemSla } from "../../db";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors";
import { AuthenticatedUser } from "../../middleware/auth";
import { getTeamMembership, hasMinimumRole, TeamMembershipRole } from "../../middleware/authorize";
import {
  AssignWorkItemInput,
  ClaimWorkItemInput,
  CreateWorkItemInput,
  ListWorkItemsQuery,
  TransitionWorkItemInput,
  UpdateWorkItemInput,
} from "./work-items.schemas";
import { slaService } from "../sla/sla.service";

export type WorkItemWithSla = WorkItem & { sla?: WorkItemSla | null };

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TransitionRule {
  allowedRoles: TeamMembershipRole[];
}

/**
 * Deterministic workflow transition rules matrix.
 * Enforces role-based governance for approvals and closures.
 */
export const WORKFLOW_TRANSITIONS: Record<string, Record<string, TransitionRule>> = {
  OPEN: {
    IN_PROGRESS: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] },
    CLOSED: { allowedRoles: ["LEAD", "ADMIN"] }, // Discarding/cancelling from open
  },
  IN_PROGRESS: {
    AWAITING_APPROVAL: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] }, // Work completed, submitted for review
    OPEN: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] }, // Blocked/reverted
    CLOSED: { allowedRoles: ["LEAD", "ADMIN"] }, // Discarding/cancelling
    RESOLVED: { allowedRoles: ["LEAD", "ADMIN"] }, // Emergency lead/admin direct resolution (bypasses approval queue)
  },
  AWAITING_APPROVAL: {
    RESOLVED: { allowedRoles: ["LEAD", "ADMIN"] }, // Approval decision: APPROVE
    IN_PROGRESS: { allowedRoles: ["LEAD", "ADMIN"] }, // Approval decision: REJECT / Request changes
  },
  RESOLVED: {
    CLOSED: { allowedRoles: ["MEMBER", "LEAD", "ADMIN"] }, // Closing resolved item
    OPEN: { allowedRoles: ["LEAD", "ADMIN"] }, // Reopen if verification fails
  },
  CLOSED: {
    OPEN: { allowedRoles: ["LEAD", "ADMIN"] }, // Reopening closed item
  },
};

/**
 * Validates whether a workflow transition from currentStatus to targetStatus is permitted
 * for the user's role.
 */
export function validateWorkflowTransition(
  currentStatus: string,
  targetStatus: string,
  userRole: TeamMembershipRole
): void {
  if (currentStatus === targetStatus) {
    return;
  }

  const allowedForCurrent = WORKFLOW_TRANSITIONS[currentStatus];
  if (!allowedForCurrent || !allowedForCurrent[targetStatus]) {
    throw new BadRequestError(
      `Invalid workflow transition from ${currentStatus} to ${targetStatus}`
    );
  }

  const rule = allowedForCurrent[targetStatus];
  if (!rule.allowedRoles.includes(userRole)) {
    throw new ForbiddenError(
      `Insufficient permissions: transitioning from ${currentStatus} to ${targetStatus} requires ${rule.allowedRoles.join(" or ")} role`
    );
  }
}

export class WorkItemsService {
  /**
   * Retrieves paginated work items scoped to a team the user belongs to.
   */
  async listWorkItems(
    user: AuthenticatedUser,
    query: ListWorkItemsQuery
  ): Promise<PaginatedResult<WorkItem>> {
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
          pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
        };
      }
      targetTeamId = firstMembership.teamId;
    }

    // 1. Enforce team membership
    const membership = await getTeamMembership(user.id, targetTeamId);
    if (!membership) {
      throw new NotFoundError("Team not found or inaccessible");
    }

    // 2. Build where conditions
    const conditions = [eq(workItems.teamId, targetTeamId)];

    if (query.status) {
      conditions.push(eq(workItems.status, query.status));
    }
    if (query.type) {
      conditions.push(eq(workItems.type, query.type));
    }
    if (query.priority) {
      conditions.push(eq(workItems.priority, query.priority));
    }
    if (query.assigneeId) {
      conditions.push(eq(workItems.assigneeId, query.assigneeId));
    }

    const whereClause = and(...conditions);

    // 3. Sorting allowlist
    const sortColumn = workItems[query.sortBy];
    const sortOrder = query.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

    // 4. Pagination
    const offset = (query.page - 1) * query.limit;

    // 5. Query data and total count
    const [data, totalCountResult] = await Promise.all([
      db
        .select()
        .from(workItems)
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(query.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workItems)
        .where(whereClause),
    ]);

    const total = totalCountResult[0]?.count ?? 0;

    // Attach SLA tracking details for each item in the batch
    const itemIds = data.map((i) => i.id);
    const slas =
      itemIds.length > 0
        ? await db
            .select()
            .from(workItemSlas)
            .where(inArray(workItemSlas.workItemId, itemIds))
        : [];
    const slaMap = new Map(slas.map((s) => [s.workItemId, s]));
    const dataWithSla: WorkItemWithSla[] = data.map((item) => ({
      ...item,
      sla: slaMap.get(item.id) ?? null,
    }));

    return {
      data: dataWithSla,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  /**
   * Helper to attach SLA tracking record to a single work item.
   */
  private async attachSla(
    item: WorkItem,
    tx: any = db
  ): Promise<WorkItemWithSla> {
    const [sla] = await tx
      .select()
      .from(workItemSlas)
      .where(eq(workItemSlas.workItemId, item.id))
      .limit(1);

    return {
      ...item,
      sla: sla ?? null,
    };
  }

  /**
   * Retrieves a single work item by ID, enforcing team-scoped access.
   */
  async getWorkItemById(user: AuthenticatedUser, itemId: string): Promise<WorkItemWithSla> {
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, itemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError("Work item not found");
    }

    // Check that user belongs to the item's team (return 404 to prevent IDOR leaks)
    const membership = await getTeamMembership(user.id, item.teamId);
    if (!membership) {
      throw new NotFoundError("Work item not found");
    }

    return this.attachSla(item);
  }

  /**
   * Creates a new work item and emits a CREATED activity event in the same transaction.
   */
  async createWorkItem(
    user: AuthenticatedUser,
    input: CreateWorkItemInput
  ): Promise<WorkItem> {
    // 1. Verify user team membership and mutation role
    const membership = await getTeamMembership(user.id, input.teamId);
    if (!membership) {
      throw new NotFoundError("Team not found or inaccessible");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to create work items");
    }

    // 2. If assignee is specified, verify they belong to the item's team
    if (input.assigneeId) {
      const [assigneeMembership] = await db
        .select({ id: teamMemberships.userId })
        .from(teamMemberships)
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(
          and(
            eq(teamMemberships.userId, input.assigneeId),
            eq(teamMemberships.teamId, input.teamId),
            eq(users.isActive, true)
          )
        )
        .limit(1);

      if (!assigneeMembership) {
        throw new BadRequestError("Assignee must be an active member of the item's team");
      }
    }

    // 3. Insert work item and activity event transactionally
    const result = await db.transaction(async (tx) => {
      const [newItem] = await tx
        .insert(workItems)
        .values({
          teamId: input.teamId,
          title: input.title,
          description: input.description,
          type: input.type,
          priority: input.priority,
          status: "OPEN",
          createdById: user.id,
          assigneeId: input.assigneeId ?? null,
          dueAt: input.dueAt ?? null,
          version: 1,
        })
        .returning();

      // Audit activity event
      const [activity] = await tx
        .insert(activityEvents)
        .values({
          itemId: newItem.id,
          actorId: user.id,
          eventType: "CREATED",
          newValue: {
            id: newItem.id,
            title: newItem.title,
            status: newItem.status,
            priority: newItem.priority,
            type: newItem.type,
            assigneeId: newItem.assigneeId,
          },
        })
        .returning();

      // Write transactional outbox event
      await tx.insert(outboxEvents).values({
        activityEventId: activity.id,
        eventType: "CREATED",
        payload: {
          itemId: newItem.id,
          teamId: newItem.teamId,
          actorId: user.id,
          title: newItem.title,
          status: newItem.status,
          priority: newItem.priority,
          type: newItem.type,
          assigneeId: newItem.assigneeId,
        },
        status: "PENDING",
      });

      // SLA snapshot creation if an active team policy applies
      const createdSla = await slaService.createSlaSnapshot(newItem, tx);

      return {
        ...newItem,
        sla: createdSla ?? null,
      };
    });

    return result;
  }

  /**
   * Updates an existing work item with optimistic concurrency control and workflow validation.
   */
  async updateWorkItem(
    user: AuthenticatedUser,
    itemId: string,
    input: UpdateWorkItemInput
  ): Promise<WorkItem> {
    // 1. Retrieve existing work item
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, itemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError("Work item not found");
    }

    // 2. Verify team membership and mutation permission
    const membership = await getTeamMembership(user.id, item.teamId);
    if (!membership) {
      throw new NotFoundError("Work item not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to mutate work items");
    }

    // 3. Validate workflow state transitions if status is changing
    if (input.status && input.status !== item.status) {
      validateWorkflowTransition(item.status, input.status, membership.role);
    }

    // 4. Validate assignee membership if assigneeId is being updated
    if (input.assigneeId !== undefined && input.assigneeId !== null && input.assigneeId !== item.assigneeId) {
      const [assigneeMembership] = await db
        .select({ id: teamMemberships.userId })
        .from(teamMemberships)
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(
          and(
            eq(teamMemberships.userId, input.assigneeId),
            eq(teamMemberships.teamId, item.teamId),
            eq(users.isActive, true)
          )
        )
        .limit(1);

      if (!assigneeMembership) {
        throw new BadRequestError("Assignee must be an active member of the item's team");
      }
    }

    // 5. Check optimistic concurrency control
    if (input.expectedVersion !== undefined && input.expectedVersion !== item.version) {
      throw new ConflictError(
        `Version conflict: work item was modified by another operation. Expected version ${input.expectedVersion}, but current version is ${item.version}.`,
        { currentVersion: item.version, expectedVersion: input.expectedVersion }
      );
    }

    // 6. Compute diff for activity event
    const oldSnapshot: Record<string, any> = {};
    const newSnapshot: Record<string, any> = {};

    if (input.title !== undefined && input.title !== item.title) {
      oldSnapshot.title = item.title;
      newSnapshot.title = input.title;
    }
    if (input.description !== undefined && input.description !== item.description) {
      oldSnapshot.description = item.description;
      newSnapshot.description = input.description;
    }
    if (input.status !== undefined && input.status !== item.status) {
      oldSnapshot.status = item.status;
      newSnapshot.status = input.status;
    }
    if (input.priority !== undefined && input.priority !== item.priority) {
      oldSnapshot.priority = item.priority;
      newSnapshot.priority = input.priority;
    }
    if (input.type !== undefined && input.type !== item.type) {
      oldSnapshot.type = item.type;
      newSnapshot.type = input.type;
    }
    if (input.assigneeId !== undefined && input.assigneeId !== item.assigneeId) {
      oldSnapshot.assigneeId = item.assigneeId;
      newSnapshot.assigneeId = input.assigneeId;
    }
    if (input.dueAt !== undefined && input.dueAt?.toISOString() !== item.dueAt?.toISOString()) {
      oldSnapshot.dueAt = item.dueAt;
      newSnapshot.dueAt = input.dueAt;
    }

    // If nothing changed, return existing item as clean no-op (no version bump, no audit log)
    if (Object.keys(newSnapshot).length === 0) {
      return item;
    }

    // Determine eventType
    let eventType: "STATUS_CHANGED" | "ASSIGNED" | "UPDATED" = "UPDATED";
    if (newSnapshot.status !== undefined) {
      eventType = "STATUS_CHANGED";
    } else if (newSnapshot.assigneeId !== undefined) {
      eventType = "ASSIGNED";
    }

    // 7. Perform atomic conditional update within transaction
    const targetVersion = input.expectedVersion ?? item.version;
    const nextVersion = item.version + 1;

    const result = await db.transaction(async (tx) => {
      const [updatedItem] = await tx
        .update(workItems)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.id, itemId),
            eq(workItems.version, targetVersion)
          )
        )
        .returning();

      if (!updatedItem) {
        throw new ConflictError(
          "Version conflict: work item was modified concurrently by another process.",
          { currentVersion: item.version, expectedVersion: input.expectedVersion }
        );
      }

      // Record activity event
      const [activity] = await tx
        .insert(activityEvents)
        .values({
          itemId: updatedItem.id,
          actorId: user.id,
          eventType,
          oldValue: oldSnapshot,
          newValue: newSnapshot,
        })
        .returning();

      // Write transactional outbox event
      await tx.insert(outboxEvents).values({
        activityEventId: activity.id,
        eventType,
        payload: {
          itemId: updatedItem.id,
          teamId: updatedItem.teamId,
          actorId: user.id,
          oldValue: oldSnapshot,
          newValue: newSnapshot,
        },
        status: "PENDING",
      });

      // SLA lifecycle tracking
      if (input.assigneeId !== undefined && input.assigneeId !== null) {
        await slaService.recordFirstResponse(updatedItem.id, new Date(), tx);
      }
      if (input.status === "IN_PROGRESS") {
        await slaService.recordFirstResponse(updatedItem.id, new Date(), tx);
      } else if (input.status === "RESOLVED" || input.status === "CLOSED") {
        await slaService.recordResolution(updatedItem.id, new Date(), tx);
      }

      return this.attachSla(updatedItem, tx);
    });

    return result;
  }

  /**
   * Atomically claims an unassigned work item in OPEN status.
   * Guarantees that only one concurrent claim succeeds and records a CLAIMED event.
   */
  async claimWorkItem(
    user: AuthenticatedUser,
    itemId: string,
    input?: ClaimWorkItemInput
  ): Promise<WorkItem> {
    // 1. Pre-fetch item
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, itemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError("Work item not found");
    }

    // 2. Verify team membership
    const membership = await getTeamMembership(user.id, item.teamId);
    if (!membership) {
      throw new NotFoundError("Work item not found");
    }

    // 3. Viewers cannot claim items
    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to claim work items");
    }

    // 4. Pre-checks for descriptive conflict responses
    if (item.assigneeId !== null) {
      throw new ConflictError("Work item is already assigned or claimed");
    }

    if (item.status !== "OPEN") {
      throw new ConflictError(
        `Work item cannot be claimed because its status is ${item.status}, not OPEN`
      );
    }

    if (input?.expectedVersion !== undefined && item.version !== input.expectedVersion) {
      throw new ConflictError(
        `Version conflict: expected version ${input.expectedVersion}, but current version is ${item.version}`
      );
    }

    // 5. Atomic conditional update within transaction
    const targetVersion = input?.expectedVersion ?? item.version;
    const nextVersion = item.version + 1;

    const result = await db.transaction(async (tx) => {
      const [claimedItem] = await tx
        .update(workItems)
        .set({
          assigneeId: user.id,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.id, itemId),
            eq(workItems.status, "OPEN"),
            isNull(workItems.assigneeId),
            eq(workItems.version, targetVersion)
          )
        )
        .returning();

      if (!claimedItem) {
        throw new ConflictError(
          "Work item could not be claimed: item was concurrently modified, claimed, or assigned"
        );
      }

      // Record CLAIMED activity event
      const [activity] = await tx
        .insert(activityEvents)
        .values({
          itemId: claimedItem.id,
          actorId: user.id,
          eventType: "CLAIMED",
          oldValue: { assigneeId: null },
          newValue: { assigneeId: user.id },
        })
        .returning();

      // Write transactional outbox event
      await tx.insert(outboxEvents).values({
        activityEventId: activity.id,
        eventType: "CLAIMED",
        payload: {
          itemId: claimedItem.id,
          teamId: claimedItem.teamId,
          actorId: user.id,
          oldValue: { assigneeId: null },
          newValue: { assigneeId: user.id },
        },
        status: "PENDING",
      });

      // SLA lifecycle tracking: claiming satisfies first response
      await slaService.recordFirstResponse(claimedItem.id, new Date(), tx);

      return this.attachSla(claimedItem, tx);
    });

    return result;
  }

  /**
   * Dedicated workflow transition endpoint.
   * Enforces role requirements, state transitions, atomic updates, and STATUS_CHANGED activity event.
   */
  async transitionWorkItem(
    user: AuthenticatedUser,
    itemId: string,
    input: TransitionWorkItemInput
  ): Promise<WorkItem> {
    // 1. Pre-fetch item
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, itemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError("Work item not found");
    }

    // 2. Verify team membership
    const membership = await getTeamMembership(user.id, item.teamId);
    if (!membership) {
      throw new NotFoundError("Work item not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to transition work items");
    }

    // 3. No-op check
    if (item.status === input.status) {
      return item;
    }

    // 4. Validate transition and role rules
    validateWorkflowTransition(item.status, input.status, membership.role);

    // 5. Atomic update in transaction
    const targetVersion = input.expectedVersion ?? item.version;
    const nextVersion = item.version + 1;

    const result = await db.transaction(async (tx) => {
      const [updatedItem] = await tx
        .update(workItems)
        .set({
          status: input.status,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.id, itemId),
            eq(workItems.version, targetVersion)
          )
        )
        .returning();

      if (!updatedItem) {
        throw new ConflictError(
          "Version conflict: work item was modified concurrently by another process"
        );
      }

      // Record STATUS_CHANGED activity event
      const [activity] = await tx
        .insert(activityEvents)
        .values({
          itemId: updatedItem.id,
          actorId: user.id,
          eventType: "STATUS_CHANGED",
          oldValue: { status: item.status },
          newValue: { status: input.status },
        })
        .returning();

      // Write transactional outbox event
      await tx.insert(outboxEvents).values({
        activityEventId: activity.id,
        eventType: "STATUS_CHANGED",
        payload: {
          itemId: updatedItem.id,
          teamId: updatedItem.teamId,
          actorId: user.id,
          oldValue: { status: item.status },
          newValue: { status: input.status },
        },
        status: "PENDING",
      });

      // SLA lifecycle tracking
      if (input.status === "IN_PROGRESS") {
        await slaService.recordFirstResponse(updatedItem.id, new Date(), tx);
      } else if (input.status === "RESOLVED" || input.status === "CLOSED") {
        await slaService.recordResolution(updatedItem.id, new Date(), tx);
      }

      return this.attachSla(updatedItem, tx);
    });

    return result;
  }

  /**
   * Dedicated assignment endpoint.
   * Validates target user is an active team member, prevents no-op events,
   * and records an ASSIGNED activity event transactionally.
   */
  async assignWorkItem(
    user: AuthenticatedUser,
    itemId: string,
    input: AssignWorkItemInput
  ): Promise<WorkItem> {
    // 1. Pre-fetch item
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, itemId))
      .limit(1);

    if (!item) {
      throw new NotFoundError("Work item not found");
    }

    // 2. Verify team membership
    const membership = await getTeamMembership(user.id, item.teamId);
    if (!membership) {
      throw new NotFoundError("Work item not found");
    }

    if (!hasMinimumRole(membership.role, "MEMBER")) {
      throw new ForbiddenError("Viewers are not permitted to assign work items");
    }

    // 3. No-op check: if assigning to existing assignee, return unchanged
    if (item.assigneeId === input.assigneeId) {
      return item;
    }

    // 4. Validate target user membership if assigneeId is not null
    if (input.assigneeId !== null) {
      const [assigneeMembership] = await db
        .select({ id: teamMemberships.userId })
        .from(teamMemberships)
        .innerJoin(users, eq(users.id, teamMemberships.userId))
        .where(
          and(
            eq(teamMemberships.userId, input.assigneeId),
            eq(teamMemberships.teamId, item.teamId),
            eq(users.isActive, true)
          )
        )
        .limit(1);

      if (!assigneeMembership) {
        throw new BadRequestError("Assignee must be an active member of the item's team");
      }
    }

    // 5. Atomic update in transaction
    const targetVersion = input.expectedVersion ?? item.version;
    const nextVersion = item.version + 1;

    const result = await db.transaction(async (tx) => {
      const [updatedItem] = await tx
        .update(workItems)
        .set({
          assigneeId: input.assigneeId,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.id, itemId),
            eq(workItems.version, targetVersion)
          )
        )
        .returning();

      if (!updatedItem) {
        throw new ConflictError(
          "Version conflict: work item was modified concurrently by another process"
        );
      }

      // Record ASSIGNED activity event
      const [activity] = await tx
        .insert(activityEvents)
        .values({
          itemId: updatedItem.id,
          actorId: user.id,
          eventType: "ASSIGNED",
          oldValue: { assigneeId: item.assigneeId },
          newValue: { assigneeId: input.assigneeId },
        })
        .returning();

      // Write transactional outbox event
      await tx.insert(outboxEvents).values({
        activityEventId: activity.id,
        eventType: "ASSIGNED",
        payload: {
          itemId: updatedItem.id,
          teamId: updatedItem.teamId,
          actorId: user.id,
          oldValue: { assigneeId: item.assigneeId },
          newValue: { assigneeId: input.assigneeId },
        },
        status: "PENDING",
      });

      // SLA lifecycle tracking: assigning satisfies first response
      if (input.assigneeId !== null) {
        await slaService.recordFirstResponse(updatedItem.id, new Date(), tx);
      }

      return this.attachSla(updatedItem, tx);
    });

    return result;
  }
}

export const workItemsService = new WorkItemsService();
