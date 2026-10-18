import { eq, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  incidents,
  incidentLinkedItems,
  workItems,
  workItemSlas,
  users,
  Incident,
  WorkItem,
} from "../../db";
import { NotFoundError } from "../../shared/errors";
import { getTeamMembership } from "../../middleware/authorize";

export interface BlastRadiusNode {
  id: string;
  type: "INCIDENT_ROOT" | "LINKED_WORK_ITEM";
  title: string;
  itemType?: "TASK" | "INCIDENT" | "REQUEST";
  status: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  severity?: string;
  impact?: string;
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  sla?: {
    riskState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA";
    resolutionDeadline: string | null;
    responseDeadline: string | null;
    isOverdue: boolean;
    breachedAt: string | null;
  } | null;
  linkedAt?: string;
  linkedByName?: string | null;
  isUnresolved: boolean;
  isUrgentOrHigh: boolean;
}

export interface BlastRadiusEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: "DIRECT_LINK" | "SHARED_ASSIGNEE";
  label: string;
  isDirect: boolean; // true for explicit incident_linked_items, false for correlation
  description: string;
}

export interface BlastRadiusSummary {
  incidentId: string;
  incidentTitle: string;
  teamId: string;
  severity: string;
  impact: string;
  status: string;
  declaredAt: string;
  resolvedAt: string | null;
  commander: {
    id: string;
    name: string;
    email: string;
  } | null;

  // Counts
  totalDirectlyLinkedItems: number;
  unresolvedCount: number;
  resolvedCount: number;
  urgentOrHighCount: number;
  breachedSlaCount: number;
  atRiskSlaCount: number;
  uniqueAssigneesCount: number;
  unassignedItemsCount: number;

  // Deterministic impact evaluation
  blastRadiusLevel: "CRITICAL" | "HIGH" | "ELEVATED" | "CONTAINED" | "MINIMAL";
  impactSummary: string;
  riskHighlights: string[];

  // Graph representation
  nodes: BlastRadiusNode[];
  edges: BlastRadiusEdge[];

  // Timestamp
  generatedAt: string;
}

export class IncidentsBlastRadiusService {
  /**
   * Retrieves the real dependency graph and blast-radius evaluation for an incident.
   * Only uses actual database relationships (incident -> incident_linked_items -> work_items).
   */
  async getIncidentBlastRadius(
    incidentId: string,
    options?: { requestingUserId?: string; tx?: any }
  ): Promise<BlastRadiusSummary> {
    const tx = options?.tx ?? db;
    const now = new Date();

    // 1. Fetch Incident with Commander
    const [incidentRow] = await tx
      .select({
        incident: incidents,
        commanderName: users.name,
        commanderEmail: users.email,
      })
      .from(incidents)
      .leftJoin(users, eq(users.id, incidents.commanderId))
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incidentRow) {
      throw new NotFoundError(`Incident with ID '${incidentId}' not found`);
    }

    const { incident, commanderName, commanderEmail } = incidentRow;

    // 2. Authorize requesting user membership (IDOR prevention)
    if (options?.requestingUserId) {
      const membership = await getTeamMembership(
        options.requestingUserId,
        incident.teamId
      );
      if (!membership) {
        throw new NotFoundError(`Incident with ID '${incidentId}' not found`);
      }
    }

    // 3. Fetch all explicitly linked work items, with assignee, linker, and SLA
    const linkedItemRows = await tx
      .select({
        link: incidentLinkedItems,
        item: workItems,
        assigneeName: users.name,
        assigneeEmail: users.email,
        sla: workItemSlas,
      })
      .from(incidentLinkedItems)
      .innerJoin(workItems, eq(workItems.id, incidentLinkedItems.workItemId))
      .leftJoin(users, eq(users.id, workItems.assigneeId))
      .leftJoin(workItemSlas, eq(workItemSlas.workItemId, workItems.id))
      .where(eq(incidentLinkedItems.incidentId, incidentId))
      .orderBy(desc(incidentLinkedItems.linkedAt));

    // Optional query for linker name if needed
    const linkerIds: string[] = [];
    for (const row of linkedItemRows) {
      if (row.link.linkedById && !linkerIds.includes(row.link.linkedById)) {
        linkerIds.push(row.link.linkedById);
      }
    }

