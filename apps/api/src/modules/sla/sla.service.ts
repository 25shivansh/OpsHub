import { and, desc, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  slaPolicies,
  workItemSlas,
  workItems,
  SlaPolicy,
  WorkItemSla,
  WorkItem,
} from "../../db";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors";
import {
  CreateSlaPolicyInput,
  UpdateSlaPolicyInput,
} from "./sla.schemas";

export class SlaService {
  /**
   * Resolves the applicable active team SLA policy using the established deterministic
   * specificity order:
   * 1. Exact work-item type + exact priority (Rank 1)
   * 2. Exact priority with wildcard type (Rank 2)
   * 3. Exact type with wildcard priority (Rank 3)
   * 4. Team-wide catch-all policy (Rank 4)
   *
   * If no policy matches, returns null.
   */
  async resolveApplicablePolicy(
    teamId: string,
    workItemType: string,
    priority: string,
    tx: any = db
  ): Promise<SlaPolicy | null> {
    const [policy] = await tx
      .select()
      .from(slaPolicies)
      .where(
        and(
          eq(slaPolicies.teamId, teamId),
          eq(slaPolicies.isActive, true),
          or(
            eq(slaPolicies.workItemType, workItemType as any),
            isNull(slaPolicies.workItemType)
          ),
          or(
            eq(slaPolicies.priority, priority as any),
            isNull(slaPolicies.priority)
          )
        )
      )
      .orderBy(
        sql`CASE
          WHEN ${slaPolicies.workItemType} IS NOT NULL AND ${slaPolicies.priority} IS NOT NULL THEN 1
          WHEN ${slaPolicies.priority} IS NOT NULL AND ${slaPolicies.workItemType} IS NULL THEN 2
          WHEN ${slaPolicies.workItemType} IS NOT NULL AND ${slaPolicies.priority} IS NULL THEN 3
          ELSE 4
        END ASC`
      )
      .limit(1);

    return policy ?? null;
  }

  /**
   * Creates an SLA snapshot for an eligible newly created work item.
   * If no active policy matches the item's team, type, and priority, returns null
   * without creating a false SLA record.
   */
  async createSlaSnapshot(
    workItem: WorkItem,
    tx: any = db,
    options?: { customStartTime?: Date }
  ): Promise<WorkItemSla | null> {
    const policy = await this.resolveApplicablePolicy(
      workItem.teamId,
      workItem.type,
      workItem.priority,
      tx
    );

    if (!policy) {
      return null;
    }

    const startTime = options?.customStartTime ?? workItem.createdAt ?? new Date();
    const responseDeadline = new Date(
      startTime.getTime() + policy.responseTargetMinutes * 60 * 1000
    );
    const resolutionDeadline = new Date(
      startTime.getTime() + policy.resolutionTargetMinutes * 60 * 1000
    );

    // If item was created with an assignee already or already in progress,
    // first response target is satisfied at creation time.
    let firstRespondedAt: Date | null = null;
    if (workItem.assigneeId || workItem.status !== "OPEN") {
      firstRespondedAt = startTime;
    }

    const [snapshot] = await tx
      .insert(workItemSlas)
      .values({
        workItemId: workItem.id,
        policyId: policy.id,
        riskState: "ON_TRACK",
        responseTargetMinutes: policy.responseTargetMinutes,
        resolutionTargetMinutes: policy.resolutionTargetMinutes,
        warningThresholdPercent: policy.warningThresholdPercent,
        responseDeadline,
        resolutionDeadline,
        firstRespondedAt,
        resolvedAt: null,
        breachedAt: null,
      })
      .returning();

    return snapshot;
  }

  /**
   * Records the first response timestamp for an SLA when an item is claimed, assigned,
   * or moved to IN_PROGRESS.
   *
   * Invariant: Never resets a previously recorded first response timestamp.
   */
  async recordFirstResponse(
    workItemId: string,
    timestamp: Date = new Date(),
    tx: any = db
  ): Promise<WorkItemSla | null> {
    const [sla] = await tx
      .select()
      .from(workItemSlas)
      .where(eq(workItemSlas.workItemId, workItemId))
      .limit(1);

    if (!sla) {
      return null;
    }

    // Never reset a previously recorded first response timestamp
    if (sla.firstRespondedAt) {
      return sla;
    }

    const isLateResponse = timestamp.getTime() > sla.responseDeadline.getTime();
    const updatePayload: Record<string, any> = {
      firstRespondedAt: timestamp,
      updatedAt: new Date(),
    };

    if (isLateResponse && sla.riskState !== "COMPLETED") {
      updatePayload.riskState = "BREACHED";
      if (!sla.breachedAt) {
        updatePayload.breachedAt = sla.responseDeadline;
      }
    }

    const [updated] = await tx
      .update(workItemSlas)
      .set(updatePayload)
      .where(
        and(
          eq(workItemSlas.id, sla.id),
          isNull(workItemSlas.firstRespondedAt)
        )
      )
      .returning();

    return updated ?? sla;
  }

