import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, notifications, activityEvents, workItems, users, Notification } from "../../db";
import { AuthenticatedUser } from "../../middleware/auth";
import { NotFoundError } from "../../shared/errors";
import { ListNotificationsQuery } from "./notifications.schemas";

export interface EnrichedNotification {
  id: string;
  recipientId: string;
  activityEventId: string;
  readAt: Date | null;
  createdAt: Date;
  event: {
    id: string;
    itemId: string | null;
    actorId: string | null;
    actorName: string | null;
    eventType: string | null;
    itemTitle: string | null;
    itemStatus: string | null;
    oldValue: any;
    newValue: any;
    createdAt: Date | null;
  } | null;
}

export interface PaginatedNotifications {
  data: EnrichedNotification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class NotificationsService {
  /**
   * Retrieves paginated notifications for the authenticated user.
   */
  async listNotifications(
    user: AuthenticatedUser,
    query: ListNotificationsQuery
  ): Promise<PaginatedNotifications> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = [eq(notifications.recipientId, user.id)];
    if (query.unreadOnly) {
      conditions.push(isNull(notifications.readAt));
    }

    const whereClause = and(...conditions);

    // 1. Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(whereClause);

    const total = countResult?.count ?? 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // 2. Fetch enriched rows with joined activity event, work item, and actor
    const rows = await db
      .select({
        id: notifications.id,
        recipientId: notifications.recipientId,
        activityEventId: notifications.activityEventId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        eventId: activityEvents.id,
        itemId: activityEvents.itemId,
        actorId: activityEvents.actorId,
        actorName: users.name,
        eventType: activityEvents.eventType,
        itemTitle: workItems.title,
        itemStatus: workItems.status,
        oldValue: activityEvents.oldValue,
        newValue: activityEvents.newValue,
        eventCreatedAt: activityEvents.createdAt,
      })
      .from(notifications)
      .leftJoin(activityEvents, eq(activityEvents.id, notifications.activityEventId))
      .leftJoin(users, eq(users.id, activityEvents.actorId))
      .leftJoin(workItems, eq(workItems.id, activityEvents.itemId))
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const data: EnrichedNotification[] = rows.map((row) => ({
      id: row.id,
      recipientId: row.recipientId,
      activityEventId: row.activityEventId,
      readAt: row.readAt,
      createdAt: row.createdAt,
      event: row.eventId
        ? {
            id: row.eventId,
            itemId: row.itemId,
            actorId: row.actorId,
            actorName: row.actorName,
            eventType: row.eventType,
            itemTitle: row.itemTitle,
            itemStatus: row.itemStatus,
            oldValue: row.oldValue,
            newValue: row.newValue,
            createdAt: row.eventCreatedAt,
          }
        : null,
    }));

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Returns the count of unread notifications for the user.
   */
  async getUnreadCount(user: AuthenticatedUser): Promise<{ count: number }> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, user.id),
          isNull(notifications.readAt)
        )
      );

    return { count: result?.count ?? 0 };
  }

  /**
   * Marks a single notification as read.
   */
  async markAsRead(user: AuthenticatedUser, notificationId: string): Promise<Notification> {
    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, user.id)
        )
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Notification not found");
    }

    if (existing.readAt) {
      return existing;
    }

    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, notificationId))
      .returning();

    return updated;
  }

  /**
   * Marks all unread notifications for the user as read.
   */
  async markAllAsRead(user: AuthenticatedUser): Promise<{ updatedCount: number }> {
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientId, user.id),
          isNull(notifications.readAt)
        )
      )
      .returning();

    return { updatedCount: updated.length };
  }
}

export const notificationsService = new NotificationsService();
