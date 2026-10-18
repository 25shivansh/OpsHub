import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { sql, eq, and } from "drizzle-orm";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { db, closeDb, users, teams, workItems, activityEvents, teamMemberships, idempotencyRecords, outboxEvents, notifications } from "../src/db";
import { relayPendingEventsOnce, processOutboxEvent } from "../src/jobs";

describe("Newtonite API - Phase 3 Authentication, Authorization & Work Items", () => {
  const app = createApp();

  // Test state
  let adminToken: string;
  let leadToken: string;
  let leadUserId: string;
  let memberToken: string;
  let viewerToken: string;
  let coreOpsTeamId: string;
  let memberUserId: string;
  let createdTestItemIds: string[] = [];
  let testTeam2Id: string;
  let externalUserToken: string;
  let inactiveUserId: string;

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

    // 3. Create an isolated secondary team and user for cross-team isolation tests
    const [team2] = await db
      .insert(teams)
      .values({
        name: "External Team Isolation",
        slug: `ext-team-${Date.now()}`,
      })
      .returning();
    testTeam2Id = team2.id;

    const [extUser] = await db
      .insert(users)
      .values({
        name: "External User",
        email: `ext-${Date.now()}@newtonite.dev`,
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

    // 4. Create an inactive user for testing inactive rejection
    const [inactiveUser] = await db
      .insert(users)
      .values({
        name: "Inactive Tester",
        email: `inactive-${Date.now()}@newtonite.dev`,
        passwordHash: adminLoginRes.body.user ? adminLoginRes.body.token : "dummy",
        isActive: false,
      })
      .returning();
    inactiveUserId = inactiveUser.id;
  }, 60000);

  afterAll(async () => {
    // Cleanup temporary test items created during tests
    for (const itemId of createdTestItemIds) {
      await db.delete(activityEvents).where(eq(activityEvents.itemId, itemId));
      await db.delete(workItems).where(eq(workItems.id, itemId));
    }

    if (testTeam2Id) {
      await db.delete(teamMemberships).where(eq(teamMemberships.teamId, testTeam2Id));
      await db.delete(teams).where(eq(teams.id, testTeam2Id));
    }

    if (inactiveUserId) {
      await db.delete(users).where(eq(users.id, inactiveUserId));
    }

    await db.delete(idempotencyRecords);

    await closeDb();
  }, 60000);

  // ==========================================================================
  // 1. Authentication Tests
  // ==========================================================================
  describe("1. Authentication Endpoints", () => {
    it("POST /api/v1/auth/login - authenticates valid credentials and returns safe user profile without password_hash", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "ADMIN@NEWTONITE.DEV", // Case-insensitive test
          password: "Newtonite@123!",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(typeof res.body.token).toBe("string");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.email).toBe("admin@newtonite.dev");
      expect(res.body.user.name).toBe("Admin User");
      expect(res.body.user.isActive).toBe(true);

      // Verify passwordHash is never leaked
      expect(res.body.user).not.toHaveProperty("passwordHash");
      expect(res.body.user).not.toHaveProperty("password_hash");
      expect(JSON.stringify(res.body)).not.toContain("password_hash");
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    });

    it("POST /api/v1/auth/login - rejects invalid password with generic 401 response", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "admin@newtonite.dev",
          password: "WrongPassword@999",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Invalid email or password");
    });

    it("POST /api/v1/auth/login - rejects non-existent email with generic 401 response (no enumeration)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "nonexistent@newtonite.dev",
          password: "Newtonite@123!",
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Invalid email or password");
    });

    it("POST /api/v1/auth/login - rejects inactive user accounts with 401", async () => {
      const [inactive] = await db
        .select()
        .from(users)
        .where(eq(users.id, inactiveUserId))
        .limit(1);

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: inactive.email,
          password: "AnyPassword",
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/v1/auth/me - returns user profile and team memberships for authenticated user", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("admin@newtonite.dev");
      expect(Array.isArray(res.body.teams)).toBe(true);
      expect(res.body.teams.length).toBeGreaterThanOrEqual(1);

      const coreOpsMembership = res.body.teams.find((t: any) => t.teamSlug === "core-ops");
      expect(coreOpsMembership).toBeDefined();
      expect(coreOpsMembership.role).toBe("ADMIN");
      expect(res.body.user).not.toHaveProperty("passwordHash");
    });

    it("GET /api/v1/auth/me - rejects request with missing token (401)", async () => {
      const res = await request(app).get("/api/v1/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/v1/auth/me - rejects malformed Bearer token (401)", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer invalid-malformed-token-string");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/v1/auth/me - rejects expired JWT token (401)", async () => {
      const expiredToken = jwt.sign(
        { sub: memberUserId, email: "member@newtonite.dev", name: "Member" },
        config.JWT_SECRET,
        { expiresIn: "-1s" }
      );

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain("expired");
    });
  });

  // ==========================================================================
  // 2. Work-Item Creation and Team Authorization Tests
  // ==========================================================================
  describe("2. Work-Item Creation & Activity Event Recording", () => {
    it("POST /api/v1/items - MEMBER can create a work item and produces a CREATED activity event", async () => {
      const res = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Optimize Supabase pooler connections",
          description: "Inspect pgbouncer transaction pooler settings.",
          type: "TASK",
          priority: "HIGH",
          assigneeId: memberUserId,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe("Optimize Supabase pooler connections");
      expect(res.body.status).toBe("OPEN");
      expect(res.body.version).toBe(1);

      createdTestItemIds.push(res.body.id);

      // Verify corresponding CREATED activity event in database
      const [activity] = await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.itemId, res.body.id))
        .limit(1);

      expect(activity).toBeDefined();
      expect(activity.eventType).toBe("CREATED");
      expect(activity.actorId).toBe(memberUserId);
    });

    it("POST /api/v1/items - VIEWER is denied mutation permissions (403 Forbidden)", async () => {
      const res = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Viewer attempted task creation",
          type: "TASK",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(res.body.error.message).toContain("Viewers");
    });

    it("POST /api/v1/items - rejects assignment to a user outside the team (400 Bad Request)", async () => {
      // Create user not in core-ops team
      const [outsider] = await db
        .insert(users)
        .values({
          name: "Outsider",
          email: `outsider-${Date.now()}@newtonite.dev`,
          passwordHash: "dummy",
        })
        .returning();

      const res = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Task with invalid outsider assignee",
          assigneeId: outsider.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Assignee must be an active member");

      // Cleanup outsider
      await db.delete(users).where(eq(users.id, outsider.id));
    });

    it("POST /api/v1/items - rejects creation in a team user does not belong to (404 Not Found)", async () => {
      const res = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${externalUserToken}`)
        .send({
          teamId: coreOpsTeamId, // External user is not in core-ops
          title: "Cross-team unauthorized attempt",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("POST /api/v1/items - rejects blank or invalid payloads with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "   ", // Blank title violates min(1) trim
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });
  });

  // ==========================================================================
  // 3. Work-Item Listing & Scoping Tests
  // ==========================================================================
  describe("3. Work-Item Listing & Retrieval", () => {
    it("GET /api/v1/items - returns paginated items scoped to user's team", async () => {
      const res = await request(app)
        .get(`/api/v1/items?teamId=${coreOpsTeamId}&page=1&limit=10&sortBy=createdAt&sortOrder=desc`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.every((i: any) => i.teamId === coreOpsTeamId)).toBe(true);
    });

    it("GET /api/v1/items - rejects listing items for a team user does not belong to (404 Not Found)", async () => {
      const res = await request(app)
        .get(`/api/v1/items?teamId=${coreOpsTeamId}`)
        .set("Authorization", `Bearer ${externalUserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("GET /api/v1/items - rejects invalid query parameters (e.g. malformed UUID, negative page)", async () => {
      const res = await request(app)
        .get(`/api/v1/items?teamId=not-a-uuid&page=-5`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("GET /api/v1/items/:id - retrieves work item for member", async () => {
      const targetItemId = createdTestItemIds[0];
      const res = await request(app)
        .get(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(targetItemId);
    });

    it("GET /api/v1/items/:id - denies cross-team access with 404 (IDOR protection)", async () => {
      const targetItemId = createdTestItemIds[0];
      const res = await request(app)
        .get(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${externalUserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 4. Mutation, Workflow Transitions & Optimistic Locking Tests
  // ==========================================================================
  describe("4. Mutation, Concurrency & Optimistic Locking", () => {
    it("PATCH /api/v1/items/:id - VIEWER cannot mutate work items (403 Forbidden)", async () => {
      const targetItemId = createdTestItemIds[0];
      const res = await request(app)
        .patch(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          title: "Viewer attempted modification",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("PATCH /api/v1/items/:id - MEMBER transitions OPEN -> IN_PROGRESS and increments version", async () => {
      const targetItemId = createdTestItemIds[0];

      const res = await request(app)
        .patch(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          status: "IN_PROGRESS",
          expectedVersion: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("IN_PROGRESS");
      expect(res.body.version).toBe(2);

      // Verify STATUS_CHANGED activity event emitted
      const [activity] = await db
        .select()
        .from(activityEvents)
        .where(
          sql`${activityEvents.itemId} = ${targetItemId} AND ${activityEvents.eventType} = 'STATUS_CHANGED'`
        )
        .limit(1);

      expect(activity).toBeDefined();
      expect((activity.newValue as any).status).toBe("IN_PROGRESS");
    });

    it("PATCH /api/v1/items/:id - rejects stale expectedVersion with 409 Conflict", async () => {
      const targetItemId = createdTestItemIds[0];

      // Item is at version 2 now; submitting expectedVersion: 1 must fail
      const res = await request(app)
        .patch(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          title: "Stale update attempt",
          expectedVersion: 1,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.message).toContain("Version conflict");
    });

    it("PATCH /api/v1/items/:id - rejects invalid workflow state transitions with 400 Bad Request", async () => {
      const targetItemId = createdTestItemIds[0];

      // From IN_PROGRESS, directly attempting invalid jump
      const res = await request(app)
        .patch(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
          status: "OPEN",
        });

      expect(res.status).toBe(200);

      // Now close it
      await request(app)
        .patch(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "CLOSED" });

      // From CLOSED, jumping directly to IN_PROGRESS (must go through OPEN first)
      const invalidRes = await request(app)
        .patch(`/api/v1/items/${targetItemId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "IN_PROGRESS" });

      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error.code).toBe("BAD_REQUEST");
      expect(invalidRes.body.error.message).toContain("Invalid workflow transition");
    });
  });

  // ==========================================================================
  // 5. Phase 4 - Dedicated Workflow Engine & Atomic Claiming Tests
  // ==========================================================================
  describe("5. Phase 4 - Dedicated Workflow Engine & Atomic Claiming", () => {
    it("POST /api/v1/items/:id/claim - MEMBER successfully claims an unassigned OPEN item", async () => {
      // 1. Create an unassigned open item
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Unassigned item for atomic claim test",
          type: "TASK",
        });

      expect(createRes.status).toBe(201);
      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);
      expect(createRes.body.assigneeId).toBeNull();
      expect(createRes.body.status).toBe("OPEN");
      expect(createRes.body.version).toBe(1);

      // 2. Claim the item as member
      const claimRes = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send();

      expect(claimRes.status).toBe(200);
      expect(claimRes.body.id).toBe(itemId);
      expect(claimRes.body.assigneeId).toBe(memberUserId);
      expect(claimRes.body.status).toBe("OPEN");
      expect(claimRes.body.version).toBe(2);

      // 3. Verify CLAIMED activity event in DB
      const claimEvents = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "CLAIMED")
          )
        );

      expect(claimEvents).toHaveLength(1);
      expect(claimEvents[0].actorId).toBe(memberUserId);
      expect((claimEvents[0].newValue as any).assigneeId).toBe(memberUserId);
    });

    it("POST /api/v1/items/:id/claim - rejects claiming an already assigned/claimed item with 409 Conflict", async () => {
      // Create an item already assigned
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Pre-assigned item claim rejection test",
          type: "TASK",
          assigneeId: memberUserId,
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      const claimRes = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send();

      expect(claimRes.status).toBe(409);
      expect(claimRes.body.error.code).toBe("CONFLICT");
      expect(claimRes.body.error.message).toContain("already assigned or claimed");

      // Verify no CLAIMED event was created
      const events = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "CLAIMED")
          )
        );
      expect(events).toHaveLength(0);
    });

    it("POST /api/v1/items/:id/claim - rejects claiming an item that is not in OPEN status with 409 Conflict", async () => {
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "In-progress item claim rejection test",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // Transition to IN_PROGRESS
      await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "IN_PROGRESS" });

      // Attempt claim
      const claimRes = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send();

      expect(claimRes.status).toBe(409);
      expect(claimRes.body.error.code).toBe("CONFLICT");
      expect(claimRes.body.error.message).toContain("cannot be claimed because its status is IN_PROGRESS");
    });

    it("POST /api/v1/items/:id/claim - concurrent claims: exactly one winner and one conflict", async () => {
      // 1. Create an unassigned open item
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Concurrent claim battle item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // 2. Fire two simultaneous claims via Promise.all
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/items/${itemId}/claim`)
          .set("Authorization", `Bearer ${memberToken}`)
          .send(),
        request(app)
          .post(`/api/v1/items/${itemId}/claim`)
          .set("Authorization", `Bearer ${leadToken}`)
          .send(),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const winnerRes = res1.status === 200 ? res1 : res2;
      const loserRes = res1.status === 409 ? res1 : res2;

      expect(winnerRes.body.version).toBe(2);
      expect(winnerRes.body.assigneeId).toBeDefined();
      expect(loserRes.body.error.code).toBe("CONFLICT");

      // 3. Exactly one CLAIMED activity event exists in the database
      const claimEvents = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "CLAIMED")
          )
        );

      expect(claimEvents).toHaveLength(1);
      expect(claimEvents[0].actorId).toBe(winnerRes.body.assigneeId);
    });

    it("VIEWER cannot claim, transition, or assign work items (403 Forbidden)", async () => {
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Viewer mutation boundary test",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // Claim attempt by viewer
      const claimRes = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send();
      expect(claimRes.status).toBe(403);
      expect(claimRes.body.error.code).toBe("FORBIDDEN");

      // Transition attempt by viewer
      const transitionRes = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ status: "IN_PROGRESS" });
      expect(transitionRes.status).toBe(403);
      expect(transitionRes.body.error.code).toBe("FORBIDDEN");

      // Assign attempt by viewer
      const assignRes = await request(app)
        .post(`/api/v1/items/${itemId}/assign`)
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({ assigneeId: memberUserId });
      expect(assignRes.status).toBe(403);
      expect(assignRes.body.error.code).toBe("FORBIDDEN");

      // Verify item remains unassigned at version 1
      const [item] = await db
        .select()
        .from(workItems)
        .where(eq(workItems.id, itemId))
        .limit(1);
      expect(item.version).toBe(1);
      expect(item.assigneeId).toBeNull();
      expect(item.status).toBe("OPEN");
    });

    it("POST /api/v1/items/:id/transition - rejects invalid transitions with 400 Bad Request", async () => {
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Invalid transition test item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // Invalid jump from OPEN to RESOLVED
      const res = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "RESOLVED" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Invalid workflow transition from OPEN to RESOLVED");
    });

    it("POST /api/v1/items/:id/transition - enforces role permissions for approval decisions and reopening", async () => {
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Workflow approval governance test item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // 1. OPEN -> IN_PROGRESS (MEMBER permitted)
      const t1 = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "IN_PROGRESS" });
      expect(t1.status).toBe(200);
      expect(t1.body.status).toBe("IN_PROGRESS");
      expect(t1.body.version).toBe(2);

      // 2. IN_PROGRESS -> AWAITING_APPROVAL (MEMBER permitted)
      const t2 = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "AWAITING_APPROVAL" });
      expect(t2.status).toBe(200);
      expect(t2.body.status).toBe("AWAITING_APPROVAL");
      expect(t2.body.version).toBe(3);

      // 3. MEMBER attempts AWAITING_APPROVAL -> RESOLVED (Approval decision: REJECTED with 403)
      const unauthApproval = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "RESOLVED" });
      expect(unauthApproval.status).toBe(403);
      expect(unauthApproval.body.error.code).toBe("FORBIDDEN");
      expect(unauthApproval.body.error.message).toContain("requires LEAD or ADMIN");

      // 4. Direct PATCH cannot bypass approval rule
      const bypassAttempt = await request(app)
        .patch(`/api/v1/items/${itemId}`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "RESOLVED" });
      expect(bypassAttempt.status).toBe(403);
      expect(bypassAttempt.body.error.code).toBe("FORBIDDEN");

      // 5. LEAD approves AWAITING_APPROVAL -> RESOLVED (SUCCEEDS)
      const leadApproval = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({ status: "RESOLVED" });
      expect(leadApproval.status).toBe(200);
      expect(leadApproval.body.status).toBe("RESOLVED");
      expect(leadApproval.body.version).toBe(4);

      // 6. MEMBER closes RESOLVED -> CLOSED (SUCCEEDS)
      const closeRes = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "CLOSED" });
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.status).toBe("CLOSED");
      expect(closeRes.body.version).toBe(5);

      // 7. MEMBER attempts CLOSED -> OPEN (REJECTED with 403)
      const memberReopen = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "OPEN" });
      expect(memberReopen.status).toBe(403);
      expect(memberReopen.body.error.code).toBe("FORBIDDEN");

      // 8. LEAD reopens CLOSED -> OPEN (SUCCEEDS)
      const leadReopen = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${leadToken}`)
        .send({ status: "OPEN" });
      expect(leadReopen.status).toBe(200);
      expect(leadReopen.body.status).toBe("OPEN");
      expect(leadReopen.body.version).toBe(6);
    });

    it("POST /api/v1/items/:id/assign - enforces team boundary and handles no-ops cleanly", async () => {
      // 1. Create user outside core-ops team
      const [outsider] = await db
        .insert(users)
        .values({
          name: "Outsider User",
          email: `outsider-${Date.now()}@newtonite.dev`,
          passwordHash: "dummy",
        })
        .returning();

      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Assignment boundary item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // 2. Reject assignment to user outside team
      const rejectRes = await request(app)
        .post(`/api/v1/items/${itemId}/assign`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ assigneeId: outsider.id });

      expect(rejectRes.status).toBe(400);
      expect(rejectRes.body.error.code).toBe("BAD_REQUEST");
      expect(rejectRes.body.error.message).toContain("Assignee must be an active member of the item's team");

      // 3. Assign to valid active team member (lead)
      const assignRes = await request(app)
        .post(`/api/v1/items/${itemId}/assign`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ assigneeId: leadUserId });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.assigneeId).toBe(leadUserId);
      expect(assignRes.body.version).toBe(2);

      // Verify ASSIGNED event
      const [assignedEvent] = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "ASSIGNED")
          )
        );
      expect(assignedEvent).toBeDefined();
      expect(assignedEvent.actorId).toBe(memberUserId);
      expect((assignedEvent.newValue as any).assigneeId).toBe(leadUserId);

      // 4. No-op assignment to same assignee: returns 200 without version bump or extra event
      const noopRes = await request(app)
        .post(`/api/v1/items/${itemId}/assign`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ assigneeId: leadUserId });

      expect(noopRes.status).toBe(200);
      expect(noopRes.body.version).toBe(2); // Unchanged

      const allEvents = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "ASSIGNED")
          )
        );
      expect(allEvents).toHaveLength(1); // No duplicate event

      // 5. Unassign item (assigneeId: null)
      const unassignRes = await request(app)
        .post(`/api/v1/items/${itemId}/assign`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ assigneeId: null });

      expect(unassignRes.status).toBe(200);
      expect(unassignRes.body.assigneeId).toBeNull();
      expect(unassignRes.body.version).toBe(3);

      // Cleanup outsider user
      await db.delete(users).where(eq(users.id, outsider.id));
    });

    it("Optimistic locking - rejects stale expectedVersion with 409 Conflict across all workflow endpoints", async () => {
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Stale version test item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      // 1. Stale claim
      const staleClaim = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ expectedVersion: 999 });
      expect(staleClaim.status).toBe(409);
      expect(staleClaim.body.error.code).toBe("CONFLICT");

      // 2. Stale transition
      const staleTransition = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ status: "IN_PROGRESS", expectedVersion: 999 });
      expect(staleTransition.status).toBe(409);
      expect(staleTransition.body.error.code).toBe("CONFLICT");

      // 3. Stale assign
      const staleAssign = await request(app)
        .post(`/api/v1/items/${itemId}/assign`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({ assigneeId: leadUserId, expectedVersion: 999 });
      expect(staleAssign.status).toBe(409);
      expect(staleAssign.body.error.code).toBe("CONFLICT");

      // Verify no activity events exist for these failed mutations
      const failedEvents = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            sql`${activityEvents.eventType} != 'CREATED'`
          )
        );
      expect(failedEvents).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 6. Phase 5 - Mutation Idempotency & Duplicate Protection Tests
  // ==========================================================================
  describe("6. Phase 5 - Mutation Idempotency & Duplicate Protection", () => {
    it("POST /api/v1/items - returns original stored response on valid retry with same Idempotency-Key", async () => {
      const idempotencyKey = `create-item-key-${Date.now()}`;
      const payload = {
        teamId: coreOpsTeamId,
        title: "Idempotent task creation test",
        description: "Must only be created once.",
        type: "TASK",
        priority: "HIGH",
      };

      // 1. Initial request
      const firstRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", idempotencyKey)
        .send(payload);

      expect(firstRes.status).toBe(201);
      expect(firstRes.headers["idempotent-replay"]).toBeUndefined();
      const itemId = firstRes.body.id;
      createdTestItemIds.push(itemId);

      // 2. Exact retry with same key and same payload
      const secondRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", idempotencyKey)
        .send(payload);

      expect(secondRes.status).toBe(201);
      expect(secondRes.headers["idempotent-replay"]).toBe("true");
      expect(secondRes.body.id).toBe(itemId);
      expect(secondRes.body.title).toBe(payload.title);

      // 3. Verify exactly one work item exists in DB for this title
      const items = await db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.teamId, coreOpsTeamId),
            eq(workItems.title, payload.title)
          )
        );
      expect(items).toHaveLength(1);

      // 4. Verify exactly one CREATED activity event exists in DB
      const activities = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "CREATED")
          )
        );
      expect(activities).toHaveLength(1);
    });

    it("POST /api/v1/items - rejects reuse of Idempotency-Key with different payload (422 Unprocessable Entity)", async () => {
      const idempotencyKey = `create-mismatch-key-${Date.now()}`;
      const payload1 = {
        teamId: coreOpsTeamId,
        title: "Original payload title",
        type: "TASK",
      };
      const payload2 = {
        teamId: coreOpsTeamId,
        title: "Different modified title with same key",
        type: "TASK",
      };

      // 1. First request
      const firstRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", idempotencyKey)
        .send(payload1);

      expect(firstRes.status).toBe(201);
      createdTestItemIds.push(firstRes.body.id);

      // 2. Second request with same key but different payload
      const mismatchRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", idempotencyKey)
        .send(payload2);

      expect(mismatchRes.status).toBe(422);
      expect(mismatchRes.body.error.code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
      expect(mismatchRes.body.error.message).toContain("different request payload");
    });

    it("POST /api/v1/items - scopes idempotency keys to authenticated actor", async () => {
      const sharedKey = `shared-actor-scope-key-${Date.now()}`;
      const payload = {
        teamId: coreOpsTeamId,
        title: "Actor scoping test task",
        type: "TASK",
      };

      // 1. Member creates item with key
      const memberRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", sharedKey)
        .send(payload);

      expect(memberRes.status).toBe(201);
      createdTestItemIds.push(memberRes.body.id);

      // 2. Lead uses the exact same key: because actorId is different, it must NOT collide or replay
      const leadRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${leadToken}`)
        .set("Idempotency-Key", sharedKey)
        .send(payload);

      expect(leadRes.status).toBe(201);
      expect(leadRes.headers["idempotent-replay"]).toBeUndefined();
      expect(leadRes.body.id).not.toBe(memberRes.body.id);
      createdTestItemIds.push(leadRes.body.id);
    });

    it("POST /api/v1/items/:id/claim - retrying claim with same key replays stored response safely", async () => {
      // 1. Create an unassigned open item
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Claim idempotency item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      const claimKey = `claim-key-${Date.now()}`;

      // 2. First claim with idempotency key
      const firstClaim = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", claimKey)
        .send();

      expect(firstClaim.status).toBe(200);
      expect(firstClaim.body.assigneeId).toBe(memberUserId);
      expect(firstClaim.body.version).toBe(2);

      // 3. Retry claim with same idempotency key (would return 409 Conflict without idempotency!)
      const retryClaim = await request(app)
        .post(`/api/v1/items/${itemId}/claim`)
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", claimKey)
        .send();

      expect(retryClaim.status).toBe(200);
      expect(retryClaim.headers["idempotent-replay"]).toBe("true");
      expect(retryClaim.body.version).toBe(2);

      // 4. Verify only 1 CLAIMED activity event exists
      const claimEvents = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "CLAIMED")
          )
        );
      expect(claimEvents).toHaveLength(1);
    });

    it("POST /api/v1/items/:id/transition - retrying transition with same key replays stored response", async () => {
      const createRes = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Transition idempotency item",
          type: "TASK",
        });

      const itemId = createRes.body.id;
      createdTestItemIds.push(itemId);

      const transitionKey = `transition-key-${Date.now()}`;

      // 1. First transition OPEN -> IN_PROGRESS
      const firstTransition = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", transitionKey)
        .send({ status: "IN_PROGRESS" });

      expect(firstTransition.status).toBe(200);
      expect(firstTransition.body.status).toBe("IN_PROGRESS");
      expect(firstTransition.body.version).toBe(2);

      // 2. Retry same transition with same key
      const retryTransition = await request(app)
        .post(`/api/v1/items/${itemId}/transition`)
        .set("Authorization", `Bearer ${memberToken}`)
        .set("Idempotency-Key", transitionKey)
        .send({ status: "IN_PROGRESS" });

      expect(retryTransition.status).toBe(200);
      expect(retryTransition.headers["idempotent-replay"]).toBe("true");
      expect(retryTransition.body.version).toBe(2);

      // Verify exactly 1 STATUS_CHANGED activity event exists
      const statusEvents = await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.itemId, itemId),
            eq(activityEvents.eventType, "STATUS_CHANGED")
          )
        );
      expect(statusEvents).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 7. Phase 6 - Transactional Outbox & Background Processing Tests
  // ==========================================================================
  describe("7. Phase 6 - Transactional Outbox & Background Processing", () => {
    let outboxItemId: string;

    it("writes outbox event in PENDING status in the same transaction as item creation", async () => {
      const res = await request(app)
        .post("/api/v1/items")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          teamId: coreOpsTeamId,
          title: "Outbox background event item",
          type: "TASK",
          assigneeId: memberUserId,
        });

      expect(res.status).toBe(201);
      outboxItemId = res.body.id;
      createdTestItemIds.push(outboxItemId);

      // Verify corresponding outbox event exists with status PENDING
      const [outboxEvent] = await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, "CREATED"),
            sql`${outboxEvents.payload}->>'itemId' = ${outboxItemId}`
          )
        )
        .limit(1);

      expect(outboxEvent).toBeDefined();
      expect(outboxEvent.status).toBe("PENDING");
      expect(outboxEvent.attempts).toBe(0);
      expect(outboxEvent.processedAt).toBeNull();
    });

    it("outbox relay processes PENDING event to PROCESSED and generates notifications idempotently", async () => {
      // 1. Fetch the specific pending outbox event created above
      const [pendingEvent] = await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, "CREATED"),
            sql`${outboxEvents.payload}->>'itemId' = ${outboxItemId}`
          )
        )
        .limit(1);

      expect(pendingEvent).toBeDefined();
      const result = await processOutboxEvent(pendingEvent);
      expect(result.status).toBe("PROCESSED");

      // 2. Outbox event is now marked PROCESSED
      const [processedEvent] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, pendingEvent.id))
        .limit(1);

      expect(processedEvent.status).toBe("PROCESSED");
      expect(processedEvent.processedAt).not.toBeNull();
      expect(processedEvent.lastError).toBeNull();

      // 3. Notification created for assignee (memberUserId)
      const notifs = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientId, memberUserId),
            eq(notifications.activityEventId, processedEvent.activityEventId)
          )
        );

      expect(notifs).toHaveLength(1);
      expect(notifs[0].readAt).toBeNull();

      // 4. Running processing again does not duplicate notification
      await processOutboxEvent(processedEvent);

      const notifsAfter = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientId, memberUserId),
            eq(notifications.activityEventId, processedEvent.activityEventId)
          )
        );

      expect(notifsAfter).toHaveLength(1);
    }, 30000);
  });

  // ==========================================================================
  // 8. Phase 7 - Notifications & Dashboard Summary APIs Tests
  // ==========================================================================
  describe("8. Phase 7 - Notifications & Dashboard Summary APIs", () => {
    let testNotificationId: string;

    it("GET /api/v1/notifications - retrieves paginated notifications for authenticated user", async () => {
      const res = await request(app)
        .get("/api/v1/notifications?page=1&limit=10")
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("pagination");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      testNotificationId = res.body.data[0].id;
      expect(res.body.data[0].recipientId).toBe(memberUserId);
      expect(res.body.data[0].event).toBeDefined();
    });

    it("GET /api/v1/notifications/unread-count - returns unread notification count", async () => {
      const res = await request(app)
        .get("/api/v1/notifications/unread-count")
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("count");
      expect(typeof res.body.count).toBe("number");
      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    it("PATCH /api/v1/notifications/:id/read - marks a specific notification as read", async () => {
      expect(testNotificationId).toBeDefined();

      const res = await request(app)
        .patch(`/api/v1/notifications/${testNotificationId}/read`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(testNotificationId);
      expect(res.body.readAt).not.toBeNull();
    });

    it("POST /api/v1/notifications/read-all - marks all unread notifications as read", async () => {
      const res = await request(app)
        .post("/api/v1/notifications/read-all")
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("updatedCount");

      // Verify unread count is now 0
      const countRes = await request(app)
        .get("/api/v1/notifications/unread-count")
        .set("Authorization", `Bearer ${memberToken}`);

      expect(countRes.status).toBe(200);
      expect(countRes.body.count).toBe(0);
    });

    it("GET /api/v1/dashboard/summary - retrieves team-scoped metrics and recent activity", async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?teamId=${coreOpsTeamId}`)
        .set("Authorization", `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("team");
      expect(res.body.team.id).toBe(coreOpsTeamId);
      expect(res.body.team.name).toBe("Core Operations");

      expect(res.body).toHaveProperty("metrics");
      expect(res.body.metrics.totalWorkItems).toBeGreaterThanOrEqual(1);
      expect(res.body.metrics).toHaveProperty("byStatus");
      expect(res.body.metrics.byStatus).toHaveProperty("OPEN");
      expect(res.body.metrics.byStatus).toHaveProperty("IN_PROGRESS");
      expect(res.body.metrics).toHaveProperty("byPriority");
      expect(res.body.metrics.byPriority).toHaveProperty("NORMAL");

      expect(res.body).toHaveProperty("recentActivity");
      expect(Array.isArray(res.body.recentActivity)).toBe(true);
      expect(res.body.recentActivity.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/v1/dashboard/summary - denies cross-team access with 404 Not Found", async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?teamId=${coreOpsTeamId}`)
        .set("Authorization", `Bearer ${externalUserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
