import { eq, and, sql } from "drizzle-orm";
import { db, outboxEvents, notifications, teamMemberships, workItems, OutboxEvent } from "../db";

/**
 * Result of processing an outbox event.
 */
export interface ProcessEventResult {
  outboxEventId: string;
  status: "PROCESSED" | "FAILED";
  notificationsCreated: number;
  error?: string;
}

/**
 * Idempotently processes an outbox event by dispatching notifications to relevant users.
 *
 * Guarantees:
 * - Idempotent delivery: relies on the unique constraint (recipient_id, activity_event_id).
 * - Avoids marking as PROCESSED until all work succeeds.
 * - Records attempts and last_error on failure.
 * - Never notifies the actor of their own action.
 */
export async function processOutboxEvent(event: OutboxEvent): Promise<ProcessEventResult> {
  const payload = event.payload as Record<string, any>;
  const actorId = payload.actorId as string;
  const itemId = payload.itemId as string;
  const teamId = payload.teamId as string;

  try {
    const recipients = new Set<string>();

    // 1. Determine recipients based on domain event type
    switch (event.eventType) {
      case "ASSIGNED": {
        const newAssigneeId = payload.newValue?.assigneeId;
        if (newAssigneeId && newAssigneeId !== actorId) {
          recipients.add(newAssigneeId);
        }
        break;
      }

      case "CLAIMED": {
        // When claimed, notify team leads
        if (teamId) {
          const leads = await db
            .select({ userId: teamMemberships.userId })
            .from(teamMemberships)
            .where(
              and(
                eq(teamMemberships.teamId, teamId),
                sql`${teamMemberships.role} IN ('LEAD', 'ADMIN')`
              )
            );

          for (const lead of leads) {
            if (lead.userId !== actorId) {
              recipients.add(lead.userId);
            }
          }
        }
        break;
      }

      case "STATUS_CHANGED": {
        const newStatus = payload.newValue?.status;

        // Fetch current item to find creator and assignee
        if (itemId) {
          const [item] = await db
            .select()
            .from(workItems)
            .where(eq(workItems.id, itemId))
            .limit(1);

          if (item) {
            if (item.assigneeId && item.assigneeId !== actorId) {
              recipients.add(item.assigneeId);
            }
            if (item.createdById && item.createdById !== actorId) {
              recipients.add(item.createdById);
            }

            // If item is awaiting approval, notify team leads and admins
            if (newStatus === "AWAITING_APPROVAL" && item.teamId) {
              const leads = await db
                .select({ userId: teamMemberships.userId })
                .from(teamMemberships)
                .where(
                  and(
                    eq(teamMemberships.teamId, item.teamId),
                    sql`${teamMemberships.role} IN ('LEAD', 'ADMIN')`
                  )
                );

              for (const lead of leads) {
                if (lead.userId !== actorId) {
                  recipients.add(lead.userId);
                }
              }
            }
          }
        }
        break;
      }

      case "CREATED": {
        const assigneeId = payload.assigneeId || payload.newValue?.assigneeId;
        if (assigneeId && assigneeId !== actorId) {
          recipients.add(assigneeId);
        }
        break;
      }

      case "SLA_WARNING": {
        // Notify the assigned user when one exists
        if (itemId) {
          const [item] = await db
            .select({ assigneeId: workItems.assigneeId })
            .from(workItems)
            .where(eq(workItems.id, itemId))
            .limit(1);

          if (item?.assigneeId) {
            recipients.add(item.assigneeId);
          }
          // If no assignee exists, safely do not crash or create invalid recipient
        }
        break;
      }

      case "SLA_BREACHED": {
        let currentTeamId = teamId;
        if (itemId) {
          const [item] = await db
            .select({
              assigneeId: workItems.assigneeId,
              teamId: workItems.teamId,
            })
            .from(workItems)
            .where(eq(workItems.id, itemId))
            .limit(1);

          if (item) {
            currentTeamId = currentTeamId || item.teamId;
            // Notify the assignee when present
            if (item.assigneeId) {
              recipients.add(item.assigneeId);
            }
          }
        }

        // Notify eligible LEAD/ADMIN members of the same team
        if (currentTeamId) {
          const leads = await db
            .select({ userId: teamMemberships.userId })
            .from(teamMemberships)
            .where(
              and(
                eq(teamMemberships.teamId, currentTeamId),
                sql`${teamMemberships.role} IN ('LEAD', 'ADMIN')`
              )
            );

          for (const lead of leads) {
            recipients.add(lead.userId);
          }
        }
        break;
      }

      default:
        break;
    }

    // 2. Insert notifications transactionally (idempotent due to unique index)
    let notificationsCreated = 0;

    await db.transaction(async (tx) => {
      for (const recipientId of recipients) {
        // Check if notification already exists for this (recipient, activityEventId)
        const [existing] = await tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.recipientId, recipientId),
              eq(notifications.activityEventId, event.activityEventId)
            )
          )
          .limit(1);

        if (!existing) {
          await tx.insert(notifications).values({
            recipientId,
            activityEventId: event.activityEventId,
          });
          notificationsCreated++;
        }
      }

      // 3. Mark outbox event as PROCESSED only after notifications are written
      await tx
        .update(outboxEvents)
        .set({
          status: "PROCESSED",
          processedAt: new Date(),
          lastError: null,
        })
        .where(eq(outboxEvents.id, event.id));
    });

    return {
      outboxEventId: event.id,
      status: "PROCESSED",
      notificationsCreated,
    };
  } catch (err: any) {
    const nextAttempts = (event.attempts || 0) + 1;
    const finalStatus = nextAttempts >= 5 ? "FAILED" : "PENDING";

    await db
      .update(outboxEvents)
      .set({
        attempts: nextAttempts,
        status: finalStatus,
        lastError: err?.message || String(err),
      })
      .where(eq(outboxEvents.id, event.id));

    return {
      outboxEventId: event.id,
      status: "FAILED",
      notificationsCreated: 0,
      error: err?.message || String(err),
    };
  }
}
