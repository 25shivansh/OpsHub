import {
  slaRiskEngine,
  BatchEvaluationResult,
} from "../modules/sla/sla-risk.engine";

let isEvaluating = false;
let slaSchedulerTimer: NodeJS.Timeout | null = null;

/**
 * Runs a single SLA evaluation sweep across active, unresolved items.
 * Uses an in-process concurrency guard to avoid overlapping sweeps.
 */
export async function evaluateSlaSweepOnce(options?: {
  now?: Date;
  batchSize?: number;
  teamId?: string;
}): Promise<BatchEvaluationResult | null> {
  if (isEvaluating) {
    return null;
  }

  isEvaluating = true;
  try {
    return await slaRiskEngine.evaluateActiveSlas(options);
  } finally {
    isEvaluating = false;
  }
}

/**
 * Starts the periodic SLA evaluation background scheduler.
 * Runs approximately once per minute independently of the outbox relay.
 * Idempotent: does not start duplicate timers if already running.
 */
export function startSlaEvaluationScheduler(intervalMs = 60000): void {
  if (slaSchedulerTimer) {
    return;
  }

  slaSchedulerTimer = setInterval(async () => {
    try {
      await evaluateSlaSweepOnce();
    } catch (err: any) {
      console.error(
        "[SlaScheduler] Error in periodic evaluation sweep:",
        err.message
      );
    }
  }, intervalMs);
}

/**
 * Stops the periodic SLA evaluation scheduler and clears the background timer.
 */
export function stopSlaEvaluationScheduler(): void {
  if (slaSchedulerTimer) {
    clearInterval(slaSchedulerTimer);
    slaSchedulerTimer = null;
  }
}

/**
 * Returns whether the SLA scheduler is currently active.
 */
export function isSlaSchedulerRunning(): boolean {
  return slaSchedulerTimer !== null;
}