  /**
   * Records resolution timestamp and sets risk state to COMPLETED when an item
   * transitions to RESOLVED or CLOSED.
   *
   * Invariant: If resolved after resolutionDeadline, records the breach timestamp
   * so historical SLA compliance is preserved accurately.
   */
  async recordResolution(
    workItemId: string,
    timestamp: Date = new Date(),
    tx: any = db
  ): Promise<WorkItemSla | null> {
    const [sla] = await tx
      .select()
      .from(workItemSlas)
      .where(eq(workItemSlas.workItemId, workItemId))
      .limit(1);

    if (!sla) {
      return null;
    }

    const resolvedAt = timestamp;
    const isLateResolution = resolvedAt.getTime() > sla.resolutionDeadline.getTime();

    // If not already breached, but resolving late, record breach timestamp as deadline
    let breachedAt = sla.breachedAt;
    if (isLateResolution && !breachedAt) {
      breachedAt = sla.resolutionDeadline;
    }

    // If first response was never recorded, check if it was breached
    let firstRespondedAt = sla.firstRespondedAt;
    if (!firstRespondedAt) {
      firstRespondedAt = resolvedAt;
      if (firstRespondedAt.getTime() > sla.responseDeadline.getTime() && !breachedAt) {
        breachedAt = sla.responseDeadline;
      }
    }

    const [updated] = await tx
      .update(workItemSlas)
      .set({
        resolvedAt,
        riskState: "COMPLETED",
        breachedAt,
        firstRespondedAt,
        updatedAt: new Date(),
      })
      .where(eq(workItemSlas.id, sla.id))
      .returning();

    return updated ?? sla;
  }

  /**
   * Retrieves the SLA record for a given work item.
   */
  async getWorkItemSla(
    workItemId: string,
    tx: any = db
  ): Promise<WorkItemSla | null> {
    const [sla] = await tx
      .select()
      .from(workItemSlas)
      .where(eq(workItemSlas.workItemId, workItemId))
      .limit(1);

    return sla ?? null;
  }

  /**
   * Lists all SLA policies for a team, ordered by creation date descending.
   */
  async listPolicies(teamId: string, tx: any = db): Promise<SlaPolicy[]> {
    return await tx
      .select()
      .from(slaPolicies)
      .where(eq(slaPolicies.teamId, teamId))
      .orderBy(desc(slaPolicies.createdAt));
  }

  /**
   * Retrieves a single SLA policy by team and policy ID.
   */
  async getPolicyById(
    teamId: string,
    policyId: string,
    tx: any = db
  ): Promise<SlaPolicy> {
    const [policy] = await tx
      .select()
      .from(slaPolicies)
      .where(
        and(eq(slaPolicies.id, policyId), eq(slaPolicies.teamId, teamId))
      )
      .limit(1);

    if (!policy) {
      throw new NotFoundError("SLA policy not found for this team");
    }

    return policy;
  }

  /**
   * Checks whether an active policy with the identical specificity (type and priority)
   * already exists for the given team, avoiding active policy collisions.
   */
  async checkActivePolicyConflict(
    teamId: string,
    workItemType: string | null | undefined,
    priority: string | null | undefined,
    excludePolicyId?: string,
    tx: any = db
  ): Promise<boolean> {
    const conditions = [
      eq(slaPolicies.teamId, teamId),
      eq(slaPolicies.isActive, true),
    ];

    if (excludePolicyId) {
      conditions.push(sql`${slaPolicies.id} != ${excludePolicyId}`);
    }

    if (workItemType) {
      conditions.push(eq(slaPolicies.workItemType, workItemType as any));
    } else {
      conditions.push(isNull(slaPolicies.workItemType));
    }

    if (priority) {
      conditions.push(eq(slaPolicies.priority, priority as any));
    } else {
      conditions.push(isNull(slaPolicies.priority));
    }

    const [existing] = await tx
      .select({ id: slaPolicies.id })
      .from(slaPolicies)
      .where(and(...conditions))
      .limit(1);

    return !!existing;
  }

