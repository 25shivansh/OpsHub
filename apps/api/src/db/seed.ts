import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { config } from "../config";
import {
  closeDb,
  getDb,
  teamMemberships,
  teams,
  users,
  workItems,
  slaPolicies,
  User,
  Team,
} from "./index";

/**
 * Deterministic Development Seed Script for Newtonite.
 *
 * Seed Credentials for Local Development:
 * - admin@newtonite.dev  / Password: Newtonite@123!  (Role: ADMIN)
 * - lead@newtonite.dev   / Password: Newtonite@123!  (Role: LEAD)
 * - member@newtonite.dev / Password: Newtonite@123!  (Role: MEMBER)
 * - viewer@newtonite.dev / Password: Newtonite@123!  (Role: VIEWER)
 */
export async function seed(): Promise<void> {
  if (config.NODE_ENV === "production") {
    throw new Error("Seeding is disabled in production environments.");
  }

  console.log("Starting deterministic database seed...");
  const db = getDb();

  // 1. Prepare deterministic password hash (bcrypt, 10 rounds)
  const defaultPassword = "Newtonite@123!";
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // 2. Seed Users
  const demoUsers = [
    {
      name: "Admin User",
      email: "admin@newtonite.dev",
      passwordHash,
      isActive: true,
    },
    {
      name: "Operations Lead",
      email: "lead@newtonite.dev",
      passwordHash,
      isActive: true,
    },
    {
      name: "Operations Member",
      email: "member@newtonite.dev",
      passwordHash,
      isActive: true,
    },
    {
      name: "Auditor Viewer",
      email: "viewer@newtonite.dev",
      passwordHash,
      isActive: true,
    },
  ];

  console.log("Checking and inserting demo users...");
  const userMap = new Map<string, User>();

  for (const u of demoUsers) {
    const existing = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${u.email.toLowerCase()}`)
      .limit(1);

    if (existing.length > 0) {
      userMap.set(u.email.toLowerCase(), existing[0]);
    } else {
      const [inserted] = await db.insert(users).values(u).returning();
      userMap.set(u.email.toLowerCase(), inserted);
    }
  }

  const admin = userMap.get("admin@newtonite.dev")!;
  const lead = userMap.get("lead@newtonite.dev")!;
  const member = userMap.get("member@newtonite.dev")!;
  const viewer = userMap.get("viewer@newtonite.dev")!;

  // 3. Seed Team
  console.log("Checking and inserting demo team...");
  const teamSlug = "core-ops";
  let seededTeam: Team;

  const existingTeams = await db
    .select()
    .from(teams)
    .where(sql`${teams.slug} = ${teamSlug}`)
    .limit(1);

  if (existingTeams.length > 0) {
    seededTeam = existingTeams[0];
  } else {
    const [inserted] = await db
      .insert(teams)
      .values({
        name: "Core Operations",
        slug: teamSlug,
      })
      .returning();
    seededTeam = inserted;
  }

  // 4. Seed Team Memberships
  console.log("Checking and inserting team memberships...");
  const demoMemberships = [
    { userId: admin.id, teamId: seededTeam.id, role: "ADMIN" as const },
    { userId: lead.id, teamId: seededTeam.id, role: "LEAD" as const },
    { userId: member.id, teamId: seededTeam.id, role: "MEMBER" as const },
    { userId: viewer.id, teamId: seededTeam.id, role: "VIEWER" as const },
  ];

  for (const m of demoMemberships) {
    const existing = await db
      .select()
      .from(teamMemberships)
      .where(
        sql`${teamMemberships.userId} = ${m.userId} AND ${teamMemberships.teamId} = ${m.teamId}`
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(teamMemberships).values(m);
    }
  }

  // 5. Seed Representative Work Items
  console.log("Checking and inserting demo work items...");
  const demoItems = [
    {
      teamId: seededTeam.id,
      title: "High latency on payment gateway webhook processing",
      description:
        "Spike in response time observed on webhook ingress. Requires investigation into pooler contention.",
      type: "INCIDENT" as const,
      status: "OPEN" as const,
      priority: "URGENT" as const,
      createdById: lead.id,
      assigneeId: member.id,
    },
    {
      teamId: seededTeam.id,
      title: "Review Q4 infrastructure capacity and Redis cluster memory",
      description:
        "Quarterly audit of BullMQ memory allocation and worker concurrency across availability zones.",
      type: "TASK" as const,
      status: "IN_PROGRESS" as const,
      priority: "HIGH" as const,
      createdById: admin.id,
      assigneeId: lead.id,
    },
    {
      teamId: seededTeam.id,
      title: "Provision staging database read-replica access",
      description:
        "Auditor requested read-only credentials for security compliance verification.",
      type: "REQUEST" as const,
      status: "RESOLVED" as const,
      priority: "NORMAL" as const,
      createdById: member.id,
      assigneeId: admin.id,
    },
  ];

  for (const item of demoItems) {
    const existing = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(
        sql`${workItems.teamId} = ${item.teamId} AND ${workItems.title} = ${item.title}`
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(workItems).values(item);
    }
  }

  // 6. Seed Default SLA Policies for Core Operations
  console.log("Checking and inserting demo SLA policies...");
  const demoPolicies = [
    {
      teamId: seededTeam.id,
      name: "Critical Incident Response Policy",
      workItemType: "INCIDENT" as const,
      priority: "URGENT" as const,
      responseTargetMinutes: 15,
      resolutionTargetMinutes: 60,
      warningThresholdPercent: 75,
      isActive: true,
    },
    {
      teamId: seededTeam.id,
      name: "High Priority Resolution Policy",
      workItemType: null,
      priority: "HIGH" as const,
      responseTargetMinutes: 30,
      resolutionTargetMinutes: 240,
      warningThresholdPercent: 75,
      isActive: true,
    },
    {
      teamId: seededTeam.id,
      name: "Standard Core Operations SLA",
      workItemType: null,
      priority: null,
      responseTargetMinutes: 120,
      resolutionTargetMinutes: 1440,
      warningThresholdPercent: 80,
      isActive: true,
    },
  ];

  for (const pol of demoPolicies) {
    const existing = await db
      .select({ id: slaPolicies.id })
      .from(slaPolicies)
      .where(
        sql`${slaPolicies.teamId} = ${pol.teamId} AND ${slaPolicies.name} = ${pol.name}`
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(slaPolicies).values(pol);
    }
  }

  console.log("Deterministic seed completed successfully!");
}

// Execute directly if run via CLI
if (require.main === module) {
  seed()
    .catch((err) => {
      console.error("Seed error:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
