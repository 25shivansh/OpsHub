import { eq, asc } from "drizzle-orm";
import { db, outboxEvents, OutboxEvent } from "../db";
import { processOutboxEvent, ProcessEventResult } from "./outbox.processor";
import { getOutboxQueue } from "./outbox.queue";

let relayTimer: NodeJS.Timeout | null = null;
let isRelaying = false;

/**
 * Sweeps pending outbox events from the database and either enqueues them into BullMQ
 * or directly processes them if Redis is offline/in test mode.
 */
export async function relayPendingEventsOnce(
  batchSize = 25,
  useQueue = false
): Promise<ProcessEventResult[]> {
  if (isRelaying) {
    return [];
  }

  isRelaying = true;
  const results: ProcessEventResult[] = [];

  try {
    // 1. Fetch oldest PENDING outbox events
    const pendingEvents: OutboxEvent[] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.status, "PENDING"))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(batchSize);

    if (pendingEvents.length === 0) {
      return [];
    }

    // 2. Process or enqueue each event
    for (const event of pendingEvents) {
      if (useQueue) {
        try {
          const queue = getOutboxQueue();
          await queue.add(
            event.eventType,
            { outboxEventId: event.id },
            { jobId: `outbox-${event.id}` }
          );

          // Mark as PUBLISHED (enqueued)
          await db
            .update(outboxEvents)
            .set({
              status: "PUBLISHED",
              publishedAt: new Date(),
            })
            .where(eq(outboxEvents.id, event.id));

          results.push({
            outboxEventId: event.id,
            status: "PROCESSED",
            notificationsCreated: 0,
          });
          continue;
        } catch {
          // If queue addition fails (e.g. Redis unavailable), fall back to direct processing
        }
      }

      // Direct synchronous processing fallback
      const result = await processOutboxEvent(event);
      results.push(result);
    }

    return results;
  } finally {
    isRelaying = false;
  }
}

/**
 * Starts the periodic outbox relay background loop.
 */
export function startOutboxRelay(intervalMs = 3000): void {
  if (relayTimer) {
    return;
  }

  relayTimer = setInterval(async () => {
    try {
      await relayPendingEventsOnce(50, false);
    } catch (err: any) {
      console.error("[OutboxRelay] Error in relay loop:", err.message);
    }
  }, intervalMs);
}

/**
 * Stops the periodic outbox relay background loop.
 */
export function stopOutboxRelay(): void {
  if (relayTimer) {
    clearInterval(relayTimer);
    relayTimer = null;
  }
}
