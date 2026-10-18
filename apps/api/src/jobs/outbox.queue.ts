import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { config } from "../config";
import { db, outboxEvents, OutboxEvent } from "../db";
import { eq } from "drizzle-orm";
import { processOutboxEvent, ProcessEventResult } from "./outbox.processor";

export const OUTBOX_QUEUE_NAME = "newtonite-outbox-events";

let redisClient: Redis | null = null;
let outboxQueue: Queue | null = null;
let outboxWorker: Worker | null = null;

/**
 * Creates or retrieves the shared Redis client with resilient connection options.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        // Backoff up to 2 seconds, retry indefinitely in background
        return Math.min(times * 100, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on("error", (err) => {
      // Log connection error without crashing the process
      if (config.NODE_ENV !== "test") {
        console.warn(`[Redis] Connection warning: ${err.message}`);
      }
    });
  }
  return redisClient;
}

/**
 * Returns the BullMQ outbox queue instance.
 */
export function getOutboxQueue(): Queue {
  if (!outboxQueue) {
    const connection = getRedisClient();
    outboxQueue = new Queue(OUTBOX_QUEUE_NAME, {
      connection: connection as any,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return outboxQueue;
}

/**
 * Initializes the BullMQ Worker to process outbox event jobs.
 */
export function startOutboxWorker(): Worker {
  if (!outboxWorker) {
    const connection = getRedisClient();
    outboxWorker = new Worker(
      OUTBOX_QUEUE_NAME,
      async (job: Job<{ outboxEventId: string }>): Promise<ProcessEventResult> => {
        const { outboxEventId } = job.data;

        // Fetch outbox event from database
        const [event] = await db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.id, outboxEventId))
          .limit(1);

        if (!event) {
          throw new Error(`Outbox event ${outboxEventId} not found`);
        }

        if (event.status === "PROCESSED") {
          return {
            outboxEventId,
            status: "PROCESSED",
            notificationsCreated: 0,
          };
        }

        const result = await processOutboxEvent(event);
        if (result.status === "FAILED") {
          throw new Error(result.error || "Failed to process outbox event");
        }

        return result;
      },
      {
        connection: connection as any,
        concurrency: 5,
      }
    );

    outboxWorker.on("failed", (job, err) => {
      if (config.NODE_ENV !== "test") {
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);
      }
    });
  }

  return outboxWorker;
}

/**
 * Gracefully shuts down BullMQ queue, worker, and Redis connections.
 */
export async function closeOutboxQueue(): Promise<void> {
  if (outboxWorker) {
    await outboxWorker.close();
    outboxWorker = null;
  }
  if (outboxQueue) {
    await outboxQueue.close();
    outboxQueue = null;
  }
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
  }
}
