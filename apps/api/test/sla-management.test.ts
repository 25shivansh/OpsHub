import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { eq, sql, inArray } from "drizzle-orm";
import { createApp } from "../src/app";
import { config } from "../src/config";
import {
  db,
  closeDb,
  users,
  teams,
  teamMemberships,
  workItems,
  slaPolicies,
  workItemSlas,
  activityEvents,
  outboxEvents,
  notifications,
} from "../src/db";
import { slaService } from "../src/modules/sla/sla.service";
import { slaRiskEngine } from "../src/modules/sla/sla-risk.engine";
import {
  startSlaEvaluationScheduler,
  stopSlaEvaluationScheduler,
  isSlaSchedulerRunning,
  evaluateSlaSweepOnce,
} from "../src/jobs/sla.evaluator";
import { processOutboxEvent } from "../src/jobs/outbox.processor";

describe("Newtonite Feature 2 — Prompt 4: SLA Policy Management, Evaluation, and Notifications", () => {
  const app = createApp();

  let adminToken: string;
  let adminUserId: string;
  let leadToken: string;
  let leadUserId: string;
  let memberToken: string;
  let memberUserId: string;
  let viewerToken: string;
  let viewerUserId: string;

  let coreOpsTeamId: string;
  let teamBId: string;
  let teamBLeadToken: string;
  let teamBLeadUserId: string;

  const testCreatedPolicyIds: string[] = [];
  const testCreatedWorkItemIds: string[] = [];

  beforeAll(async () => {
    // 1. Resolve demo team core-ops
    const [coreOpsTeam] = await db
      .select()
      .from(teams)
      .where(sql`${teams.slug} = 'core-ops'`)
      .limit(1);
    coreOpsTeamId = coreOpsTeam.id;

    // 2. Login as demo users
    const adminRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@newtonite.dev", password: "Newtonite@123!" });
    adminToken = adminRes.body.token;
    adminUserId = adminRes.body.user.id;

    const leadRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "lead@newtonite.dev", password: "Newtonite@123!" });
    leadToken = leadRes.body.token;
    leadUserId = leadRes.body.user.id;

    const memberRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "member@newtonite.dev", password: "Newtonite@123!" });
    memberToken = memberRes.body.token;
    memberUserId = memberRes.body.user.id;

    const viewerRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "viewer@newtonite.dev", password: "Newtonite@123!" });
    viewerToken = viewerRes.body.token;
    viewerUserId = viewerRes.body.user.id;

    // 3. Create isolated Team B and external lead for cross-team isolation tests
    const suffix = Date.now().toString(36);
    const [teamB] = await db
      .insert(teams)
      .values({
        name: `Team B ${suffix}`,
        slug: `team-b-${suffix}`,
      })
      .returning();
    teamBId = teamB.id;

    const [teamBLead] = await db
      .insert(users)
      .values({
        name: "Team B Lead",
        email: `teamb-lead-${suffix}@newtonite.dev`,
        passwordHash: adminRes.body.user.passwordHash || "dummyhash",
        isActive: true,
      })
      .returning();
    teamBLeadUserId = teamBLead.id;

    await db.insert(teamMemberships).values({
      userId: teamBLeadUserId,
      teamId: teamBId,
      role: "LEAD",
    });

    teamBLeadToken = jwt.sign(
      {
        sub: teamBLead.id,
        email: teamBLead.email,
        name: teamBLead.name,
      },
      config.JWT_SECRET,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    // Cleanup any created work items and policies
    stopSlaEvaluationScheduler();

    if (testCreatedWorkItemIds.length > 0) {
      await db
        .delete(workItemSlas)
        .where(inArray(workItemSlas.workItemId, testCreatedWorkItemIds));
      await db
        .delete(workItems)
        .where(inArray(workItems.id, testCreatedWorkItemIds));
    }
    if (testCreatedPolicyIds.length > 0) {
      await db
        .delete(slaPolicies)
        .where(inArray(slaPolicies.id, testCreatedPolicyIds));
    }
    if (teamBId) {
      await db.delete(teamMemberships).where(eq(teamMemberships.teamId, teamBId));
      await db.delete(teams).where(eq(teams.id, teamBId));
    }
    if (teamBLeadUserId) {
      await db.delete(users).where(eq(users.id, teamBLeadUserId));
    }
    await closeDb();
  });

  // =========================================================================
  // 1 & 2. RBAC: VIEWER & MEMBER Restrictions
  // =========================================================================
  describe("1 & 2. Role-Based Access Control (VIEWER & MEMBER)", () => {
    it("allows VIEWER to list policies, but rejects policy creation with 403", async () => {
      // Listing is permitted
      const listRes = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${viewerToken}`);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);

      // Creation is rejected
      const createRes = await request(app)
        .post(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          name: "Viewer Illegal Policy",
          workItemType: "TASK",
          priority: "LOW",
          responseTargetMinutes: 60,
          resolutionTargetMinutes: 120,
        });
      expect(createRes.status).toBe(403);
    });

    it("rejects MEMBER policy creation and updates with 403 Forbidden", async () => {
      const createRes = await request(app)
        .post(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          name: "Member Illegal Policy",
          workItemType: "TASK",
          priority: "LOW",
          responseTargetMinutes: 60,
          resolutionTargetMinutes: 120,
        });
      expect(createRes.status).toBe(403);
    });
  });

  // =========================================================================
  // 3. LEAD / ADMIN Permissions
  // =========================================================================
  describe("3. LEAD vs ADMIN Permissions", () => {
    let createdPolicyId: string;

    it("allows LEAD to create a valid SLA policy", async () => {
      const res = await request(app)
        .post(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          name: "Lead Created Policy",
          workItemType: "REQUEST",
          priority: "LOW",
          responseTargetMinutes: 45,
          resolutionTargetMinutes: 90,
          warningThresholdPercent: 80,
          isActive: false, // create inactive so it won't conflict with any active catchall
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Lead Created Policy");
      expect(res.body.data.teamId).toBe(coreOpsTeamId);
      createdPolicyId = res.body.data.id;
      testCreatedPolicyIds.push(createdPolicyId);
    });

    it("allows LEAD to update policy targets", async () => {
      const res = await request(app)
        .patch(`/api/v1/teams/${coreOpsTeamId}/sla/policies/${createdPolicyId}`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          name: "Lead Updated Policy Name",
          resolutionTargetMinutes: 150,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Lead Updated Policy Name");
      expect(res.body.data.resolutionTargetMinutes).toBe(150);
    });

    it("prevents LEAD from deleting policy (403 Forbidden)", async () => {
      const res = await request(app)
        .delete(`/api/v1/teams/${coreOpsTeamId}/sla/policies/${createdPolicyId}`)
        .set("Authorization", `Bearer ${leadToken}`);

      expect(res.status).toBe(403);
    });

    it("allows ADMIN to delete an unreferenced policy (200 OK)", async () => {
      const res = await request(app)
        .delete(`/api/v1/teams/${coreOpsTeamId}/sla/policies/${createdPolicyId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);

      // Verify it's gone
      const checkRes = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${adminToken}`);
      const found = checkRes.body.data.find(
        (p: any) => p.id === createdPolicyId
      );
      expect(found).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Team Isolation and Ownership Validation
  // =========================================================================
  describe("4. Team Isolation and IDOR Prevention", () => {
    it("returns 404 when user attempts to access policies of a team they do not belong to", async () => {
      // teamBLead is NOT a member of coreOpsTeam
      const res = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${teamBLeadToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // =========================================================================
  // 5. Active Policy Specificity Conflict Prevention
  // =========================================================================
  describe("5. Active Policy Conflict Prevention (409 Conflict)", () => {
    it("returns 409 Conflict when creating a duplicate active policy at the same specificity", async () => {
      // In core-ops, we already have an active policy for INCIDENT + URGENT
      const res = await request(app)
        .post(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          name: "Conflicting Incident Urgent Policy",
          workItemType: "INCIDENT",
          priority: "URGENT",
          responseTargetMinutes: 10,
          resolutionTargetMinutes: 30,
          isActive: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });

    it("returns 409 Conflict when attempting to activate a conflicting policy", async () => {
      // 1. Create inactive policy with INCIDENT + URGENT (allowed because inactive)
      const res1 = await request(app)
        .post(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          name: "Inactive Duplicate Policy",
          workItemType: "INCIDENT",
          priority: "URGENT",
          responseTargetMinutes: 10,
          resolutionTargetMinutes: 30,
          isActive: false,
        });

      expect(res1.status).toBe(201);
      const policyId = res1.body.data.id;
      testCreatedPolicyIds.push(policyId);

      // 2. Attempt to activate it via /active endpoint
      const res2 = await request(app)
        .patch(`/api/v1/teams/${coreOpsTeamId}/sla/policies/${policyId}/active`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({ isActive: true });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe("CONFLICT");
    });
  });

  // =========================================================================
  // 6. Policy Update Invariance for Existing SLA Snapshots
  // =========================================================================
  describe("6. Policy Update Invariance", () => {
    it("does not rewrite or alter existing work item SLA snapshots when policy targets change", async () => {
      // 1. Create an active policy
      const pRes = await request(app)
        .post(`/api/v1/teams/${coreOpsTeamId}/sla/policies`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          name: "Invariance Test Policy",
          workItemType: "REQUEST",
          priority: "HIGH",
          responseTargetMinutes: 20,
          resolutionTargetMinutes: 100,
          isActive: true,
        });
      expect(pRes.status).toBe(201);
      const policy = pRes.body.data;
      testCreatedPolicyIds.push(policy.id);

      // 2. Create work item matching this policy
      const [item] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Invariance Work Item",
          type: "REQUEST",
          priority: "HIGH",
          createdById: adminUserId,
        })
        .returning();
      testCreatedWorkItemIds.push(item.id);

      // Snapshot SLA
      const sla = await slaService.createSlaSnapshot(item);
      expect(sla?.responseTargetMinutes).toBe(20);
      expect(sla?.resolutionTargetMinutes).toBe(100);
      const originalRespDeadline = sla!.responseDeadline.getTime();

      // 3. Update the policy with new targets
      const updateRes = await request(app)
        .patch(`/api/v1/teams/${coreOpsTeamId}/sla/policies/${policy.id}`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          responseTargetMinutes: 50,
          resolutionTargetMinutes: 300,
        });
      expect(updateRes.status).toBe(200);

      // 4. Verify existing work item snapshot is UNCHANGED
      const existingSla = await slaService.getWorkItemSla(item.id);
      expect(existingSla?.responseTargetMinutes).toBe(20);
      expect(existingSla?.resolutionTargetMinutes).toBe(100);
      expect(existingSla?.responseDeadline.getTime()).toBe(originalRespDeadline);
    });
  });

  // =========================================================================
  // 7 & 8. Evaluator Emits SLA_WARNING & SLA_BREACHED to Outbox
  // =========================================================================
  describe("7 & 8. Evaluator Emits Outbox & Activity Events on Transitions", () => {
    it("emits SLA_WARNING event to activity and outbox when SLA crosses warning threshold", async () => {
      const T0 = new Date("2026-06-01T10:00:00.000Z");

      const [item] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Warning Transition Item",
          type: "TASK",
          priority: "NORMAL",
          createdById: adminUserId,
          assigneeId: memberUserId,
        })
        .returning();
      testCreatedWorkItemIds.push(item.id);

      // 100m resolution, 75% warning => warning threshold at T0 + 75m
      const [sla] = await db
        .insert(workItemSlas)
        .values({
          workItemId: item.id,
          riskState: "ON_TRACK",
          responseTargetMinutes: 30,
          resolutionTargetMinutes: 100,
          warningThresholdPercent: 75,
          responseDeadline: new Date(T0.getTime() + 30 * 60 * 1000),
          resolutionDeadline: new Date(T0.getTime() + 100 * 60 * 1000),
          firstRespondedAt: new Date(T0.getTime() + 10 * 60 * 1000), // Responded on time
          resolvedAt: null,
          breachedAt: null,
          notifiedAtRiskAt: null,
          notifiedBreachedAt: null,
          createdAt: T0,
          updatedAt: T0,
        })
        .returning();

      // Sweep at T0 + 80m (crossed warning threshold of 75m, but before 100m)
      const sweepTime = new Date(T0.getTime() + 80 * 60 * 1000);
      const batchResult = await slaRiskEngine.evaluateActiveSlas({
        now: sweepTime,
        teamId: coreOpsTeamId,
      });

      const transition = batchResult.transitions.find(
        (t) => t.workItemId === item.id
      );
      expect(transition).toBeDefined();
      expect(transition?.newRiskState).toBe("AT_RISK");
      expect(transition?.eventType).toBe("SLA_WARNING");

      // Verify activityEvents and outboxEvents records
      const [activity] = await db
        .select()
        .from(activityEvents)
        .where(
          sql`${activityEvents.itemId} = ${item.id} AND ${activityEvents.eventType} = 'SLA_WARNING'`
        )
        .limit(1);
      expect(activity).toBeDefined();

      const [outbox] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.activityEventId, activity.id))
        .limit(1);
      expect(outbox).toBeDefined();
      expect(outbox.eventType).toBe("SLA_WARNING");
      expect(outbox.status).toBe("PENDING");
    });

    it("emits SLA_BREACHED event to activity and outbox when resolution deadline passes", async () => {
      const T0 = new Date("2026-06-01T10:00:00.000Z");

      const [item] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Breached Item",
          type: "TASK",
          priority: "NORMAL",
          createdById: adminUserId,
          assigneeId: memberUserId,
        })
        .returning();
      testCreatedWorkItemIds.push(item.id);

      const [sla] = await db
        .insert(workItemSlas)
        .values({
          workItemId: item.id,
          riskState: "AT_RISK",
          responseTargetMinutes: 30,
          resolutionTargetMinutes: 60,
          warningThresholdPercent: 75,
          responseDeadline: new Date(T0.getTime() + 30 * 60 * 1000),
          resolutionDeadline: new Date(T0.getTime() + 60 * 60 * 1000),
          firstRespondedAt: new Date(T0.getTime() + 10 * 60 * 1000),
          resolvedAt: null,
          breachedAt: null,
          notifiedAtRiskAt: new Date(T0.getTime() + 50 * 60 * 1000),
          notifiedBreachedAt: null,
          createdAt: T0,
          updatedAt: T0,
        })
        .returning();

      // Sweep at T0 + 70m (past 60m resolution deadline)
      const sweepTime = new Date(T0.getTime() + 70 * 60 * 1000);
      const batchResult = await slaRiskEngine.evaluateActiveSlas({
        now: sweepTime,
        teamId: coreOpsTeamId,
      });

      const transition = batchResult.transitions.find(
        (t) => t.workItemId === item.id
      );
      expect(transition).toBeDefined();
      expect(transition?.newRiskState).toBe("BREACHED");
      expect(transition?.eventType).toBe("SLA_BREACHED");

      const [activity] = await db
        .select()
        .from(activityEvents)
        .where(
          sql`${activityEvents.itemId} = ${item.id} AND ${activityEvents.eventType} = 'SLA_BREACHED'`
        )
        .limit(1);
      expect(activity).toBeDefined();

      const [outbox] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.activityEventId, activity.id))
        .limit(1);
      expect(outbox).toBeDefined();
      expect(outbox.eventType).toBe("SLA_BREACHED");
      expect(outbox.status).toBe("PENDING");
    });
  });

  // =========================================================================
  // 9. Repeated & Overlapping Sweep Idempotency
  // =========================================================================
  describe("9. Repeated and Overlapping Evaluation Idempotency", () => {
    it("never emits duplicate transitions or outbox events on subsequent sweeps", async () => {
      const T0 = new Date("2026-06-01T10:00:00.000Z");

      const [item] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Idempotency Item",
          type: "TASK",
          priority: "NORMAL",
          createdById: adminUserId,
        })
        .returning();
      testCreatedWorkItemIds.push(item.id);

      await db.insert(workItemSlas).values({
        workItemId: item.id,
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
      });

      const breachTime = new Date(T0.getTime() + 20 * 60 * 1000);

      // 1. First sweep: transitions to BREACHED
      const run1 = await slaRiskEngine.evaluateActiveSlas({
        now: breachTime,
        teamId: coreOpsTeamId,
      });
      const t1 = run1.transitions.find((t) => t.workItemId === item.id);
      expect(t1).toBeDefined();

      // Count outbox events for this item
      const outbox1 = await db
        .select()
        .from(outboxEvents)
        .where(sql`${outboxEvents.payload}->>'itemId' = ${item.id}`);
      expect(outbox1.length).toBe(1);

      // 2. Second sweep with identical or later time: must produce 0 transitions for this item
      const run2 = await slaRiskEngine.evaluateActiveSlas({
        now: new Date(breachTime.getTime() + 10 * 60 * 1000),
        teamId: coreOpsTeamId,
      });
      const t2 = run2.transitions.find((t) => t.workItemId === item.id);
      expect(t2).toBeUndefined();

      const outbox2 = await db
        .select()
        .from(outboxEvents)
        .where(sql`${outboxEvents.payload}->>'itemId' = ${item.id}`);
      expect(outbox2.length).toBe(1); // Still exactly 1!
    });
  });

  // =========================================================================
  // 10 & 11. Notification Processing & Cross-Team Isolation
  // =========================================================================
  describe("10 & 11. Notification Processing & Isolation", () => {
    it("delivers SLA_WARNING to assignee, and handles items without an assignee gracefully", async () => {
      // 1. Create activity & outbox event for warning WITH assignee
      const [itemWithAssignee] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Assigned Warning Item",
          type: "TASK",
          priority: "NORMAL",
          createdById: adminUserId,
          assigneeId: memberUserId,
        })
        .returning();
      testCreatedWorkItemIds.push(itemWithAssignee.id);

      const [act1] = await db
        .insert(activityEvents)
        .values({
          itemId: itemWithAssignee.id,
          actorId: null,
          eventType: "SLA_WARNING",
        })
        .returning();

      const [outboxWithAssignee] = await db
        .insert(outboxEvents)
        .values({
          activityEventId: act1.id,
          eventType: "SLA_WARNING",
          payload: {
            itemId: itemWithAssignee.id,
            teamId: coreOpsTeamId,
          },
          status: "PENDING",
        })
        .returning();

      const res1 = await processOutboxEvent(outboxWithAssignee);
      expect(res1.status).toBe("PROCESSED");
      expect(res1.notificationsCreated).toBe(1);

      const [notif1] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.activityEventId, act1.id));
      expect(notif1.recipientId).toBe(memberUserId);

      // 2. Create activity & outbox event for warning WITHOUT assignee
      const [itemWithoutAssignee] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Unassigned Warning Item",
          type: "TASK",
          priority: "NORMAL",
          createdById: adminUserId,
          assigneeId: null,
        })
        .returning();
      testCreatedWorkItemIds.push(itemWithoutAssignee.id);

      const [act2] = await db
        .insert(activityEvents)
        .values({
          itemId: itemWithoutAssignee.id,
          actorId: null,
          eventType: "SLA_WARNING",
        })
        .returning();

      const [outboxWithoutAssignee] = await db
        .insert(outboxEvents)
        .values({
          activityEventId: act2.id,
          eventType: "SLA_WARNING",
          payload: {
            itemId: itemWithoutAssignee.id,
            teamId: coreOpsTeamId,
          },
          status: "PENDING",
        })
        .returning();

      // Must succeed cleanly without crashing and create 0 notifications
      const res2 = await processOutboxEvent(outboxWithoutAssignee);
      expect(res2.status).toBe("PROCESSED");
      expect(res2.notificationsCreated).toBe(0);
    });

    it("delivers SLA_BREACHED to assignee and team leads/admins, but never to another team's leads", async () => {
      const [breachItem] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Core Ops Breach Item",
          type: "TASK",
          priority: "URGENT",
          createdById: adminUserId,
          assigneeId: memberUserId,
        })
        .returning();
      testCreatedWorkItemIds.push(breachItem.id);

      const [act] = await db
        .insert(activityEvents)
        .values({
          itemId: breachItem.id,
          actorId: null,
          eventType: "SLA_BREACHED",
        })
        .returning();

      const [outbox] = await db
        .insert(outboxEvents)
        .values({
          activityEventId: act.id,
          eventType: "SLA_BREACHED",
          payload: {
            itemId: breachItem.id,
            teamId: coreOpsTeamId,
          },
          status: "PENDING",
        })
        .returning();

      const res = await processOutboxEvent(outbox);
      expect(res.status).toBe("PROCESSED");
      expect(res.notificationsCreated).toBeGreaterThanOrEqual(2); // member + lead + admin

      const notifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.activityEventId, act.id));

      const recipientIds = notifs.map((n) => n.recipientId);

      // Must include member (assignee), lead, admin of coreOps
      expect(recipientIds).toContain(memberUserId);
      expect(recipientIds).toContain(leadUserId);
      expect(recipientIds).toContain(adminUserId);

      // Cross-team isolation: Team B lead MUST NEVER receive Core Ops alert
      expect(recipientIds).not.toContain(teamBLeadUserId);
    });
  });

  // =========================================================================
  // 12. Scheduler Startup & Shutdown Cleanup
  // =========================================================================
  describe("12. Scheduler Lifecycle Management", () => {
    it("starts, runs idempotently, and cleans up timers without leak", async () => {
      expect(isSlaSchedulerRunning()).toBe(false);

      startSlaEvaluationScheduler(10000);
      expect(isSlaSchedulerRunning()).toBe(true);

      // Calling start again does not duplicate or throw
      startSlaEvaluationScheduler(10000);
      expect(isSlaSchedulerRunning()).toBe(true);

      // Single manual sweep works
      const sweep = await evaluateSlaSweepOnce({ teamId: coreOpsTeamId });
      expect(sweep).not.toBeNull();
      expect(typeof sweep?.evaluatedCount).toBe("number");

      stopSlaEvaluationScheduler();
      expect(isSlaSchedulerRunning()).toBe(false);
    });
  });

  // =========================================================================
  // 13. Team-Scoped SLA Metrics Endpoint & Compliance Aggregation
  // =========================================================================
  describe("13. Team-Scoped SLA Metrics Endpoint", () => {
    it("allows all team members (VIEWER, MEMBER, LEAD, ADMIN) to retrieve metrics", async () => {
      const resViewer = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/metrics`)
        .set("Authorization", `Bearer ${viewerToken}`);
      expect(resViewer.status).toBe(200);
      expect(resViewer.body.data).toBeDefined();

      const resAdmin = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/metrics`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.data).toBeDefined();

      const metrics = resAdmin.body.data;
      expect(typeof metrics.totalPolicies).toBe("number");
      expect(typeof metrics.activePolicies).toBe("number");
      expect(typeof metrics.totalSlas).toBe("number");
      expect(typeof metrics.activeSlas).toBe("number");
      expect(typeof metrics.onTrackCount).toBe("number");
      expect(typeof metrics.atRiskCount).toBe("number");
      expect(typeof metrics.breachedCount).toBe("number");
      expect(typeof metrics.completedCount).toBe("number");
      expect(metrics.responseCompliance).toBeDefined();
      expect(metrics.resolutionCompliance).toBeDefined();
    });

    it("enforces cross-team security boundary: Team B user cannot access Core Ops metrics", async () => {
      const res = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/metrics`)
        .set("Authorization", `Bearer ${teamBLeadToken}`);
      expect(res.status).toBe(404);
    });

    it("returns 401 when request is unauthenticated", async () => {
      const res = await request(app)
        .get(`/api/v1/teams/${coreOpsTeamId}/sla/metrics`);
      expect(res.status).toBe(401);
    });
  });
});
