import { eq, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  incidents,
  incidentResponders,
  incidentTimelineEvents,
  incidentLinkedItems,
  workItems,
  workItemSlas,
  users,
  Incident,
} from "../../db";
import { NotFoundError } from "../../shared/errors";
import { getTeamMembership } from "../../middleware/authorize";

export interface IntelligenceFinding {
  id: string;
  category:
    | "SEVERITY_IMPACT"
    | "SLA_BREACH"
    | "COMMAND_RESPONSE"
    | "WORK_ITEMS"
    | "ACTIVITY_STALENESS";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  finding: string;
  evidence: string;
  whyItMatters: string;
  recommendedAction: string;
}

export interface RecommendedActionItem {
  priority: "IMMEDIATE" | "HIGH" | "MEDIUM" | "ROUTINE";
  action: string;
  rationale: string;
}

export interface IncidentIntelligence {
  incidentId: string;
  incidentTitle: string;
  teamId: string;
  status: string;
  severity: string;
  impact: string;
  declaredAt: string;
  resolvedAt: string | null;
  ageMinutes: number;
  ageFormatted: string;
  isResolved: boolean;

  // Explainable heuristic risk score & rating
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  riskScore: number; // 0 - 100 rule-based deterministic score
  riskSummary: string;
  riskFactors: string[];

  // SLA state
  slaStatus: {
    hasSla: boolean;
    overallRiskState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA";
    breachedCount: number;
    atRiskCount: number;
    earliestDeadline: string | null;
    isOverdue: boolean;
  };

  // Command & roster
  commandStatus: {
    hasCommander: boolean;
    commanderId: string | null;
    commanderName: string | null;
    responderCount: number;
    rolesPresent: string[];
    missingKeyRoles: string[];
  };

  // Linked work items breakdown
  linkedItemsSummary: {
    total: number;
    open: number;
    inProgress: number;
    awaitingApproval: number;
    resolved: number;
    closed: number;
    unresolvedCount: number;
  };

  // Activity & staleness
  activityStatus: {
    timelineEventsCount: number;
    lastActivityAt: string | null;
    minutesSinceLastActivity: number | null;
    isStale: boolean;
    stalenessThresholdMinutes: number;
  };

  // Detailed 4-part findings
  findings: IntelligenceFinding[];

  // Actionable steps
  recommendedActions: RecommendedActionItem[];

  assessedAt: string;
}

export interface TeamIncidentsIntelligenceOverview {
  teamId: string;
  totalIncidents: number;
  activeIncidents: number;
  criticalRiskCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  slaBreachedCount: number;
  unassignedCommanderCount: number;
  staleIncidentsCount: number;
  incidents: Array<{
    incidentId: string;
    title: string;
    severity: string;
    impact: string;
    status: string;
    declaredAt: string;
    riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    riskScore: number;
    riskSummary: string;
    hasCommander: boolean;
    commanderName: string | null;
    unresolvedItemsCount: number;
    slaRiskState: string;
    findingsCount: number;
  }>;
}

