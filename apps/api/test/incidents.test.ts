import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { sql, eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { config } from "../src/config";
import {
  db,
  closeDb,
  users,
  teams,
  teamMemberships,
  incidents,
  incidentResponders,
  incidentTimelineEvents,
  incidentLinkedItems,
  workItems,
} from "../src/db";

describe("Newtonite API - Feature 1: Incident Command Center", () => {
  const app = createApp();

  let adminToken: string;
  let leadToken: string;
  let leadUserId: string;
  let memberToken: string;
  let memberUserId: string;
  let viewerToken: string;
  let coreOpsTeamId: string;

  let testTeam2Id: string;
  let externalUserToken: string;

  let createdIncidentIds: string[] = [];
  let createdWorkItemIds: string[] = [];

  beforeAll(async () => {
    // 1. Resolve demo team ID
    const [coreOpsTeam] = await db
      .select()
      .from(teams)
      .where(sql`${teams.slug} = 'core-ops'`)
      .limit(1);
    coreOpsTeamId = coreOpsTeam.id;

    // 2. Obtain valid tokens via login
    const adminLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@newtonite.dev", password: "Newtonite@123!" });
    adminToken = adminLoginRes.body.token;

    const leadLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "lead@newtonite.dev", password: "Newtonite@123!" });
    leadToken = leadLoginRes.body.token;
    leadUserId = leadLoginRes.body.user.id;

    const memberLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "member@newtonite.dev", password: "Newtonite@123!" });
    memberToken = memberLoginRes.body.token;
    memberUserId = memberLoginRes.body.user.id;

    const viewerLoginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "viewer@newtonite.dev", password: "Newtonite@123!" });
    viewerToken = viewerLoginRes.body.token;

    // 3. Create isolated team for cross-team isolation checks
    const [team2] = await db
      .insert(teams)
      .values({
        name: "Incident Isolation Team",
        slug: `inc-iso-${Date.now()}`,
      })
      .returning();
    testTeam2Id = team2.id;

    const [extUser] = await db
      .insert(users)
      .values({
        name: "External Incident User",
        email: `ext-inc-${Date.now()}@newtonite.dev`,
        passwordHash: "dummyhash",
        isActive: true,
      })
      .returning();

    await db.insert(teamMemberships).values({
      userId: extUser.id,
      teamId: testTeam2Id,
      role: "MEMBER",
    });

    externalUserToken = jwt.sign(
      { sub: extUser.id, email: extUser.email, name: extUser.name },
      config.JWT_SECRET,
      { expiresIn: "1h" }
    );
  }, 60000);

  afterAll(async () => {
    // Cleanup incident records
    for (const incidentId of createdIncidentIds) {
      await db
        .delete(incidentLinkedItems)
        .where(eq(incidentLinkedItems.incidentId, incidentId));
      await db
        .delete(incidentTimelineEvents)
        .where(eq(incidentTimelineEvents.incidentId, incidentId));
      await db
        .delete(incidentResponders)
        .where(eq(incidentResponders.incidentId, incidentId));
      await db.delete(incidents).where(eq(incidents.id, incidentId));
    }

    for (const itemId of createdWorkItemIds) {
      await db.delete(workItems).where(eq(workItems.id, itemId));
    }

    if (testTeam2Id) {
      await db
        .delete(teamMemberships)
        .where(eq(teamMemberships.teamId, testTeam2Id));
      await db.delete(teams).where(eq(teams.id, testTeam2Id));
    }

    await closeDb();
  }, 60000);

  // ==========================================================================
  // 1. Declaration & Permissions
  // ==========================================================================
  describe("1. Incident Declaration & Permissions", () => {
    it("POST /api/v1/incidents - denies VIEWER from declaring incident with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/v1/incidents")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Viewer unauthorized attempt",
          severity: "SEV2",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("POST /api/v1/incidents - rejects invalid payload (missing title) with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/v1/incidents")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          teamId: coreOpsTeamId,
          severity: "SEV2",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("POST /api/v1/incidents - MEMBER successfully declares SEV1 incident", async () => {
      const res = await request(app)
        .post("/api/v1/incidents")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Payment Gateway Outage - Production Impact",
          summary: "Stripe webhook timeouts leading to failed checkouts",
          severity: "SEV1",
          impact: "TOTAL_OUTAGE",
          commanderId: leadUserId,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.title).toBe("Payment Gateway Outage - Production Impact");
      expect(res.body.severity).toBe("SEV1");
      expect(res.body.impact).toBe("TOTAL_OUTAGE");
      expect(res.body.status).toBe("DECLARED");
      expect(res.body.version).toBe(1);
      expect(res.body.commanderId).toBe(leadUserId);

      // Verify responders automatically include commander and declarer
      expect(res.body.responders).toBeDefined();
      expect(res.body.responders.length).toBe(2);

      const commanderResponder = res.body.responders.find(
        (r: any) => r.userId === leadUserId
      );
      expect(commanderResponder).toBeDefined();
      expect(commanderResponder.role).toBe("COMMANDER");

      createdIncidentIds.push(res.body.id);
    });
  });

  // ==========================================================================
  // 2. Incident Retrieval & Isolation
  // ==========================================================================
  describe("2. Incident Listing and Retrieval", () => {
    it("GET /api/v1/incidents - lists incidents scoped to authorized team", async () => {
      const res = await request(app)
        .get(`/api/v1/incidents?teamId=${coreOpsTeamId}`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("pagination");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const found = res.body.data.find(
        (inc: any) => inc.id === createdIncidentIds[0]
      );
      expect(found).toBeDefined();
    });

    it("GET /api/v1/incidents/:id - retrieves incident details with responders", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(incidentId);
      expect(res.body.responders.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/v1/incidents/:id - enforces team isolation (external user gets 404)", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${externalUserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 3. Mutation & Optimistic Concurrency Control (OCC)
  // ==========================================================================
  describe("3. Updates & Optimistic Concurrency Control", () => {
    it("PATCH /api/v1/incidents/:id - updates incident fields and increments version", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .patch(`/api/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          mitigationNotes: "Switching payments to secondary backup provider",
          expectedVersion: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      expect(res.body.mitigationNotes).toBe(
        "Switching payments to secondary backup provider"
      );
    });

    it("PATCH /api/v1/incidents/:id - rejects concurrent update with stale expectedVersion (409 Conflict)", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .patch(`/api/v1/incidents/${incidentId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          mitigationNotes: "Stale edit attempt",
          expectedVersion: 1, // Stale version (current is 2)
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });
  });

  // ==========================================================================
  // 4. Role-Governed Lifecycle Transitions
  // ==========================================================================
  describe("4. Status Transitions & Role Governance", () => {
    it("POST /api/v1/incidents/:id/transition - MEMBER advances from DECLARED to INVESTIGATING", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          status: "INVESTIGATING",
          message: "Lead engineer reviewing CloudWatch metrics",
          expectedVersion: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("INVESTIGATING");
      expect(res.body.version).toBe(3);
    });

    it("POST /api/v1/incidents/:id/transition - rejects invalid skipping transition (INVESTIGATING -> RESOLVED)", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          status: "RESOLVED",
          expectedVersion: 3,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("POST /api/v1/incidents/:id/transition - progresses INVESTIGATING -> IDENTIFIED -> MITIGATING -> MONITORING", async () => {
      const incidentId = createdIncidentIds[0];

      // To IDENTIFIED
      const step1 = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "IDENTIFIED", expectedVersion: 3 });
      expect(step1.status).toBe(200);
      expect(step1.body.status).toBe("IDENTIFIED");

      // To MITIGATING
      const step2 = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "MITIGATING", expectedVersion: 4 });
      expect(step2.status).toBe(200);
      expect(step2.body.status).toBe("MITIGATING");

      // To MONITORING
      const step3 = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "MONITORING", expectedVersion: 5 });
      expect(step3.status).toBe(200);
      expect(step3.body.status).toBe("MONITORING");
    });

    it("POST /api/v1/incidents/:id/transition - MEMBER forbidden from resolving (requires LEAD+)", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          status: "RESOLVED",
          expectedVersion: 6,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("POST /api/v1/incidents/:id/transition - LEAD successfully resolves incident and records resolvedAt", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/transition`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          status: "RESOLVED",
          message: "All traffic flowing smoothly through backup processor",
          expectedVersion: 6,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("RESOLVED");
      expect(res.body.resolvedAt).toBeDefined();
      expect(res.body.resolvedAt).not.toBeNull();
    });
  });

  // ==========================================================================
  // 5. Timeline & Responders
  // ==========================================================================
  describe("5. Timeline Notes & Responder Management", () => {
    it("POST /api/v1/incidents/:id/timeline/notes - adds a collaborative note to the timeline", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/timeline/notes`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          message: "External payment vendor confirmed DNS propagation issue.",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.message).toContain("DNS propagation");
    });

    it("GET /api/v1/incidents/:id/timeline - retrieves chronological timeline with actor details", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentId}/timeline`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);

      const eventTypes = res.body.data.map((e: any) => e.eventType);
      expect(eventTypes).toContain("DECLARED");
      expect(eventTypes).toContain("STATUS_CHANGED");
      expect(eventTypes).toContain("NOTE_ADDED");
    });

    it("POST /api/v1/incidents/:id/responders - adds a responder with specified role", async () => {
      const incidentId = createdIncidentIds[0];
      // Resolve admin user ID
      const [adminUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, "admin@newtonite.dev"))
        .limit(1);

      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/responders`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({
          userId: adminUser.id,
          role: "COMMUNICATIONS",
        });

      expect(res.status).toBe(200);
      const responder = res.body.responders.find(
        (r: any) => r.userId === adminUser.id
      );
      expect(responder).toBeDefined();
      expect(responder.role).toBe("COMMUNICATIONS");
    });

    it("DELETE /api/v1/incidents/:id/responders/:userId - rejects removing commander with 400 Bad Request", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .delete(`/api/v1/incidents/${incidentId}/responders/${leadUserId}`)
        .set("Authorization", `Bearer ${leadToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });
  });

  // ==========================================================================
  // 6. Work Item Linking
  // ==========================================================================
  describe("6. Work Item Association", () => {
    it("POST /api/v1/incidents/:id/items - links a work item to the incident", async () => {
      const incidentId = createdIncidentIds[0];

      // Create a work item in the same team
      const [item] = await db
        .insert(workItems)
        .values({
          teamId: coreOpsTeamId,
          title: "Patch webhook retry exponential backoff",
          type: "TASK",
          priority: "HIGH",
          createdById: memberUserId,
        })
        .returning();
      createdWorkItemIds.push(item.id);

      const res = await request(app)
        .post(`/api/v1/incidents/${incidentId}/items`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          workItemId: item.id,
        });

      expect(res.status).toBe(200);
      expect(res.body.linkedItemCount).toBe(1);
    });

    it("GET /api/v1/incidents/:id/items - retrieves linked work items", async () => {
      const incidentId = createdIncidentIds[0];
      const res = await request(app)
        .get(`/api/v1/incidents/${incidentId}/items`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].title).toBe(
        "Patch webhook retry exponential backoff"
      );
    });

    it("DELETE /api/v1/incidents/:id/items/:itemId - unlinks the work item", async () => {
      const incidentId = createdIncidentIds[0];
      const workItemId = createdWorkItemIds[0];

      const res = await request(app)
        .delete(`/api/v1/incidents/${incidentId}/items/${workItemId}`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.linkedItemCount).toBe(0);
    });
  });
});
