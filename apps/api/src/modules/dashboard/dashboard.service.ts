import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, workItems, activityEvents, users, teams, teamMemberships } from "../../db";
import { AuthenticatedUser } from "../../middleware/auth";
import { getTeamMembership } from "../../middleware/authorize";
import { NotFoundError } from "../../shared/errors";

export interface DashboardSummary {
  team: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  metrics: {
    totalWorkItems: number;
    unassignedCount: number;
    assignedToMeCount: number;
    awaitingApprovalCount: number;
    byStatus: {
      OPEN: number;
      IN_PROGRESS: number;
      AWAITING_APPROVAL: number;
      RESOLVED: number;
      CLOSED: number;
    };
    byPriority: {
      LOW: number;
      NORMAL: number;
      HIGH: number;
      URGENT: number;
    };
  };
  recentActivity: Array<{
    id: string;
    itemId: string;
    itemTitle: string | null;
    actorId: string | null;
    actorName: string | null;
    eventType: string;
    oldValue: any;
    newValue: any;
    createdAt: Date;
  }>;
}

export class DashboardService {
  /**
   * Retrieves team-scoped work item statistics and recent activity feed.
   */
  async getDashboardSummary(
    user: AuthenticatedUser,
    teamId?: string
  ): Promise<DashboardSummary> {
    let targetTeamId = teamId;

    if (!targetTeamId) {
      const [firstMembership] = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(eq(teamMemberships.userId, user.id))
        .limit(1);

      if (!firstMembership) {
        throw new NotFoundError("User is not a member of any team");
      }
      targetTeamId = firstMembership.teamId;
    }

    // 1. Verify user's membership in team
    const membership = await getTeamMembership(user.id, targetTeamId);
    if (!membership) {
      throw new NotFoundError("Team not found");
    }

    const [team] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, targetTeamId))
      .limit(1);

    if (!team) {
      throw new NotFoundError("Team not found");
    }

    // 2. Query status distribution
    const statusCounts = await db
      .select({
        status: workItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(workItems)
      .where(eq(workItems.teamId, targetTeamId))
      .groupBy(workItems.status);

    const byStatus = {
      OPEN: 0,
      IN_PROGRESS: 0,
      AWAITING_APPROVAL: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };
    let totalWorkItems = 0;
    for (const row of statusCounts) {
      if (row.status in byStatus) {
        byStatus[row.status as keyof typeof byStatus] = row.count;
      }
      totalWorkItems += row.count;
    }

    // 3. Query priority distribution
    const priorityCounts = await db
      .select({
        priority: workItems.priority,
        count: sql<number>`count(*)::int`,
      })
      .from(workItems)
      .where(eq(workItems.teamId, targetTeamId))
      .groupBy(workItems.priority);

    const byPriority = {
      LOW: 0,
      NORMAL: 0,
      HIGH: 0,
      URGENT: 0,
    };
    for (const row of priorityCounts) {
      if (row.priority in byPriority) {
        byPriority[row.priority as keyof typeof byPriority] = row.count;
      }
    }

    // 4. Query unassigned and assignedToMe counts
    const [unassignedResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems)
      .where(
        and(
          eq(workItems.teamId, targetTeamId),
          isNull(workItems.assigneeId),
          sql`${workItems.status} != 'CLOSED'`
        )
      );

    const [assignedToMeResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems)
      .where(
        and(
          eq(workItems.teamId, targetTeamId),
          eq(workItems.assigneeId, user.id),
          sql`${workItems.status} != 'CLOSED'`
        )
      );

    // 5. Query recent activity feed in this team
    const recentActivityRows = await db
      .select({
        id: activityEvents.id,
        itemId: activityEvents.itemId,
        itemTitle: workItems.title,
        actorId: activityEvents.actorId,
        actorName: users.name,
        eventType: activityEvents.eventType,
        oldValue: activityEvents.oldValue,
        newValue: activityEvents.newValue,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .innerJoin(workItems, eq(workItems.id, activityEvents.itemId))
      .leftJoin(users, eq(users.id, activityEvents.actorId))
      .where(eq(workItems.teamId, targetTeamId))
      .orderBy(desc(activityEvents.createdAt))
      .limit(10);

    return {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        role: membership.role,
      },
      metrics: {
        totalWorkItems,
        unassignedCount: unassignedResult?.count ?? 0,
        assignedToMeCount: assignedToMeResult?.count ?? 0,
        awaitingApprovalCount: byStatus.AWAITING_APPROVAL,
        byStatus,
        byPriority,
      },
      recentActivity: recentActivityRows,
    };
  }
}

export const dashboardService = new DashboardService();