  /**
   * Creates a new SLA policy for a team after checking for active specificity conflicts.
   */
  async createPolicy(
    teamId: string,
    input: CreateSlaPolicyInput,
    tx: any = db
  ): Promise<SlaPolicy> {
    const isActive = input.isActive ?? true;

    if (isActive) {
      const hasConflict = await this.checkActivePolicyConflict(
        teamId,
        input.workItemType,
        input.priority,
        undefined,
        tx
      );
      if (hasConflict) {
        throw new ConflictError(
          "An active policy with the same specificity already exists for this team."
        );
      }
    }

    try {
      const [policy] = await tx
        .insert(slaPolicies)
        .values({
          teamId,
          name: input.name,
          description: input.description ?? null,
          workItemType: (input.workItemType as any) ?? null,
          priority: (input.priority as any) ?? null,
          responseTargetMinutes: input.responseTargetMinutes,
          resolutionTargetMinutes: input.resolutionTargetMinutes,
          warningThresholdPercent: input.warningThresholdPercent ?? 75,
          isActive,
        })
        .returning();

      return policy;
    } catch (err: any) {
      if (err.code === "23505") {
        throw new ConflictError(
          "An active policy with the same specificity already exists for this team."
        );
      }
      throw err;
    }
  }

  /**
   * Updates mutable fields of an existing SLA policy.
   * Guarantees that historical work item SLA snapshots and precomputed deadlines
   * are never modified retrospectively.
   */
  async updatePolicy(
    teamId: string,
    policyId: string,
    input: UpdateSlaPolicyInput,
    tx: any = db
  ): Promise<SlaPolicy> {
    const existing = await this.getPolicyById(teamId, policyId, tx);

    const responseTarget =
      input.responseTargetMinutes ?? existing.responseTargetMinutes;
    const resolutionTarget =
      input.resolutionTargetMinutes ?? existing.resolutionTargetMinutes;

    if (resolutionTarget < responseTarget) {
      throw new BadRequestError(
        "Resolution target minutes must be greater than or equal to response target minutes"
      );
    }

    const [updated] = await tx
      .update(slaPolicies)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.responseTargetMinutes !== undefined
          ? { responseTargetMinutes: input.responseTargetMinutes }
          : {}),
        ...(input.resolutionTargetMinutes !== undefined
          ? { resolutionTargetMinutes: input.resolutionTargetMinutes }
          : {}),
        ...(input.warningThresholdPercent !== undefined
          ? { warningThresholdPercent: input.warningThresholdPercent }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(slaPolicies.id, policyId))
      .returning();

