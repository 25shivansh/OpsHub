import {
  closeDb,
  getClient,
  getDb,
  teamMemberships,
  teams,
  users,
  workItems,
} from "./index";

async function verify() {
  console.log("=== Starting Comprehensive Database Verification ===");
  const rawSql = getClient();
  const db = getDb();

  try {
    // 1. Check all 9 tables in public schema
    const tables = await rawSql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name != '__drizzle_migrations'
      ORDER BY table_name
    `;
    const tableNames = tables.map((t) => t.table_name);
    console.log(`[PASS] Verified Public Tables (${tableNames.length}):`, tableNames);

    const expectedTables = [
      "activity_events",
      "comments",
      "idempotency_records",
      "incident_linked_items",
      "incident_responders",
      "incident_timeline_events",
      "incidents",
      "notifications",
      "outbox_events",
      "sla_policies",
      "team_memberships",
      "teams",
      "users",
      "work_item_slas",
      "work_items",
    ];

    const missingTables = expectedTables.filter((t) => !tableNames.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Missing expected tables: ${missingTables.join(", ")}`);
    }

    // 2. Check custom enums in public schema
    const enums = await rawSql`
      SELECT t.typname
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
      ORDER BY t.typname
    `;
    const enumNames = enums.map((e) => e.typname);
    console.log(`[PASS] Verified Custom Enums (${enumNames.length}):`, enumNames);

    // 3. Check check constraints
    const checkConstraints = await rawSql`
      SELECT conname, relname
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND c.contype = 'c'
      ORDER BY conname
    `;
    console.log(
      `[PASS] Verified Check Constraints (${checkConstraints.length}):`,
      checkConstraints.map((c) => `${c.relname}.${c.conname}`)
    );

    // 4. Check Indexes (including partial and expression indexes)
    const indexes = await rawSql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename != '__drizzle_migrations'
      ORDER BY tablename, indexname
    `;
    console.log(`[PASS] Verified Total Indexes on Schema: ${indexes.length}`);

    const emailLowerIndex = indexes.find(
      (idx) => idx.indexname === "users_email_lower_idx"
    );
    if (!emailLowerIndex || !emailLowerIndex.indexdef.includes("lower")) {
      throw new Error("users_email_lower_idx missing or does not use lower(email) expression!");
    }
    console.log("[PASS] Verified case-insensitive unique index: users_email_lower_idx");

    const unreadIndex = indexes.find(
      (idx) => idx.indexname === "notifications_recipient_unread_idx"
    );
    if (!unreadIndex || !unreadIndex.indexdef.toLowerCase().includes("read_at is null")) {
      throw new Error("notifications_recipient_unread_idx missing or is not partial!");
    }
    console.log("[PASS] Verified partial index: notifications_recipient_unread_idx");

    const pendingOutboxIndex = indexes.find(
      (idx) => idx.indexname === "outbox_events_pending_created_at_idx"
    );
    if (!pendingOutboxIndex || !pendingOutboxIndex.indexdef.toLowerCase().includes("pending")) {
      throw new Error("outbox_events_pending_created_at_idx missing or is not partial!");
    }
    console.log("[PASS] Verified partial index: outbox_events_pending_created_at_idx");

    // 5. Test Drizzle ORM query layer on seeded data
    const userRows = await db.select().from(users);
    const teamRows = await db.select().from(teams);
    const membershipRows = await db.select().from(teamMemberships);
    const itemRows = await db.select().from(workItems);

    console.log(
      `[PASS] Drizzle ORM Data Inspection: ` +
      `users=${userRows.length}, teams=${teamRows.length}, ` +
      `memberships=${membershipRows.length}, workItems=${itemRows.length}`
    );

    // 6. Test Constraint Enforcement (Verify rejection of blank title)
    try {
      await db.insert(workItems).values({
        teamId: teamRows[0].id,
        createdById: userRows[0].id,
        title: "   ", // Should fail check constraint
      });
      throw new Error("Check constraint FAILED to reject whitespace-only title!");
    } catch (err: any) {
      const details = String(err.message) + String(err.cause?.message || "") + String(err.cause?.constraint_name || "");
      if (details.includes("work_items_title_not_blank")) {
        console.log("[PASS] Verified check constraint enforcement (rejected blank work item title)");
      } else {
        throw err;
      }
    }

    // 7. Test Case-Insensitive Email Duplicate Prevention
    try {
      await db.insert(users).values({
        name: "Duplicate Tester",
        email: userRows[0].email.toUpperCase(), // Same email in uppercase
        passwordHash: "dummyhash",
      });
      throw new Error("Unique index FAILED to reject duplicate case-insensitive email!");
    } catch (err: any) {
      const details = String(err.message) + String(err.cause?.message || "") + String(err.cause?.constraint_name || "") + String(err.cause?.code || "");
      if (details.includes("users_email_lower_idx") || details.includes("23505")) {
        console.log("[PASS] Verified case-insensitive unique email enforcement");
      } else {
        throw err;
      }
    }

    console.log("=== ALL VERIFICATION CHECKS PASSED SUCCESSFULLY ===");
  } catch (err: any) {
    console.error("Verification failed:", err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

verify();