    const linkerMap = new Map<string, string>();
    if (linkerIds.length > 0) {
      const linkerUsers = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, linkerIds));
      for (const u of linkerUsers) {
        linkerMap.set(u.id, u.name);
      }
    }

    // 4. Construct Root Node
    const isIncidentResolved = ["RESOLVED", "POSTMORTEM", "CLOSED"].includes(
      incident.status
    );

    const rootNode: BlastRadiusNode = {
      id: incident.id,
      type: "INCIDENT_ROOT",
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      impact: incident.impact,
      assignee: incident.commanderId
        ? {
            id: incident.commanderId,
            name: commanderName ?? "Incident Commander",
            email: commanderEmail ?? "",
          }
        : null,
      isUnresolved: !isIncidentResolved,
      isUrgentOrHigh: ["SEV1", "SEV2"].includes(incident.severity),
    };

    // 5. Construct Linked Work Item Nodes and Direct Edges
    const nodes: BlastRadiusNode[] = [rootNode];
    const edges: BlastRadiusEdge[] = [];

    let unresolvedCount = 0;
    let resolvedCount = 0;
    let urgentOrHighCount = 0;
    let breachedSlaCount = 0;
    let atRiskSlaCount = 0;
    let unassignedItemsCount = 0;
    const assigneeSet = new Set<string>();
    const assigneeToItemMap = new Map<string, string[]>();

    for (const row of linkedItemRows) {
      const { link, item, assigneeName, assigneeEmail, sla } = row;
      const isItemResolved = ["RESOLVED", "CLOSED"].includes(item.status);
      const isUrgentOrHigh = ["HIGH", "URGENT"].includes(item.priority);

      if (isItemResolved) {
        resolvedCount++;
      } else {
        unresolvedCount++;
      }

      if (isUrgentOrHigh && !isItemResolved) {
        urgentOrHighCount++;
      }

      if (item.assigneeId) {
        assigneeSet.add(item.assigneeId);
        if (!assigneeToItemMap.has(item.assigneeId)) {
          assigneeToItemMap.set(item.assigneeId, []);
        }
        assigneeToItemMap.get(item.assigneeId)!.push(item.id);
      } else if (!isItemResolved) {
        unassignedItemsCount++;
      }

      // SLA Evaluation
      let slaState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA" =
        "NO_SLA";
      let isOverdue = false;

      if (sla) {
        slaState = sla.riskState;
        if (sla.riskState === "BREACHED" || sla.breachedAt) {
          breachedSlaCount++;
          isOverdue = true;
        } else if (sla.riskState === "AT_RISK") {
          atRiskSlaCount++;
        }
        if (
          !isItemResolved &&
          sla.resolutionDeadline &&
          sla.resolutionDeadline.getTime() < now.getTime()
        ) {
          isOverdue = true;
        }
      }

      const itemNode: BlastRadiusNode = {
        id: item.id,
        type: "LINKED_WORK_ITEM",
        title: item.title,
        itemType: item.type as any,
        status: item.status,
        priority: item.priority as any,
        assignee: item.assigneeId
          ? {
              id: item.assigneeId,
              name: assigneeName ?? "Assigned Engineer",
              email: assigneeEmail ?? "",
            }
          : null,
        sla: sla
          ? {
              riskState: slaState,
              resolutionDeadline: sla.resolutionDeadline
                ? sla.resolutionDeadline.toISOString()
                : null,
              responseDeadline: sla.responseDeadline
                ? sla.responseDeadline.toISOString()
                : null,
              isOverdue,
              breachedAt: sla.breachedAt ? sla.breachedAt.toISOString() : null,
            }
          : null,
        linkedAt: link.linkedAt ? link.linkedAt.toISOString() : undefined,
        linkedByName: link.linkedById
          ? linkerMap.get(link.linkedById) ?? null
          : null,
        isUnresolved: !isItemResolved,
        isUrgentOrHigh,
      };

      nodes.push(itemNode);

      // Direct edge from Incident -> Linked Work Item
      edges.push({
        id: `edge-root-${item.id}`,
        source: incident.id,
        target: item.id,
        relationshipType: "DIRECT_LINK",
        label: "Mitigation Item",
        isDirect: true,
        description: `Directly linked to incident ${incident.severity} via incident_linked_items on ${new Date(link.linkedAt).toLocaleDateString()}`,
      });
    }

    // 6. Supported secondary correlation: Shared Assignee
    // If 2 work items are assigned to the exact same engineer, add an inferred correlation edge
    for (const [assigneeId, itemIds] of Array.from(assigneeToItemMap.entries())) {
      if (itemIds.length >= 2) {
        for (let i = 0; i < itemIds.length - 1; i++) {
          const itemA = itemIds[i];
          const itemB = itemIds[i + 1];
          edges.push({
            id: `edge-shared-assignee-${itemA}-${itemB}`,
            source: itemA,
            target: itemB,
            relationshipType: "SHARED_ASSIGNEE",
            label: "Shared Assignee",
            isDirect: false,
            description: `Both work items are assigned to the same operational owner (${assigneeId})`,
          });
        }
      }
    }

    // 7. Deterministic Blast Radius Level Assessment
    const totalLinked = linkedItemRows.length;
    let blastRadiusLevel:
      | "CRITICAL"
      | "HIGH"
      | "ELEVATED"
      | "CONTAINED"
      | "MINIMAL" = "MINIMAL";

    const riskHighlights: string[] = [];

    if (totalLinked === 0) {
      blastRadiusLevel = "MINIMAL";
    } else if (breachedSlaCount > 0 || (incident.severity === "SEV1" && unresolvedCount > 0)) {
      blastRadiusLevel = "CRITICAL";
      if (breachedSlaCount > 0) riskHighlights.push(`${breachedSlaCount} SLA commitment(s) breached`);
      if (incident.severity === "SEV1") riskHighlights.push("Active SEV1 critical outage with unresolved work");
    } else if (urgentOrHighCount > 0 || atRiskSlaCount > 0 || (incident.severity === "SEV2" && unresolvedCount > 0)) {
      blastRadiusLevel = "HIGH";
      if (urgentOrHighCount > 0) riskHighlights.push(`${urgentOrHighCount} high/urgent priority item(s) pending`);
      if (atRiskSlaCount > 0) riskHighlights.push(`${atRiskSlaCount} SLA target(s) at immediate risk`);
    } else if (unresolvedCount > 0) {
      blastRadiusLevel = "ELEVATED";
      riskHighlights.push(`${unresolvedCount} active work item(s) pending completion`);
    } else {
      blastRadiusLevel = "CONTAINED";
      riskHighlights.push(`All ${totalLinked} linked mitigation work item(s) are completed/resolved`);
    }

    if (unassignedItemsCount > 0) {
      riskHighlights.push(`${unassignedItemsCount} unresolved item(s) unassigned`);
    }

    // 8. Concise Impact Summary
    let impactSummary = "";
    if (totalLinked === 0) {
      impactSummary =
        "No work items are currently linked to this incident. Blast radius is currently unmapped. Link relevant tasks or tickets in Incident Command to track operational impact.";
    } else if (unresolvedCount === 0) {
      impactSummary = `Contained blast radius: all ${totalLinked} linked work item(s) are resolved. Technical recovery verified across affected tasks.`;
    } else {
      impactSummary = `Active operational blast radius spanning ${totalLinked} linked item(s) across ${assigneeSet.size} assigned engineer(s). ${unresolvedCount} item(s) remain unresolved (${urgentOrHighCount} high/urgent priority), with ${breachedSlaCount} breached and ${atRiskSlaCount} at-risk SLA target(s).`;
    }

    return {
      incidentId: incident.id,
      incidentTitle: incident.title,
      teamId: incident.teamId,
      severity: incident.severity,
      impact: incident.impact,
      status: incident.status,
      declaredAt: incident.declaredAt.toISOString(),
      resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
      commander: incident.commanderId
        ? {
            id: incident.commanderId,
            name: commanderName ?? "Incident Commander",
            email: commanderEmail ?? "",
          }
        : null,
      totalDirectlyLinkedItems: totalLinked,
      unresolvedCount,
      resolvedCount,
      urgentOrHighCount,
      breachedSlaCount,
      atRiskSlaCount,
      uniqueAssigneesCount: assigneeSet.size,
      unassignedItemsCount,
      blastRadiusLevel,
      impactSummary,
      riskHighlights,
      nodes,
      edges,
      generatedAt: now.toISOString(),
    };
  }
}

export const incidentsBlastRadiusService = new IncidentsBlastRadiusService();
