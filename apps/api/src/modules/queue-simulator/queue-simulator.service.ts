import { Job } from "bullmq";
import { sql } from "drizzle-orm";
import { config } from "../../config";
import { db, outboxEvents } from "../../db";
import {
  checkRedisHealth,
  getOutboxQueue,
  OUTBOX_QUEUE_NAME,
} from "../../jobs/outbox.queue";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors";
import { AuthenticatedUser } from "../../middleware/auth";
import { TriggerDemoJobInput } from "./queue-simulator.schemas";

export interface SafeQueueJob {
  id: string;
  name: string;
  isDemoJob: boolean;
  scenario: string;
  scenarioName: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  teamId?: string | null;
  triggeredByUserId?: string | null;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "unknown";
  recovered?: boolean;
}

export interface QueueHealthResponse {
  isAvailable: boolean;
  status: "HEALTHY" | "DEGRADED" | "DISCONNECTED";
  queueName: string;
  redisEndpoint: string;
  latencyMs: number | null;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  outboxDbStats: {
    pending: number;
    published: number;
    processed: number;
    failed: number;
  };
  error: string | null;
}

export class QueueSimulatorService {
  /**
   * Evaluates the connectivity and real-time statistics of the queue engine.
   * Accurately reflects Redis availability without fabricating statistics.
   */
  async getQueueHealth(): Promise<QueueHealthResponse> {
    const redisHealth = await checkRedisHealth();

    // Query transactional outbox status counts in Postgres as companion telemetry
    const outboxDbStats = {
      pending: 0,
      published: 0,
      processed: 0,
      failed: 0,
    };

    try {
      const dbCounts = await db
        .select({
          status: outboxEvents.status,
          count: sql<number>`count(*)::int`,
        })
        .from(outboxEvents)
        .groupBy(outboxEvents.status);

      for (const row of dbCounts) {
        if (row.status === "PENDING") outboxDbStats.pending = row.count;
        if (row.status === "PUBLISHED") outboxDbStats.published = row.count;
        if (row.status === "PROCESSED") outboxDbStats.processed = row.count;
        if (row.status === "FAILED") outboxDbStats.failed = row.count;
      }
    } catch (err: any) {
      console.warn("[QueueSimulator] Error fetching outbox DB stats:", err.message);
    }

    // Mask password in Redis URL if any
    const redisEndpoint = config.REDIS_URL.replace(/:[^@]+@/, ":****@");

    if (!redisHealth.connected) {
      return {
        isAvailable: false,
        status: "DISCONNECTED",
        queueName: OUTBOX_QUEUE_NAME,
        redisEndpoint,
        latencyMs: null,
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        outboxDbStats,
        error:
          redisHealth.error ||
          "Redis queue connection is unavailable. Ensure Redis is running via 'docker compose up -d'.",
      };
    }

    try {
      const queue = getOutboxQueue();
      const rawCounts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed"
      );

      const counts = {
        waiting: Number(rawCounts.waiting) || 0,
        active: Number(rawCounts.active) || 0,
        completed: Number(rawCounts.completed) || 0,
        failed: Number(rawCounts.failed) || 0,
        delayed: Number(rawCounts.delayed) || 0,
        paused: Number(rawCounts.paused) || 0,
      };

      return {
        isAvailable: true,
        status: counts.failed > 0 ? "DEGRADED" : "HEALTHY",
        queueName: OUTBOX_QUEUE_NAME,
        redisEndpoint,
        latencyMs: redisHealth.latencyMs,
        counts,
        outboxDbStats,
        error: null,
      };
    } catch (err: any) {
      return {
        isAvailable: false,
        status: "DISCONNECTED",
        queueName: OUTBOX_QUEUE_NAME,
        redisEndpoint,
        latencyMs: null,
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        outboxDbStats,
        error: `Queue metrics error: ${err.message}`,
      };
    }
  }

  /**
   * Formats a raw BullMQ job into a safe DTO, sanitizing sensitive payloads.
   */
  private async formatJob(job: Job, stateOverride?: string): Promise<SafeQueueJob> {
    let state = stateOverride;
    if (!state) {
      try {
        state = await job.getState();
      } catch {
        state = "unknown";
      }
    }

    return {
      id: String(job.id),
      name: job.name,
      isDemoJob: Boolean(job.data?.isDemoJob),
      scenario: job.data?.scenario || (job.data?.outboxEventId ? "OUTBOX_EVENT" : "CUSTOM"),
      scenarioName:
        job.data?.scenarioName ||
        (job.data?.outboxEventId
          ? `Outbox Event ${job.data.outboxEventId.substring(0, 8)}`
          : job.name),
      attemptsMade: job.attemptsMade || 0,
      maxAttempts: job.opts?.attempts || 1,
      failedReason: job.failedReason || null,
      timestamp: job.timestamp,
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null,
      teamId: job.data?.teamId || null,
      triggeredByUserId: job.data?.triggeredByUserId || null,
      state: (state as any) || "unknown",
      recovered: Boolean(job.data?.recovered),
    };
  }

  /**
   * Retrieves failed jobs for inspection without exposing credentials or internal tokens.
   */
  async getFailedJobs(limit = 25): Promise<SafeQueueJob[]> {
    const redisHealth = await checkRedisHealth();
    if (!redisHealth.connected) {
      return [];
    }

    const queue = getOutboxQueue();
    const rawJobs = await queue.getJobs(["failed"], 0, Math.max(limit - 1, 0), true);

    const safeJobs: SafeQueueJob[] = [];
    for (const job of rawJobs) {
      if (job) {
        safeJobs.push(await this.formatJob(job, "failed"));
      }
    }

    return safeJobs;
  }

  /**
   * Retrieves completed demo/outbox jobs for state transition inspection.
   */
  async getCompletedJobs(limit = 25): Promise<SafeQueueJob[]> {
    const redisHealth = await checkRedisHealth();
    if (!redisHealth.connected) {
      return [];
    }

    const queue = getOutboxQueue();
    const rawJobs = await queue.getJobs(["completed"], 0, Math.max(limit - 1, 0), true);

    const safeJobs: SafeQueueJob[] = [];
    for (const job of rawJobs) {
      if (job) {
        safeJobs.push(await this.formatJob(job, "completed"));
      }
    }

    return safeJobs;
  }

  /**
   * Triggers a controlled, predictable failure simulation job.
   * Safety constraint: Strictly disabled in production.
   */
  async simulateFailure(
    input: TriggerDemoJobInput,
    user: AuthenticatedUser
  ): Promise<SafeQueueJob> {
    if (config.NODE_ENV === "production") {
      throw new ForbiddenError("Failure simulation is strictly disabled in production");
    }

    const redisHealth = await checkRedisHealth();
    if (!redisHealth.connected) {
      throw new BadRequestError(
        "Redis is currently unavailable. Start Redis via 'docker compose up -d' to run queue simulations."
      );
    }

    const queue = getOutboxQueue();

    // Default messages by scenario
    let defaultMsg = "[SIMULATED] 504 Gateway Timeout: Downstream webhook notification provider unreachable";
    let defaultScenarioName = "Transient 504 Gateway Timeout";

    if (input.scenario === "RATE_LIMIT_EXCEEDED") {
      defaultMsg = "[SIMULATED] 429 Too Many Requests: Downstream provider rate limit quota exceeded";
      defaultScenarioName = "Rate Limit 429 Surge";
    } else if (input.scenario === "DOWNSTREAM_500") {
      defaultMsg = "[SIMULATED] 500 Internal Server Error: Remote notification webhook server crashed";
      defaultScenarioName = "Remote Server 500 Crash";
    }

    const scenarioName = input.scenarioName || defaultScenarioName;
    const errorMessage = input.errorMessage || defaultMsg;
    const simulateTransientRecovery = input.simulateTransientRecovery ?? true;

    // For transient recovery, set attempts to 2 so BullMQ retries once and self-heals
    const attempts = input.maxAttempts ?? (simulateTransientRecovery ? 2 : 1);

    const job = await queue.add(
      "DEMO_SIMULATION",
      {
        isDemoJob: true,
        scenario: input.scenario,
        scenarioName,
        errorMessage,
        simulateTransientRecovery,
        triggeredByUserId: user.id,
        teamId: input.teamId || null,
        recovered: false,
        timestamp: Date.now(),
      },
      {
        attempts,
        backoff: {
          type: "exponential",
          delay: 1500,
        },
        removeOnComplete: 200,
        removeOnFail: 500,
      }
    );

    return await this.formatJob(job);
  }

  /**
   * Replays/retries an eligible failed demo job using BullMQ's native retry mechanisms.
   * Safety constraint: Only demo simulation jobs can be replayed through this endpoint.
   */
  async retryJob(jobId: string, user: AuthenticatedUser): Promise<SafeQueueJob> {
    if (config.NODE_ENV === "production") {
      throw new ForbiddenError("Job replay simulator is strictly disabled in production");
    }

    const redisHealth = await checkRedisHealth();
    if (!redisHealth.connected) {
      throw new BadRequestError(
        "Redis is currently unavailable. Start Redis via 'docker compose up -d'."
      );
    }

    const queue = getOutboxQueue();
    const job = await queue.getJob(jobId);

    if (!job) {
      throw new NotFoundError(`Queue job with ID '${jobId}' not found`);
    }

    // Safety rule: Never replay arbitrary user jobs through an unrestricted endpoint
    if (!job.data?.isDemoJob) {
      throw new ForbiddenError(
        "Only controlled demo simulation jobs can be replayed through the simulator"
      );
    }

    // Mark as recovered so the worker succeeds upon retry
    await job.updateData({
      ...job.data,
      recovered: true,
      recoveredByUserId: user.id,
      recoveredAt: Date.now(),
    });

    // Replay the job using BullMQ's retry
    await job.retry("failed");

    return await this.formatJob(job);
  }

  /**
   * Safely cleans completed demo jobs to keep queue clean.
   */
  async cleanCompletedJobs(): Promise<{ cleanedCount: number }> {
    const redisHealth = await checkRedisHealth();
    if (!redisHealth.connected) {
      return { cleanedCount: 0 };
    }

    const queue = getOutboxQueue();
    const cleaned = await queue.clean(0, 1000, "completed");
    return { cleanedCount: cleaned.length };
  }
}

export const queueSimulatorService = new QueueSimulatorService();