export class IncidentsIntelligenceService {
  /**
   * Formats duration in minutes into a concise human string.
   */
  private formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }

  /**
   * Generates deterministic explainable intelligence for a single incident.
   */
  async evaluateIncidentIntelligence(
    incidentId: string,
    options?: { now?: Date; tx?: any; requestingUserId?: string }
  ): Promise<IncidentIntelligence> {
    const tx = options?.tx ?? db;
    const now = options?.now ?? new Date();

    // 1. Fetch incident record with commander name
    const [incidentRow] = await tx
      .select({
        incident: incidents,
        commanderName: users.name,
      })
      .from(incidents)
      .leftJoin(users, eq(users.id, incidents.commanderId))
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!incidentRow) {
      throw new NotFoundError(`Incident with ID '${incidentId}' not found`);
    }

    const { incident, commanderName } = incidentRow;

    // Check team membership if requesting user ID is provided (IDOR mitigation)
    if (options?.requestingUserId) {
      const membership = await getTeamMembership(options.requestingUserId, incident.teamId);
      if (!membership) {
        throw new NotFoundError(`Incident with ID '${incidentId}' not found`);
      }
    }

    // 2. Fetch responders
    const responderRows = await tx
      .select({
        userId: incidentResponders.userId,
        role: incidentResponders.role,
        userName: users.name,
      })
      .from(incidentResponders)
      .innerJoin(users, eq(users.id, incidentResponders.userId))
      .where(eq(incidentResponders.incidentId, incidentId));

    // 3. Fetch linked items with SLA tracking
    const linkedRows = await tx
      .select({
        workItem: workItems,
        sla: workItemSlas,
      })
      .from(incidentLinkedItems)
      .innerJoin(workItems, eq(workItems.id, incidentLinkedItems.workItemId))
      .leftJoin(workItemSlas, eq(workItemSlas.workItemId, workItems.id))
      .where(eq(incidentLinkedItems.incidentId, incidentId));

    // 4. Fetch timeline events
    const timelineRows = await tx
      .select()
      .from(incidentTimelineEvents)
      .where(eq(incidentTimelineEvents.incidentId, incidentId))
      .orderBy(desc(incidentTimelineEvents.createdAt))
      .limit(10);

    // 5. Compute incident age and status flags
    const declaredTime = incident.declaredAt.getTime();
    const ageMinutes = Math.max(0, Math.floor((now.getTime() - declaredTime) / 60000));
    const ageFormatted = this.formatDuration(ageMinutes);
    const isResolved = ["RESOLVED", "POSTMORTEM", "CLOSED"].includes(incident.status);

    // Compute staleness
    let lastActivityTime = declaredTime;
    if (timelineRows.length > 0 && timelineRows[0].createdAt) {
      lastActivityTime = timelineRows[0].createdAt.getTime();
    } else if (incident.updatedAt) {
      lastActivityTime = incident.updatedAt.getTime();
    }
    const minutesSinceLastActivity = Math.max(
      0,
      Math.floor((now.getTime() - lastActivityTime) / 60000)
    );
    const stalenessThresholdMinutes = 60;
    const isStale = !isResolved && minutesSinceLastActivity > stalenessThresholdMinutes;

    // 6. Summarize Linked Work Items
    let openCount = 0;
    let inProgressCount = 0;
    let awaitingApprovalCount = 0;
    let resolvedCount = 0;
    let closedCount = 0;

    let slaBreachedCount = 0;
    let slaAtRiskCount = 0;
    let earliestDeadline: Date | null = null;

    for (const { workItem, sla } of linkedRows as Array<{ workItem: any; sla: any }>) {
      if (workItem.status === "OPEN") openCount++;
      else if (workItem.status === "IN_PROGRESS") inProgressCount++;
      else if (workItem.status === "AWAITING_APPROVAL") awaitingApprovalCount++;
      else if (workItem.status === "RESOLVED") resolvedCount++;
      else if (workItem.status === "CLOSED") closedCount++;

      if (sla) {
        if (sla.riskState === "BREACHED" || sla.breachedAt) {
          slaBreachedCount++;
        } else if (sla.riskState === "AT_RISK") {
          slaAtRiskCount++;
        }

        if (
          !["RESOLVED", "CLOSED"].includes(workItem.status) &&
          sla.resolutionDeadline
        ) {
          if (!earliestDeadline || sla.resolutionDeadline < earliestDeadline) {
            earliestDeadline = sla.resolutionDeadline;
          }
        }
      }
    }

    const unresolvedCount = openCount + inProgressCount + awaitingApprovalCount;
    const hasSla = (linkedRows as Array<{ workItem: any; sla: any }>).some(
      (r) => r.sla !== null
    );

    let overallSlaRiskState: "ON_TRACK" | "AT_RISK" | "BREACHED" | "COMPLETED" | "NO_SLA" =
      "NO_SLA";
    if (hasSla) {
      if (slaBreachedCount > 0) overallSlaRiskState = "BREACHED";
      else if (slaAtRiskCount > 0) overallSlaRiskState = "AT_RISK";
      else if (unresolvedCount === 0) overallSlaRiskState = "COMPLETED";
      else overallSlaRiskState = "ON_TRACK";
    }

    const isOverdue =
      earliestDeadline !== null && now.getTime() > earliestDeadline.getTime();

    // 7. Command & Roster evaluation
    const hasCommander = Boolean(incident.commanderId);
    const rolesPresent: string[] = Array.from(
      new Set((responderRows as Array<{ role: string }>).map((r) => r.role))
    );
    const missingKeyRoles: string[] = [];

    if (!hasCommander) missingKeyRoles.push("COMMANDER");
    if (!rolesPresent.includes("OPERATIONS")) missingKeyRoles.push("OPERATIONS");
    if (
      ["SEV1", "SEV2"].includes(incident.severity) &&
      !rolesPresent.includes("COMMUNICATIONS")
    ) {
      missingKeyRoles.push("COMMUNICATIONS");
    }

    // 8. Rule-Based Deterministic Risk Engine & Findings
    const findings: IntelligenceFinding[] = [];
    const recommendedActions: RecommendedActionItem[] = [];
    const riskFactors: string[] = [];
    let riskScore = 0;

    // RULE 1: Baseline Severity & Impact
    if (isResolved) {
      riskScore = 5;
      findings.push({
        id: "finding-lifecycle-resolved",
        category: "SEVERITY_IMPACT",
        severity: "INFO",
        finding: "Incident Lifecycle Resolved / Closed",
        evidence: `Incident status is ${incident.status}. Active operational emergency phase is concluded.`,
        whyItMatters:
          "System operations have been stabilized or mitigated. Remaining focus is on postmortem and preventive action verification.",
        recommendedAction:
          incident.status === "RESOLVED"
            ? "Complete postmortem documentation and advance lifecycle to POSTMORTEM or CLOSED."
            : "Review linked remediation tasks for long-term reliability hardening.",
      });
    } else {
      // Unresolved incident rules
      if (incident.severity === "SEV1") {
        const isOutage = incident.impact === "TOTAL_OUTAGE";
        riskScore += isOutage ? 50 : 40;
        riskFactors.push(isOutage ? "Critical SEV1 Total Outage" : "Critical SEV1 Severity");

        findings.push({
          id: "finding-severity-sev1",
          category: "SEVERITY_IMPACT",
          severity: "CRITICAL",
          finding: `Active ${incident.severity} Priority Incident (${incident.impact})`,
          evidence: `Declared severity is SEV1 with impact classified as ${incident.impact}. Active for ${ageFormatted}.`,
          whyItMatters:
            "SEV1 indicates critical business disruption, potential data impairment, or full system downtime requiring executive escalation.",
          recommendedAction:
            "Maintain continuous incident war-room coordination and post 30-minute status page updates to stakeholders.",
        });

        recommendedActions.push({
          priority: "IMMEDIATE",
          action: "Maintain active war-room protocol and regular stakeholder updates",
          rationale: "SEV1 incidents require continuous communication and senior oversight.",
        });
      } else if (incident.severity === "SEV2") {
        riskScore += 30;
        riskFactors.push("High SEV2 Severity");
        findings.push({
          id: "finding-severity-sev2",
          category: "SEVERITY_IMPACT",
          severity: "HIGH",
          finding: `High-Severity ${incident.severity} Incident (${incident.impact})`,
          evidence: `Severity is SEV2 with impact ${incident.impact}. Active for ${ageFormatted}.`,
          whyItMatters:
            "Major functional degradation impairs primary operations and risks escalating to a full outage if unmitigated.",
          recommendedAction:
            "Focus technical response team on root-cause containment and activate failover procedures if available.",
        });
      } else if (incident.severity === "SEV3") {
        riskScore += 15;
        riskFactors.push("Moderate SEV3 Severity");
      } else {
        riskScore += 5;
      }

      // RULE 2: Incident Commander Assignment
      if (!hasCommander) {
        const penalty = ["SEV1", "SEV2"].includes(incident.severity) ? 25 : 15;
        riskScore += penalty;
        riskFactors.push("Unassigned Incident Commander");

        findings.push({
          id: "finding-missing-commander",
          category: "COMMAND_RESPONSE",
          severity: "CRITICAL",
          finding: "Incident Commander is Unassigned",
          evidence: "commander_id is null on an active declared incident.",
          whyItMatters:
            "Without an assigned Incident Commander, decision-making authority, delegation of mitigation tasks, and communication lines lack central leadership.",
          recommendedAction:
            "Appoint an active Operations Lead or Admin as Incident Commander immediately.",
        });

        recommendedActions.push({
          priority: "IMMEDIATE",
          action: "Assign an Incident Commander",
          rationale:
            "Clear command structure is vital to serialize troubleshooting efforts and eliminate duplicative work.",
        });
      }

      // RULE 3: Response Team Roster
      if (responderRows.length === 0) {
        riskScore += 15;
        riskFactors.push("Empty Responder Roster");

        findings.push({
          id: "finding-empty-roster",
          category: "COMMAND_RESPONSE",
          severity: "HIGH",
          finding: "No Active Responders Registered",
          evidence: "incident_responders record count is 0.",
          whyItMatters:
            "Triage cannot progress systematically without assigned team members responsible for investigation, technical operations, and communications.",
          recommendedAction:
            "Assign primary technical responders and an operations engineer to the incident roster.",
        });

        recommendedActions.push({
          priority: "HIGH",
          action: "Assign primary responders to roster",
          rationale: "Ensure dedicated engineers are accountable for mitigation tasks.",
        });
      } else if (missingKeyRoles.length > 0) {
        findings.push({
          id: "finding-missing-roles",
          category: "COMMAND_RESPONSE",
          severity: "MEDIUM",
          finding: `Missing Recommended Incident Roles: ${missingKeyRoles.join(", ")}`,
          evidence: `Assigned roles present: [${rolesPresent.join(", ") || "None"}]. Recommended missing: [${missingKeyRoles.join(", ")}].`,
          whyItMatters:
            "High-priority incidents benefit from explicit role specialization to decouple technical triage from external stakeholder communication.",
          recommendedAction: `Designate team members to fulfill missing roles (${missingKeyRoles.join(", ")}).`,
        });
      }

      // RULE 4: SLA Breaches on Linked Remediation Items
      if (slaBreachedCount > 0) {
        riskScore += 25;
        riskFactors.push(`${slaBreachedCount} Breached SLA Target(s)`);

        findings.push({
          id: "finding-sla-breached",
          category: "SLA_BREACH",
          severity: "CRITICAL",
          finding: `${slaBreachedCount} Linked Work Item(s) Have Breached Agreed SLA Targets`,
          evidence: `Found ${slaBreachedCount} work item(s) associated with this incident where risk_state = 'BREACHED'.`,
          whyItMatters:
            "Contractual and operational response/resolution deadlines have elapsed, compounding regulatory and customer-trust liabilities.",
          recommendedAction:
            "Expedite resolution of breached linked items or reallocate senior engineers to unblock critical path items.",
        });

        recommendedActions.push({
          priority: "IMMEDIATE",
          action: "Address breached remediation work items",
          rationale: "Remediation tasks past deadline require immediate focus to restore operational compliance.",
        });
      } else if (slaAtRiskCount > 0) {
        riskScore += 15;
        riskFactors.push(`${slaAtRiskCount} Work Item(s) At-Risk of SLA Breach`);

        findings.push({
          id: "finding-sla-at-risk",
          category: "SLA_BREACH",
          severity: "HIGH",
          finding: `${slaAtRiskCount} Linked Work Item(s) Approaching SLA Warning Threshold`,
          evidence: `Found ${slaAtRiskCount} item(s) with risk_state = 'AT_RISK' approaching resolution deadlines.`,
          whyItMatters:
            "Warning thresholds indicate that less than 25% of allowable commitment time remains.",
          recommendedAction:
            "Verify assignee progress on at-risk tasks before commitment deadlines expire.",
        });
      }

      // RULE 5: Outstanding Linked Work Items
      if (unresolvedCount > 2) {
        riskScore += 15;
        riskFactors.push(`${unresolvedCount} Outstanding Remediation Items`);

        findings.push({
          id: "finding-high-unresolved-items",
          category: "WORK_ITEMS",
          severity: "MEDIUM",
          finding: `Multiple Unresolved Linked Items (${unresolvedCount} items pending)`,
          evidence: `${openCount} OPEN, ${inProgressCount} IN_PROGRESS, and ${awaitingApprovalCount} AWAITING_APPROVAL linked items.`,
          whyItMatters:
            "A high volume of concurrent unfinished tasks creates operational bottleneck and delays conclusive mitigation.",
          recommendedAction:
            "Review task dependencies and sequence work items to unblock root-cause mitigation first.",
        });
      } else if (unresolvedCount === 0 && !isResolved) {
        findings.push({
          id: "finding-no-open-items",
          category: "WORK_ITEMS",
          severity: "INFO",
          finding: "All Linked Remediation Work Items are Resolved",
          evidence: `All ${linkedRows.length} linked work item(s) have reached RESOLVED or CLOSED status.`,
          whyItMatters:
            "With all mitigation items finished, the incident may be ready for verification and transition to RESOLVED.",
          recommendedAction:
            "Confirm service health metrics and transition incident status to RESOLVED.",
        });

        recommendedActions.push({
          priority: "HIGH",
          action: "Verify system stability and transition incident to RESOLVED",
          rationale: "All technical tasks are complete; formal incident resolution can be declared.",
        });
      }

      // RULE 6: Timeline Staleness
      if (isStale) {
        riskScore += 15;
        riskFactors.push(`Stale Activity (${minutesSinceLastActivity}m silent)`);

        findings.push({
          id: "finding-stale-timeline",
          category: "ACTIVITY_STALENESS",
          severity: "HIGH",
          finding: `Prolonged Timeline Silence (${minutesSinceLastActivity} Minutes Since Last Update)`,
          evidence: `Last timeline event recorded ${minutesSinceLastActivity}m ago (policy staleness threshold: ${stalenessThresholdMinutes}m).`,
          whyItMatters:
            "Inactivity during an active incident impairs situational awareness, obscures mitigation progress, and delays support escalation.",
          recommendedAction:
            "Post an operational status note to the incident timeline detailing current mitigation progress.",
        });

        recommendedActions.push({
          priority: "HIGH",
          action: "Post updated status note to timeline",
          rationale: "Over 60 minutes have elapsed without progress logging on an active incident.",
        });
      }
    }

    // Cap risk score between 0 and 100
    riskScore = Math.min(Math.max(riskScore, 0), 100);

    // Determine deterministic risk level
    let riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (riskScore >= 70) riskLevel = "CRITICAL";
    else if (riskScore >= 45) riskLevel = "HIGH";
    else if (riskScore >= 20) riskLevel = "MEDIUM";

    let riskSummary = "";
    if (isResolved) {
      riskSummary = "Resolved incident; operational emergency completed.";
    } else if (riskLevel === "CRITICAL") {
      riskSummary = `Critical operational risk (${riskFactors.join(", ") || "Active severe conditions"}). Immediate intervention required.`;
    } else if (riskLevel === "HIGH") {
      riskSummary = `Elevated risk due to ${riskFactors.join(", ") || "incident conditions"}. Active tracking recommended.`;
    } else if (riskLevel === "MEDIUM") {
      riskSummary = `Moderate risk (${riskFactors.join(", ") || "Standard monitoring"}). Normal incident triage progressing.`;
    } else {
      riskSummary = "Low operational risk; contained or progressing within targets.";
    }

    // Default recommended action if list empty
    if (recommendedActions.length === 0) {
      recommendedActions.push({
        priority: "ROUTINE",
        action: "Continue monitoring until full postmortem review",
        rationale: "Incident is stable and within expected operational boundaries.",
      });
    }

    return {
      incidentId: incident.id,
      incidentTitle: incident.title,
      teamId: incident.teamId,
      status: incident.status,
      severity: incident.severity,
      impact: incident.impact,
      declaredAt: incident.declaredAt.toISOString(),
      resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
      ageMinutes,
      ageFormatted,
      isResolved,
      riskLevel,
      riskScore,
      riskSummary,
      riskFactors,
      slaStatus: {
        hasSla,
        overallRiskState: overallSlaRiskState,
        breachedCount: slaBreachedCount,
        atRiskCount: slaAtRiskCount,
        earliestDeadline: earliestDeadline ? earliestDeadline.toISOString() : null,
        isOverdue,
      },
      commandStatus: {
        hasCommander,
        commanderId: incident.commanderId,
        commanderName: commanderName ?? null,
        responderCount: responderRows.length,
        rolesPresent,
        missingKeyRoles,
      },
      linkedItemsSummary: {
        total: linkedRows.length,
        open: openCount,
        inProgress: inProgressCount,
        awaitingApproval: awaitingApprovalCount,
        resolved: resolvedCount,
        closed: closedCount,
        unresolvedCount,
      },
      activityStatus: {
        timelineEventsCount: timelineRows.length,
        lastActivityAt: new Date(lastActivityTime).toISOString(),
        minutesSinceLastActivity,
        isStale,
        stalenessThresholdMinutes,
      },
      findings,
      recommendedActions,
      assessedAt: now.toISOString(),
    };
  }

  /**
   * Generates a team-wide overview aggregating explainable intelligence across all incidents.
   */
  async getTeamOverview(
    teamId: string,
    options?: { now?: Date; tx?: any; requestingUserId?: string }
  ): Promise<TeamIncidentsIntelligenceOverview> {
    const tx = options?.tx ?? db;
    const now = options?.now ?? new Date();

    const teamIncidents = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(eq(incidents.teamId, teamId))
      .orderBy(desc(incidents.declaredAt));

    const evaluatedList: IncidentIntelligence[] = [];
    for (const row of teamIncidents) {
      try {
        const intel = await this.evaluateIncidentIntelligence(row.id, {
          now,
          tx,
          requestingUserId: options?.requestingUserId,
        });
        evaluatedList.push(intel);
      } catch (err: any) {
        console.warn(`[Intelligence] Error evaluating incident ${row.id}:`, err.message);
      }
    }

    // Sort by risk score descending, with active incidents prioritized over resolved
    evaluatedList.sort((a, b) => {
      if (a.isResolved !== b.isResolved) {
        return a.isResolved ? 1 : -1;
      }
      return b.riskScore - a.riskScore;
    });

    let activeCount = 0;
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let slaBreachedCount = 0;
    let unassignedCommanderCount = 0;
    let staleCount = 0;

    for (const intel of evaluatedList) {
      if (!intel.isResolved) {
        activeCount++;
        if (intel.riskLevel === "CRITICAL") criticalCount++;
        else if (intel.riskLevel === "HIGH") highCount++;
        else if (intel.riskLevel === "MEDIUM") mediumCount++;
        else lowCount++;

        if (intel.slaStatus.breachedCount > 0) slaBreachedCount++;
        if (!intel.commandStatus.hasCommander) unassignedCommanderCount++;
        if (intel.activityStatus.isStale) staleCount++;
      }
    }

    return {
      teamId,
      totalIncidents: evaluatedList.length,
      activeIncidents: activeCount,
      criticalRiskCount: criticalCount,
      highRiskCount: highCount,
      mediumRiskCount: mediumCount,
      lowRiskCount: lowCount,
      slaBreachedCount,
      unassignedCommanderCount,
      staleIncidentsCount: staleCount,
      incidents: evaluatedList.map((i) => ({
        incidentId: i.incidentId,
        title: i.incidentTitle,
        severity: i.severity,
        impact: i.impact,
        status: i.status,
        declaredAt: i.declaredAt,
        riskLevel: i.riskLevel,
        riskScore: i.riskScore,
        riskSummary: i.riskSummary,
        hasCommander: i.commandStatus.hasCommander,
        commanderName: i.commandStatus.commanderName,
        unresolvedItemsCount: i.linkedItemsSummary.unresolvedCount,
        slaRiskState: i.slaStatus.overallRiskState,
        findingsCount: i.findings.length,
      })),
    };
  }
}

export const incidentsIntelligenceService = new IncidentsIntelligenceService();
