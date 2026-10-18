import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql, inArray } from "drizzle-orm";
import {
  db,
  closeDb,
  users,
  teams,
  teamMemberships,
  workItems,
  slaPolicies,
  workItemSlas,
  WorkItemSla,
} from "../src/db";
import { slaService } from "../src/modules/sla/sla.service";
import {
  slaRiskEngine,
  calculateSlaRisk,
} from "../src/modules/sla/sla-risk.engine";
import { workItemsService } from "../src/modules/work-items/work-items.service";
import { AuthenticatedUser } from "../src/middleware/auth";

describe("Newtonite Feature 2: SLA Risk Engine", () => {
  let testTeamId: string;
  let emptyTeamId: string;
  let testUserId: string;
  let testUser: AuthenticatedUser;

  let tier1PolicyId: string;
  let tier2PolicyId: string;
  let tier3PolicyId: string;
  let tier4PolicyId: string;

  const createdWorkItemIds: string[] = [];

  beforeAll(async () => {
    // 1. Get or create test user
    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`${users.email} = 'admin@newtonite.dev'`)
      .limit(1);

    if (existingUser) {
      testUserId = existingUser.id;
    } else {
      const [newUser] = await db
        .insert(users)
        .values({
          name: "SLA Test User",
          email: "sla-test-user@newtonite.dev",
          passwordHash: "dummyhash",
          isActive: true,
        })
        .returning();
      testUserId = newUser.id;
    }

    testUser = {
      id: testUserId,
      email: "admin@newtonite.dev",
      role: "ADMIN",
    };

    // 2. Create dedicated isolated test teams
    const slugSuffix = Date.now().toString(36);
    const [team] = await db
      .insert(teams)
      .values({
        name: `SLA Test Team ${slugSuffix}`,
        slug: `sla-team-${slugSuffix}`,
      })
      .returning();
    testTeamId = team.id;

    const [emptyTeam] = await db
      .insert(teams)
      .values({
        name: `SLA Empty Team ${slugSuffix}`,
        slug: `sla-empty-${slugSuffix}`,
      })
      .returning();
    emptyTeamId = emptyTeam.id;

    // Associate test user with teams
    await db.insert(teamMemberships).values([
      { userId: testUserId, teamId: testTeamId, role: "ADMIN" },
      { userId: testUserId, teamId: emptyTeamId, role: "ADMIN" },
    ]);

    // 3. Create policies for all 4 specificity tiers in testTeam
    // Tier 1: Exact type (INCIDENT) + exact priority (URGENT)
    const [t1] = await db
      .insert(slaPolicies)
      .values({
        teamId: testTeamId,
        name: "Tier 1: Incident Urgent Policy",
        workItemType: "INCIDENT",
        priority: "URGENT",
        responseTargetMinutes: 15,
        resolutionTargetMinutes: 60,
        warningThresholdPercent: 75,
        isActive: true,
      })
      .returning();
    tier1PolicyId = t1.id;

    // Tier 2: Wildcard type (null) + exact priority (URGENT)
    const [t2] = await db
      .insert(slaPolicies)
      .values({
        teamId: testTeamId,
        name: "Tier 2: Any Type Urgent Policy",
        workItemType: null,
        priority: "URGENT",
        responseTargetMinutes: 30,
        resolutionTargetMinutes: 120,
        warningThresholdPercent: 75,
        isActive: true,
      })
      .returning();
    tier2PolicyId = t2.id;

    // Tier 3: Exact type (REQUEST) + wildcard priority (null)
    const [t3] = await db
      .insert(slaPolicies)
      .values({
        teamId: testTeamId,
        name: "Tier 3: Request Any Priority Policy",
        workItemType: "REQUEST",
        priority: null,
        responseTargetMinutes: 45,
        resolutionTargetMinutes: 180,
        warningThresholdPercent: 80,
        isActive: true,
      })
      .returning();
    tier3PolicyId = t3.id;

    // Tier 4: Team-wide Catch-all (both null)
    const [t4] = await db
      .insert(slaPolicies)
      .values({
        teamId: testTeamId,
        name: "Tier 4: Catch-all Default Policy",
        workItemType: null,
        priority: null,
        responseTargetMinutes: 120,
        resolutionTargetMinutes: 480,
        warningThresholdPercent: 70,
        isActive: true,
      })
      .returning();
    tier4PolicyId = t4.id;
  });

  afterAll(async () => {
    // Clean up created work items, SLAs, policies, and memberships in test teams
    if (createdWorkItemIds.length > 0) {
      await db
        .delete(workItemSlas)
        .where(inArray(workItemSlas.workItemId, createdWorkItemIds));
      await db
        .delete(workItems)
        .where(inArray(workItems.id, createdWorkItemIds));
    }
    if (testTeamId) {
      await db.delete(slaPolicies).where(eq(slaPolicies.teamId, testTeamId));
      await db
        .delete(teamMemberships)
        .where(eq(teamMemberships.teamId, testTeamId));
      await db.delete(teams).where(eq(teams.id, testTeamId));
    }
    if (emptyTeamId) {
      await db
        .delete(teamMemberships)
        .where(eq(teamMemberships.teamId, emptyTeamId));
      await db.delete(teams).where(eq(teams.id, emptyTeamId));
    }
    await closeDb();
  });

  // =========================================================================
  // 1. Policy Matching Tiers
  // =========================================================================
  describe("1. Policy Matching Tiers", () => {
    it("resolves Tier 1: Exact work-item type + exact priority", async () => {
      const policy = await slaService.resolveApplicablePolicy(
        testTeamId,
        "INCIDENT",
        "URGENT"
      );
      expect(policy).not.toBeNull();
      expect(policy?.id).toBe(tier1PolicyId);
      expect(policy?.workItemType).toBe("INCIDENT");
      expect(policy?.priority).toBe("URGENT");
    });

    it("resolves Tier 2: Exact priority with wildcard type", async () => {
      // TASK + URGENT: type does not match INCIDENT, so falls through to Tier 2 (wildcard type + URGENT)
      const policy = await slaService.resolveApplicablePolicy(
        testTeamId,
        "TASK",
        "URGENT"
      );
      expect(policy).not.toBeNull();
      expect(policy?.id).toBe(tier2PolicyId);
      expect(policy?.workItemType).toBeNull();
      expect(policy?.priority).toBe("URGENT");
    });

    it("resolves Tier 3: Exact type with wildcard priority", async () => {
      // REQUEST + NORMAL: priority is not URGENT, so falls through to Tier 3 (REQUEST + null priority)
      const policy = await slaService.resolveApplicablePolicy(
        testTeamId,
        "REQUEST",
        "NORMAL"
      );
      expect(policy).not.toBeNull();
      expect(policy?.id).toBe(tier3PolicyId);
      expect(policy?.workItemType).toBe("REQUEST");
      expect(policy?.priority).toBeNull();
    });

    it("resolves Tier 4: Team-wide catch-all default policy", async () => {
      // TASK + LOW: matches neither INCIDENT/REQUEST nor URGENT, falls through to Tier 4
      const policy = await slaService.resolveApplicablePolicy(
        testTeamId,
        "TASK",
        "LOW"
      );
      expect(policy).not.toBeNull();
      expect(policy?.id).toBe(tier4PolicyId);
      expect(policy?.workItemType).toBeNull();
      expect(policy?.priority).toBeNull();
    });
  });

  // =========================================================================
  // 2. No Matching Policy
  // =========================================================================
  describe("2. No Matching Policy Behavior", () => {
    it("returns null when no policy is configured for the team", async () => {
      const policy = await slaService.resolveApplicablePolicy(
        emptyTeamId,
        "TASK",
        "NORMAL"
      );
      expect(policy).toBeNull();
    });

    it("preserves work item creation without creating a false SLA record", async () => {
      const item = await workItemsService.createWorkItem(testUser, {
        teamId: emptyTeamId,
        title: "Work item in empty SLA team",
        type: "TASK",
        priority: "NORMAL",
      });
      createdWorkItemIds.push(item.id);

      const sla = await slaService.getWorkItemSla(item.id);
      expect(sla).toBeNull();
    });
  });

  // =========================================================================
  // 3. Deadline Calculations and Target Snapshotting
  // =========================================================================
  describe("3. Deadline Calculations & Snapshot Invariance", () => {
    it("computes exact deadlines from start time and snapshotted targets", async () => {
      const startTime = new Date("2026-05-01T10:00:00.000Z");

      const item = await workItemsService.createWorkItem(testUser, {
        teamId: testTeamId,
        title: "Item for deadline check",
        type: "INCIDENT",
        priority: "URGENT",
      });
      createdWorkItemIds.push(item.id);

      // Fetch snapshot created by service lifecycle
      const sla = await slaService.getWorkItemSla(item.id);
      expect(sla).not.toBeNull();
      expect(sla?.policyId).toBe(tier1PolicyId);
      expect(sla?.responseTargetMinutes).toBe(15);
      expect(sla?.resolutionTargetMinutes).toBe(60);

      const expectedResponseDeadline = new Date(
        item.createdAt.getTime() + 15 * 60 * 1000
      );
      const expectedResolutionDeadline = new Date(
        item.createdAt.getTime() + 60 * 60 * 1000
      );

      expect(sla?.responseDeadline.getTime()).toBe(
        expectedResponseDeadline.getTime()
      );
      expect(sla?.resolutionDeadline.getTime()).toBe(
        expectedResolutionDeadline.getTime()
      );
      expect(sla?.riskState).toBe("ON_TRACK");
    });
  });

  // =========================================================================
  // 4. AT_RISK Boundary Behavior
  // =========================================================================
  describe("4. AT_RISK Boundary Behavior", () => {
    it("transitions to AT_RISK exactly at and beyond configured warning threshold", () => {
      const T0 = new Date("2026-05-01T12:00:00.000Z");
      // 100m total resolution, 75% warning => threshold at T0 + 75m
      const mockSla: WorkItemSla = {
        id: "mock-1",
        workItemId: "work-1",
        policyId: "pol-1",
        riskState: "ON_TRACK",
        responseTargetMinutes: 20,
        resolutionTargetMinutes: 100,
        warningThresholdPercent: 75,
        responseDeadline: new Date(T0.getTime() + 20 * 60 * 1000),
        resolutionDeadline: new Date(T0.getTime() + 100 * 60 * 1000),
        firstRespondedAt: new Date(T0.getTime() + 5 * 60 * 1000), // Responded on time
        resolvedAt: null,
        breachedAt: null,
        notifiedAtRiskAt: null,
        notifiedBreachedAt: null,
        createdAt: T0,
        updatedAt: T0,
      };

      // 1 minute before warning threshold (74m elapsed) -> ON_TRACK
      const beforeWarning = new Date(T0.getTime() + 74 * 60 * 1000);
      const evalBefore = calculateSlaRisk(mockSla, beforeWarning);
      expect(evalBefore.riskState).toBe("ON_TRACK");

      // Exactly at warning threshold (75m elapsed) -> AT_RISK
      const atWarning = new Date(T0.getTime() + 75 * 60 * 1000);
      const evalAt = calculateSlaRisk(mockSla, atWarning);
      expect(evalAt.riskState).toBe("AT_RISK");

      // Beyond warning threshold but before resolution deadline (90m elapsed) -> AT_RISK
      const beyondWarning = new Date(T0.getTime() + 90 * 60 * 1000);
      const evalBeyond = calculateSlaRisk(mockSla, beyondWarning);
      expect(evalBeyond.riskState).toBe("AT_RISK");
    });
  });

  // =========================================================================
  // 5. Response Breach Before Resolution Breach
  // =========================================================================
  describe("5. Response Breach Before Resolution Breach", () => {
    it("flags response breached when first response is pending past deadline", () => {
      const T0 = new Date("2026-05-01T12:00:00.000Z");
      const mockSla: WorkItemSla = {
        id: "mock-2",
        workItemId: "work-2",
        policyId: "pol-1",
        riskState: "ON_TRACK",
        responseTargetMinutes: 15,
        resolutionTargetMinutes: 60,
        warningThresholdPercent: 75,
        responseDeadline: new Date(T0.getTime() + 15 * 60 * 1000),
        resolutionDeadline: new Date(T0.getTime() + 60 * 60 * 1000),
        firstRespondedAt: null,
        resolvedAt: null,
        breachedAt: null,
        notifiedAtRiskAt: null,
        notifiedBreachedAt: null,
        createdAt: T0,
        updatedAt: T0,
      };

      // Evaluated at T0 + 20m (past response deadline of 15m, but before 60m resolution deadline)
      const now = new Date(T0.getTime() + 20 * 60 * 1000);
      const evalResult = calculateSlaRisk(mockSla, now);

      expect(evalResult.responseStatus).toBe("BREACHED");
      expect(evalResult.isResponseBreached).toBe(true);
      expect(evalResult.resolutionStatus).toBe("IN_PROGRESS");
      expect(evalResult.isResolutionBreached).toBe(false);
      expect(evalResult.riskState).toBe("BREACHED");
      expect(evalResult.breachedAt?.getTime()).toBe(
        mockSla.responseDeadline.getTime()
      );
      expect(evalResult.isCompliant).toBe(false);
    });
  });

  // =========================================================================
  // 6. Resolution Breach
  // =========================================================================
  describe("6. Resolution Breach", () => {
    it("flags resolution breached when unresolved past resolution deadline", () => {
      const T0 = new Date("2026-05-01T12:00:00.000Z");
      const mockSla: WorkItemSla = {
        id: "mock-3",
        workItemId: "work-3",
        policyId: "pol-1",
        riskState: "ON_TRACK",
        responseTargetMinutes: 15,
        resolutionTargetMinutes: 60,
        warningThresholdPercent: 75,
        responseDeadline: new Date(T0.getTime() + 15 * 60 * 1000),
        resolutionDeadline: new Date(T0.getTime() + 60 * 60 * 1000),
        firstRespondedAt: new Date(T0.getTime() + 10 * 60 * 1000), // Response met on time
        resolvedAt: null,
        breachedAt: null,
        notifiedAtRiskAt: null,
        notifiedBreachedAt: null,
        createdAt: T0,
        updatedAt: T0,
      };

      // Evaluated at T0 + 75m (past resolution deadline of 60m)
      const now = new Date(T0.getTime() + 75 * 60 * 1000);
      const evalResult = calculateSlaRisk(mockSla, now);

      expect(evalResult.responseStatus).toBe("MET");
      expect(evalResult.isResponseBreached).toBe(false);
      expect(evalResult.resolutionStatus).toBe("BREACHED");
      expect(evalResult.isResolutionBreached).toBe(true);
      expect(evalResult.riskState).toBe("BREACHED");
      expect(evalResult.breachedAt?.getTime()).toBe(
        mockSla.resolutionDeadline.getTime()
      );
      expect(evalResult.isCompliant).toBe(false);
    });
  });

  // =========================================================================
  // 7. Late Response with On-Time Resolution
  // =========================================================================
  describe("7. Late Response But On-Time Resolution", () => {
    it("preserves response breach even when resolution completes on time", () => {
      const T0 = new Date("2026-05-01T12:00:00.000Z");
      const respDeadline = new Date(T0.getTime() + 15 * 60 * 1000);
      const resDeadline = new Date(T0.getTime() + 60 * 60 * 1000);

      const mockSla: WorkItemSla = {
        id: "mock-4",
        workItemId: "work-4",
        policyId: "pol-1",
        riskState: "COMPLETED",
        responseTargetMinutes: 15,
        resolutionTargetMinutes: 60,
        warningThresholdPercent: 75,
        responseDeadline: respDeadline,
        resolutionDeadline: resDeadline,
        firstRespondedAt: new Date(T0.getTime() + 25 * 60 * 1000), // Late response (25m > 15m)
        resolvedAt: new Date(T0.getTime() + 50 * 60 * 1000), // On-time resolution (50m <= 60m)
        breachedAt: respDeadline,
        notifiedAtRiskAt: null,
        notifiedBreachedAt: null,
        createdAt: T0,
        updatedAt: T0,
      };

      const evalResult = calculateSlaRisk(mockSla);

      expect(evalResult.riskState).toBe("COMPLETED");
      expect(evalResult.responseStatus).toBe("BREACHED");
      expect(evalResult.isResponseBreached).toBe(true);
      expect(evalResult.resolutionStatus).toBe("MET");
      expect(evalResult.isResolutionBreached).toBe(false);
      expect(evalResult.isCompliant).toBe(false); // Overall not compliant because response target was missed
    });
  });

  // =========================================================================
  // 8. On-Time vs. Late Completion
  // =========================================================================
  describe("8. On-Time vs. Late Completion", () => {
    const T0 = new Date("2026-05-01T12:00:00.000Z");
    const respDeadline = new Date(T0.getTime() + 15 * 60 * 1000);
    const resDeadline = new Date(T0.getTime() + 60 * 60 * 1000);

    it("evaluates fully compliant on-time completion", () => {
      const mockSla: WorkItemSla = {
        id: "mock-5a",
        workItemId: "work-5a",
        policyId: "pol-1",
        riskState: "COMPLETED",
        responseTargetMinutes: 15,
        resolutionTargetMinutes: 60,
        warningThresholdPercent: 75,
        responseDeadline: respDeadline,
        resolutionDeadline: resDeadline,
        firstRespondedAt: new Date(T0.getTime() + 10 * 60 * 1000), // 10m <= 15m
        resolvedAt: new Date(T0.getTime() + 45 * 60 * 1000), // 45m <= 60m
        breachedAt: null,
        notifiedAtRiskAt: null,
        notifiedBreachedAt: null,
        createdAt: T0,
        updatedAt: T0,
      };

      const evalResult = calculateSlaRisk(mockSla);

      expect(evalResult.riskState).toBe("COMPLETED");
      expect(evalResult.responseStatus).toBe("MET");
      expect(evalResult.resolutionStatus).toBe("MET");
      expect(evalResult.isCompliant).toBe(true);
    });

    it("evaluates late resolution completion", () => {
      const mockSla: WorkItemSla = {
        id: "mock-5b",
        workItemId: "work-5b",
        policyId: "pol-1",
        riskState: "COMPLETED",
        responseTargetMinutes: 15,
        resolutionTargetMinutes: 60,
        warningThresholdPercent: 75,
        responseDeadline: respDeadline,
        resolutionDeadline: resDeadline,
        firstRespondedAt: new Date(T0.getTime() + 10 * 60 * 1000), // 10m <= 15m
        resolvedAt: new Date(T0.getTime() + 90 * 60 * 1000), // 90m > 60m
        breachedAt: resDeadline,
        notifiedAtRiskAt: null,
        notifiedBreachedAt: null,
        createdAt: T0,
        updatedAt: T0,
      };

      const evalResult = calculateSlaRisk(mockSla);

      expect(evalResult.riskState).toBe("COMPLETED");
      expect(evalResult.responseStatus).toBe("MET");
      expect(evalResult.resolutionStatus).toBe("BREACHED");
      expect(evalResult.isCompliant).toBe(false);
    });
  });

  // =========================================================================
  // 9. Preservation of First-Response & Resolution Timestamps
  // =========================================================================
  describe("9. Timestamp Preservation Invariants", () => {
    it("never resets a previously recorded first-response timestamp in service", async () => {
      const item = await workItemsService.createWorkItem(testUser, {
        teamId: testTeamId,
        title: "Work item for first response test",
        type: "INCIDENT",
        priority: "URGENT",
      });
      createdWorkItemIds.push(item.id);

      const firstTimestamp = new Date("2026-05-01T10:05:00.000Z");
      const updatedSla1 = await slaService.recordFirstResponse(
        item.id,
        firstTimestamp
      );
      expect(updatedSla1?.firstRespondedAt?.getTime()).toBe(
        firstTimestamp.getTime()
      );

      // Attempt to overwrite with a later timestamp
      const secondTimestamp = new Date("2026-05-01T10:30:00.000Z");
      const updatedSla2 = await slaService.recordFirstResponse(
        item.id,
        secondTimestamp
      );
      expect(updatedSla2?.firstRespondedAt?.getTime()).toBe(
        firstTimestamp.getTime()
      );

      // Verify in DB
      const dbSla = await slaService.getWorkItemSla(item.id);
      expect(dbSla?.firstRespondedAt?.getTime()).toBe(firstTimestamp.getTime());
    });

    it("records first response on claim and retains it across subsequent transitions", async () => {
      const item = await workItemsService.createWorkItem(testUser, {
        teamId: testTeamId,
        title: "Claim lifecycle work item",
        type: "TASK",
        priority: "URGENT",
      });
      createdWorkItemIds.push(item.id);

      // 1. Claim work item
      const claimed = await workItemsService.claimWorkItem(testUser, item.id);
      expect(claimed.assigneeId).toBe(testUserId);

      const slaAfterClaim = await slaService.getWorkItemSla(item.id);
      expect(slaAfterClaim?.firstRespondedAt).not.toBeNull();
      const initialResponseTime = slaAfterClaim!.firstRespondedAt!.getTime();

      // 2. Transition to IN_PROGRESS
      await workItemsService.transitionWorkItem(testUser, item.id, {
        status: "IN_PROGRESS",
      });

      const slaAfterTransition = await slaService.getWorkItemSla(item.id);
      expect(slaAfterTransition?.firstRespondedAt?.getTime()).toBe(
        initialResponseTime
      );

      // 3. Resolve work item
      await workItemsService.transitionWorkItem(testUser, item.id, {
        status: "RESOLVED",
      });

      const slaAfterResolve = await slaService.getWorkItemSla(item.id);
      expect(slaAfterResolve?.riskState).toBe("COMPLETED");
      expect(slaAfterResolve?.resolvedAt).not.toBeNull();
      expect(slaAfterResolve?.firstRespondedAt?.getTime()).toBe(
        initialResponseTime
      );
    });
  });

  // =========================================================================
  // 10. Concurrent Batch Evaluation & Idempotency
  // =========================================================================
  describe("10. Concurrent Batch Evaluation & Transition Idempotency", () => {
    it("evaluates active SLAs and prevents duplicate transitions", async () => {
      const item = await workItemsService.createWorkItem(testUser, {
        teamId: testTeamId,
        title: "Batch eval test item",
        type: "INCIDENT",
        priority: "URGENT",
      });
      createdWorkItemIds.push(item.id);

      const sla = await slaService.getWorkItemSla(item.id);
      expect(sla?.riskState).toBe("ON_TRACK");

      // Simulate a future time where item breaches resolution target
      const breachTime = new Date(
        sla!.resolutionDeadline.getTime() + 10 * 60 * 1000
      );

      // First evaluation run: should trigger transition to BREACHED
      const batchResult1 = await slaRiskEngine.evaluateActiveSlas({
        now: breachTime,
        teamId: testTeamId,
      });

      const itemTransition = batchResult1.transitions.find(
        (t) => t.workItemId === item.id
      );
      expect(itemTransition).toBeDefined();
      expect(itemTransition?.previousRiskState).toBe("ON_TRACK");
      expect(itemTransition?.newRiskState).toBe("BREACHED");
      expect(itemTransition?.eventType).toBe("SLA_BREACHED");

      // Verify DB state updated
      const updatedSla = await slaService.getWorkItemSla(item.id);
      expect(updatedSla?.riskState).toBe("BREACHED");
      expect(updatedSla?.breachedAt).not.toBeNull();
      expect(updatedSla?.notifiedBreachedAt).not.toBeNull();

      // Second immediate evaluation run: should be a clean no-op for this item
      const batchResult2 = await slaRiskEngine.evaluateActiveSlas({
        now: breachTime,
        teamId: testTeamId,
      });

      const duplicateTransition = batchResult2.transitions.find(
        (t) => t.workItemId === item.id
      );
      expect(duplicateTransition).toBeUndefined();
    });
  });
});
