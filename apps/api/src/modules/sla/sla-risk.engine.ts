import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  workItemSlas,
  workItems,
  activityEvents,
  outboxEvents,
  WorkItemSla,
} from "../../db";

export type SlaRiskState = "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED";

export interface SlaEvaluationResult {
  workItemId: string;
  policyId: string | null;
  riskState: SlaRiskState;

  // Independent Response Compliance
  responseStatus: "MET" | "BREACHED" | "PENDING";
  firstRespondedAt: Date | null;
  responseDeadline: Date;
  isResponseBreached: boolean;

  // Independent Resolution Compliance
  resolutionStatus: "MET" | "BREACHED" | "IN_PROGRESS";
  resolvedAt: Date | null;
  resolutionDeadline: Date;
  isResolutionBreached: boolean;

  // Countdown and Auditing Timestamps
  timeRemainingSeconds: number;
  breachedAt: Date | null;
  notifiedAtRiskAt: Date | null;
  notifiedBreachedAt: Date | null;

  // Overall compliance flag (true iff both response & resolution targets were met on time)
  isCompliant: boolean;
}

export interface BatchTransition {
  workItemId: string;
  previousRiskState: SlaRiskState;
  newRiskState: SlaRiskState;
  eventType?: "SLA_WARNING" | "SLA_BREACHED";
}

export interface BatchEvaluationResult {
  evaluatedCount: number;
  transitionsCount: number;
  transitions: BatchTransition[];
}

/**
 * Pure calculation function for evaluating an SLA record against a reference timestamp.
 * Deterministic and clock-injectable for precision testing.
 */
export function calculateSlaRisk(
  sla: WorkItemSla,
  now: Date = new Date()
): SlaEvaluationResult {
  const nowTime = now.getTime();
  const respDeadlineTime = sla.responseDeadline.getTime();
  const resDeadlineTime = sla.resolutionDeadline.getTime();

  // 1. Independent Response Target Evaluation
  let isResponseBreached = false;
  let responseStatus: "MET" | "BREACHED" | "PENDING" = "PENDING";

  if (sla.firstRespondedAt !== null) {
    isResponseBreached = sla.firstRespondedAt.getTime() > respDeadlineTime;
    responseStatus = isResponseBreached ? "BREACHED" : "MET";
  } else if (sla.resolvedAt !== null) {
    // If resolved without an explicit earlier response, the resolution timestamp serves as response
    isResponseBreached = sla.resolvedAt.getTime() > respDeadlineTime;
    responseStatus = isResponseBreached ? "BREACHED" : "MET";
  } else {
    // Still awaiting initial response
    isResponseBreached = nowTime > respDeadlineTime;
    responseStatus = isResponseBreached ? "BREACHED" : "PENDING";
  }

  // 2. Independent Resolution Target Evaluation
  let isResolutionBreached = false;
  let resolutionStatus: "MET" | "BREACHED" | "IN_PROGRESS" = "IN_PROGRESS";

  if (sla.resolvedAt !== null) {
    isResolutionBreached = sla.resolvedAt.getTime() > resDeadlineTime;
    resolutionStatus = isResolutionBreached ? "BREACHED" : "MET";
  } else {
    isResolutionBreached = nowTime > resDeadlineTime;
    resolutionStatus = isResolutionBreached ? "BREACHED" : "IN_PROGRESS";
  }

  // 3. Overall Risk State Determination
  let riskState: SlaRiskState;

  if (sla.resolvedAt !== null) {
    // Terminal state: item is resolved or closed
    riskState = "COMPLETED";
  } else if (isResponseBreached || isResolutionBreached) {
    // Active item with any missed target
    riskState = "BREACHED";
  } else {
    // Active item within all deadlines: check warning threshold
    const totalAllowedMs = sla.resolutionTargetMinutes * 60 * 1000;
    const warningAtTime =
      resDeadlineTime -
      totalAllowedMs * (1 - sla.warningThresholdPercent / 100);

    if (nowTime >= warningAtTime) {
      riskState = "AT_RISK";
    } else {
      riskState = "ON_TRACK";
    }
  }

  // 4. Time Remaining (to resolution deadline)
  const timeRemainingSeconds = Math.max(
    0,
    Math.floor((resDeadlineTime - nowTime) / 1000)
  );

  // 5. Breached Timestamp calculation
  let breachedAt = sla.breachedAt;
  if (!breachedAt && (isResponseBreached || isResolutionBreached)) {
    if (isResponseBreached && isResolutionBreached) {
      breachedAt = new Date(Math.min(respDeadlineTime, resDeadlineTime));
    } else if (isResponseBreached) {
      breachedAt = sla.responseDeadline;
    } else {
      breachedAt = sla.resolutionDeadline;
    }
  }

  return {
    workItemId: sla.workItemId,
    policyId: sla.policyId,
    riskState,
    responseStatus,
    firstRespondedAt: sla.firstRespondedAt,
    responseDeadline: sla.responseDeadline,
    isResponseBreached,
    resolutionStatus,
    resolvedAt: sla.resolvedAt,
    resolutionDeadline: sla.resolutionDeadline,
    isResolutionBreached,
    timeRemainingSeconds,
    breachedAt,
    notifiedAtRiskAt: sla.notifiedAtRiskAt,
    notifiedBreachedAt: sla.notifiedBreachedAt,
    isCompliant: !isResponseBreached && !isResolutionBreached,
  };
}