    return updated;
  }

  /**
   * Toggles the active status of an SLA policy.
   * When activating, validates that no other active policy at the same specificity exists.
   * When deactivating, preserves all historical SLA snapshots without deletion or modification.
   */
  async togglePolicyActive(
    teamId: string,
    policyId: string,
    isActive: boolean,
    tx: any = db
  ): Promise<SlaPolicy> {
    const existing = await this.getPolicyById(teamId, policyId, tx);

    if (existing.isActive === isActive) {
      return existing;
    }

    if (isActive) {
      const hasConflict = await this.checkActivePolicyConflict(
        teamId,
        existing.workItemType,
        existing.priority,
        policyId,
        tx
      );
      if (hasConflict) {
        throw new ConflictError(
          "Cannot activate policy: another active policy with the same specificity already exists for this team."
        );
      }
    }

    try {
      const [updated] = await tx
        .update(slaPolicies)
        .set({
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(slaPolicies.id, policyId))
        .returning();

      return updated;
    } catch (err: any) {
      if (err.code === "23505") {
        throw new ConflictError(
          "Cannot activate policy: another active policy with the same specificity already exists for this team."
        );
      }
      throw err;
    }
  }

  /**
   * Safely deletes an SLA policy.
   * If any work item SLA snapshots reference this policy, deletion is blocked
   * with a 409 Conflict instructing the user to deactivate the policy instead,
   * preserving historical audit integrity.
   */
  async deletePolicy(
    teamId: string,
    policyId: string,
    tx: any = db
  ): Promise<{ success: boolean; message: string }> {
    await this.getPolicyById(teamId, policyId, tx);

    // Check if any workItemSlas reference this policyId
    const [referenced] = await tx
      .select({ id: workItemSlas.id })
      .from(workItemSlas)
      .where(eq(workItemSlas.policyId, policyId))
      .limit(1);

    if (referenced) {
      throw new ConflictError(
        "Cannot delete policy: it is referenced by existing work item SLA snapshots. Deactivate the policy instead to preserve historical audit integrity."
      );
    }

    await tx.delete(slaPolicies).where(eq(slaPolicies.id, policyId));

    return { success: true, message: "Policy deleted successfully" };
  }

  /**
   * Computes real-time, team-scoped SLA metrics and historical compliance rates
   * using indexed aggregation over tracked work items and SLA records.
   */
  async getTeamMetrics(
    teamId: string,
    tx: any = db
  ): Promise<{
    totalPolicies: number;
    activePolicies: number;
    totalSlas: number;
    activeSlas: number;
    onTrackCount: number;
    atRiskCount: number;
    breachedCount: number;
    completedCount: number;
    responseCompliance: {
      eligible: number;
      compliant: number;
      rate: number | null;
    };
    resolutionCompliance: {
      eligible: number;
      compliant: number;
      rate: number | null;
    };
  }> {
    const [policySummary] = await tx
      .select({
        totalPolicies: sql<number>`count(*)::int`,
        activePolicies: sql<number>`count(*) filter (where ${slaPolicies.isActive} = true)::int`,
      })
      .from(slaPolicies)
      .where(eq(slaPolicies.teamId, teamId));

    const [summary] = await tx
      .select({
        totalSlas: sql<number>`count(*)::int`,
        activeSlas: sql<number>`count(*) filter (where ${workItemSlas.resolvedAt} is null and ${workItemSlas.riskState} != 'COMPLETED')::int`,
        onTrackCount: sql<number>`count(*) filter (where ${workItemSlas.riskState} = 'ON_TRACK' and ${workItemSlas.resolvedAt} is null)::int`,
        atRiskCount: sql<number>`count(*) filter (where ${workItemSlas.riskState} = 'AT_RISK' and ${workItemSlas.resolvedAt} is null)::int`,
        breachedCount: sql<number>`count(*) filter (where ${workItemSlas.riskState} = 'BREACHED' and ${workItemSlas.resolvedAt} is null)::int`,
        completedCount: sql<number>`count(*) filter (where ${workItemSlas.riskState} = 'COMPLETED' or ${workItemSlas.resolvedAt} is not null)::int`,
        responseEligible: sql<number>`count(*) filter (where ${workItemSlas.firstRespondedAt} is not null or ${workItemSlas.responseDeadline} < now())::int`,
        responseCompliant: sql<number>`count(*) filter (where ${workItemSlas.firstRespondedAt} is not null and ${workItemSlas.firstRespondedAt} <= ${workItemSlas.responseDeadline})::int`,
        resolutionEligible: sql<number>`count(*) filter (where ${workItemSlas.resolvedAt} is not null or ${workItemSlas.resolutionDeadline} < now())::int`,
        resolutionCompliant: sql<number>`count(*) filter (where ${workItemSlas.resolvedAt} is not null and ${workItemSlas.resolvedAt} <= ${workItemSlas.resolutionDeadline})::int`,
      })
      .from(workItemSlas)
      .innerJoin(workItems, eq(workItemSlas.workItemId, workItems.id))
      .where(eq(workItems.teamId, teamId));

    const respEligible = summary?.responseEligible ?? 0;
    const respCompliant = summary?.responseCompliant ?? 0;
    const resEligible = summary?.resolutionEligible ?? 0;
    const resCompliant = summary?.resolutionCompliant ?? 0;

    return {
      totalPolicies: policySummary?.totalPolicies ?? 0,
      activePolicies: policySummary?.activePolicies ?? 0,
      totalSlas: summary?.totalSlas ?? 0,
      activeSlas: summary?.activeSlas ?? 0,
      onTrackCount: summary?.onTrackCount ?? 0,
      atRiskCount: summary?.atRiskCount ?? 0,
      breachedCount: summary?.breachedCount ?? 0,
      completedCount: summary?.completedCount ?? 0,
      responseCompliance: {
        eligible: respEligible,
        compliant: respCompliant,
        rate:
          respEligible > 0
            ? Math.round((respCompliant / respEligible) * 1000) / 10
            : null,
      },
      resolutionCompliance: {
        eligible: resEligible,
        compliant: resCompliant,
        rate:
          resEligible > 0
            ? Math.round((resCompliant / resEligible) * 1000) / 10
            : null,
      },
    };
  }
}

export const slaService = new SlaService();