export class SlaRiskEngine {
  /**
   * Evaluates a single work item's SLA and conditionally updates the database
   * if the risk state transitioned.
   */
  async evaluateWorkItemSla(
    workItemId: string,
    options?: { now?: Date; tx?: any }
  ): Promise<SlaEvaluationResult | null> {
    const tx = options?.tx ?? db;
    const now = options?.now ?? new Date();

    const [sla] = await tx
      .select()
      .from(workItemSlas)
      .where(eq(workItemSlas.workItemId, workItemId))
      .limit(1);

    if (!sla) {
      return null;
    }

    const evaluation = calculateSlaRisk(sla, now);

    // Apply conditional state transition if risk state changed
    if (evaluation.riskState !== sla.riskState) {
      const [item] = await tx
        .select({ teamId: workItems.teamId })
        .from(workItems)
        .where(eq(workItems.id, workItemId))
        .limit(1);
      const teamId = item?.teamId;

      if (evaluation.riskState === "AT_RISK" && !sla.notifiedAtRiskAt) {
        const [updated] = await tx
          .update(workItemSlas)
          .set({
            riskState: "AT_RISK",
            notifiedAtRiskAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(workItemSlas.id, sla.id),
              eq(workItemSlas.riskState, sla.riskState),
              isNull(workItemSlas.notifiedAtRiskAt)
            )
          )
          .returning();

        if (updated) {
          const [activity] = await tx
            .insert(activityEvents)
            .values({
              itemId: sla.workItemId,
              actorId: null,
              eventType: "SLA_WARNING",
              oldValue: { riskState: sla.riskState },
              newValue: { riskState: "AT_RISK" },
              metadata: {
                policyId: sla.policyId,
                warningThresholdPercent: sla.warningThresholdPercent,
                resolutionDeadline: sla.resolutionDeadline,
              },
            })
            .returning();

          await tx.insert(outboxEvents).values({
            activityEventId: activity.id,
            eventType: "SLA_WARNING",
            payload: {
              itemId: sla.workItemId,
              teamId,
              actorId: null,
              riskState: "AT_RISK",
              resolutionDeadline: sla.resolutionDeadline,
            },
            status: "PENDING",
          });
        }
      } else if (
        evaluation.riskState === "BREACHED" &&
        !sla.notifiedBreachedAt
      ) {
        const breachedAtTimestamp =
          sla.breachedAt ?? evaluation.breachedAt ?? now;

        const [updated] = await tx
          .update(workItemSlas)
          .set({
            riskState: "BREACHED",
            breachedAt: breachedAtTimestamp,
            notifiedBreachedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(workItemSlas.id, sla.id),
              eq(workItemSlas.riskState, sla.riskState),
              isNull(workItemSlas.notifiedBreachedAt)
            )
          )
          .returning();

        if (updated) {
          const [activity] = await tx
            .insert(activityEvents)
            .values({
              itemId: sla.workItemId,
              actorId: null,
              eventType: "SLA_BREACHED",
              oldValue: { riskState: sla.riskState },
              newValue: {
                riskState: "BREACHED",
                breachedAt: breachedAtTimestamp,
              },
              metadata: {
                policyId: sla.policyId,
                responseStatus: evaluation.responseStatus,
                resolutionStatus: evaluation.resolutionStatus,
                breachedAt: breachedAtTimestamp,
              },
            })
            .returning();

          await tx.insert(outboxEvents).values({
            activityEventId: activity.id,
            eventType: "SLA_BREACHED",
            payload: {
              itemId: sla.workItemId,
              teamId,
              actorId: null,
              riskState: "BREACHED",
              breachedAt: breachedAtTimestamp,
              responseStatus: evaluation.responseStatus,
              resolutionStatus: evaluation.resolutionStatus,
            },
            status: "PENDING",
          });
        }
      } else {
        await tx
          .update(workItemSlas)
          .set({
            riskState: evaluation.riskState,
            updatedAt: now,
          })
          .where(
            and(
              eq(workItemSlas.id, sla.id),
              eq(workItemSlas.riskState, sla.riskState)
            )
          );
      }
    }

    return evaluation;
  }

  /**
   * Evaluates active, unresolved SLAs in bulk with concurrency protection.
   * Uses targeted queries on active items ordered by nearest resolution deadline.
   */
  async evaluateActiveSlas(options?: {
    now?: Date;
    batchSize?: number;
    teamId?: string;
  }): Promise<BatchEvaluationResult> {
    const now = options?.now ?? new Date();
    const batchSize = options?.batchSize ?? 100;

    // 1. Fetch active, unresolved SLA records
    const conditions = [
      ne(workItemSlas.riskState, "COMPLETED"),
      isNull(workItemSlas.resolvedAt),
    ];

    if (options?.teamId) {
      // Team-scoped filtering via work_items join
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${workItems}
          WHERE ${workItems.id} = ${workItemSlas.workItemId}
            AND ${workItems.teamId} = ${options.teamId}
        )`
      );
    }

    const activeSlas = await db
      .select({
        sla: workItemSlas,
        teamId: workItems.teamId,
      })
      .from(workItemSlas)
      .innerJoin(workItems, eq(workItems.id, workItemSlas.workItemId))
      .where(and(...conditions))
      .orderBy(asc(workItemSlas.resolutionDeadline))
      .limit(batchSize);

    const transitions: BatchTransition[] = [];

    // 2. Evaluate each active SLA individually in bounded short transactions
    for (const { sla, teamId } of activeSlas) {
      try {
        const evaluation = calculateSlaRisk(sla, now);

        if (evaluation.riskState === sla.riskState) {
          continue;
        }

        if (evaluation.riskState === "AT_RISK" && !sla.notifiedAtRiskAt) {
          await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(workItemSlas)
              .set({
                riskState: "AT_RISK",
                notifiedAtRiskAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(workItemSlas.id, sla.id),
                  eq(workItemSlas.riskState, sla.riskState),
                  isNull(workItemSlas.notifiedAtRiskAt)
                )
              )
              .returning();

            if (!updated) {
              return;
            }

            const [activity] = await tx
              .insert(activityEvents)
              .values({
                itemId: sla.workItemId,
                actorId: null,
                eventType: "SLA_WARNING",
                oldValue: { riskState: sla.riskState },
                newValue: { riskState: "AT_RISK" },
                metadata: {
                  policyId: sla.policyId,
                  warningThresholdPercent: sla.warningThresholdPercent,
                  resolutionDeadline: sla.resolutionDeadline,
                },
              })
              .returning();

            await tx.insert(outboxEvents).values({
              activityEventId: activity.id,
              eventType: "SLA_WARNING",
              payload: {
                itemId: sla.workItemId,
                teamId,
                actorId: null,
                riskState: "AT_RISK",
                resolutionDeadline: sla.resolutionDeadline,
              },
              status: "PENDING",
            });

            transitions.push({
              workItemId: sla.workItemId,
              previousRiskState: sla.riskState as SlaRiskState,
              newRiskState: "AT_RISK",
              eventType: "SLA_WARNING",
            });
          });
        } else if (
          evaluation.riskState === "BREACHED" &&
          !sla.notifiedBreachedAt
        ) {
          const breachedAtTimestamp =
            sla.breachedAt ?? evaluation.breachedAt ?? now;

          await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(workItemSlas)
              .set({
                riskState: "BREACHED",
                breachedAt: breachedAtTimestamp,
                notifiedBreachedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(workItemSlas.id, sla.id),
                  eq(workItemSlas.riskState, sla.riskState),
                  isNull(workItemSlas.notifiedBreachedAt)
                )
              )
              .returning();

            if (!updated) {
              return;
            }

            const [activity] = await tx
              .insert(activityEvents)
              .values({
                itemId: sla.workItemId,
                actorId: null,
                eventType: "SLA_BREACHED",
                oldValue: { riskState: sla.riskState },
                newValue: {
                  riskState: "BREACHED",
                  breachedAt: breachedAtTimestamp,
                },
                metadata: {
                  policyId: sla.policyId,
                  responseStatus: evaluation.responseStatus,
                  resolutionStatus: evaluation.resolutionStatus,
                  breachedAt: breachedAtTimestamp,
                },
              })
              .returning();

            await tx.insert(outboxEvents).values({
              activityEventId: activity.id,
              eventType: "SLA_BREACHED",
              payload: {
                itemId: sla.workItemId,
                teamId,
                actorId: null,
                riskState: "BREACHED",
                breachedAt: breachedAtTimestamp,
                responseStatus: evaluation.responseStatus,
                resolutionStatus: evaluation.resolutionStatus,
              },
              status: "PENDING",
            });

            transitions.push({
              workItemId: sla.workItemId,
              previousRiskState: sla.riskState as SlaRiskState,
              newRiskState: "BREACHED",
              eventType: "SLA_BREACHED",
            });
          });
        } else {
          // General transition without new notification (e.g. COMPLETED or already notified)
          const [updated] = await db
            .update(workItemSlas)
            .set({
              riskState: evaluation.riskState,
              updatedAt: now,
            })
            .where(
              and(
                eq(workItemSlas.id, sla.id),
                eq(workItemSlas.riskState, sla.riskState)
              )
            )
            .returning();

          if (updated) {
            transitions.push({
              workItemId: sla.workItemId,
              previousRiskState: sla.riskState as SlaRiskState,
              newRiskState: evaluation.riskState,
            });
          }
        }
      } catch (itemErr: any) {
        console.error(
          `[SlaRiskEngine] Error evaluating SLA for work item ${sla.workItemId}:`,
          itemErr.message
        );
      }
    }

    return {
      evaluatedCount: activeSlas.length,
      transitionsCount: transitions.length,
      transitions,
    };
  }
}

export const slaRiskEngine = new SlaRiskEngine();
