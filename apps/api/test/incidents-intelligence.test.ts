import { describe, it, expect, vi } from "vitest";
import {
  incidentIntelligenceQuerySchema,
  incidentParamsSchema,
} from "../src/modules/incidents/incidents.schemas";
import {
  IncidentsIntelligenceService,
  incidentsIntelligenceService,
} from "../src/modules/incidents/incidents-intelligence.service";
import { NotFoundError } from "../src/shared/errors";

function createMockTx(options: {
  incident?: any;
  commanderName?: string | null;
  responders?: any[];
  linkedItems?: any[];
  timeline?: any[];
}) {
  let selectIndex = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectIndex++;
      const currentCall = selectIndex;

      let result: any = [];
      if (currentCall === 1) {
        result = options.incident
          ? [{ incident: options.incident, commanderName: options.commanderName ?? null }]
          : [];
      } else if (currentCall === 2) {
        result = options.responders ?? [];
      } else if (currentCall === 3) {
        result = options.linkedItems ?? [];
      } else if (currentCall === 4) {
        result = options.timeline ?? [];
      }

      const chain: any = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => Promise.resolve(result)),
        then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    }),
  };
}

describe("Newtonite Feature 4: Explainable Incident Intelligence", () => {
  // =========================================================================
  // 1. Schema Validation Tests
  // =========================================================================
  describe("1. Schema & Parameter Validation", () => {
    it("validates valid teamId for intelligence overview query", () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      const result = incidentIntelligenceQuerySchema.safeParse({ teamId: validUuid });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.teamId).toBe(validUuid);
      }
    });

    it("rejects non-UUID teamId in intelligence query", () => {
      const result = incidentIntelligenceQuerySchema.safeParse({ teamId: "invalid-id-format" });
      expect(result.success).toBe(false);
    });

    it("validates incident params schema with UUID", () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      const result = incidentParamsSchema.safeParse({ id: validUuid });
      expect(result.success).toBe(true);
    });

    it("rejects malicious or invalid incident id params", () => {
      const result = incidentParamsSchema.safeParse({ id: "select * from incidents" });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. Deterministic Risk Evaluation & 4-Part Explainable Findings
  // =========================================================================
  describe("2. Deterministic Risk Engine & 4-Part Explainable Findings", () => {
    const fixedNow = new Date("2026-10-18T12:00:00.000Z");

    it("evaluates active SEV1 TOTAL_OUTAGE incident with elevated risk and 4-part findings", async () => {
      const mockIncidentId = "11111111-1111-1111-1111-111111111111";
      const mockTeamId = "team-1234-5678-90ab-cdef12345678";

      const mockTx = createMockTx({
        incident: {
          id: mockIncidentId,
          teamId: mockTeamId,
          title: "Core Payment Gateway Down",
          severity: "SEV1",
          impact: "TOTAL_OUTAGE",
          status: "INVESTIGATING",
          commanderId: null, // Missing commander
          declaredAt: new Date("2026-10-18T10:00:00.000Z"), // 2 hours ago
          updatedAt: new Date("2026-10-18T10:30:00.000Z"),
        },
        commanderName: null,
        responders: [],
        linkedItems: [],
        timeline: [],
      });

      const service = new IncidentsIntelligenceService();
      const intel = await service.evaluateIncidentIntelligence(mockIncidentId, {
        now: fixedNow,
        tx: mockTx,
      });

      // Verify overall assessment
      expect(intel.incidentId).toBe(mockIncidentId);
      expect(intel.severity).toBe("SEV1");
      expect(intel.impact).toBe("TOTAL_OUTAGE");
      expect(intel.isResolved).toBe(false);
      expect(intel.riskLevel).toBe("CRITICAL");
      expect(intel.riskScore).toBeGreaterThanOrEqual(75);

      // Verify Command Status
      expect(intel.commandStatus.hasCommander).toBe(false);
      expect(intel.commandStatus.missingKeyRoles).toContain("COMMANDER");
      expect(intel.commandStatus.missingKeyRoles).toContain("OPERATIONS");
      expect(intel.commandStatus.missingKeyRoles).toContain("COMMUNICATIONS");

      // Verify Staleness (declared 10:00, updatedAt 10:30, fixedNow 12:00 = 90m since activity)
      expect(intel.activityStatus.isStale).toBe(true);
      expect(intel.activityStatus.minutesSinceLastActivity).toBe(90);

      // Verify that every single finding conforms to the 4-part rule requirement:
      // (1) Finding, (2) Evidence used, (3) Why it matters, (4) Practical recommended action
      expect(intel.findings.length).toBeGreaterThan(0);
      for (const finding of intel.findings) {
        expect(finding.finding).toBeTruthy();
        expect(finding.finding.length).toBeGreaterThan(5);

        expect(finding.evidence).toBeTruthy();
        expect(finding.evidence.length).toBeGreaterThan(5);

        expect(finding.whyItMatters).toBeTruthy();
        expect(finding.whyItMatters.length).toBeGreaterThan(5);

        expect(finding.recommendedAction).toBeTruthy();
        expect(finding.recommendedAction.length).toBeGreaterThan(5);
      }

      // Check specific recommended next actions
      expect(intel.recommendedActions.length).toBeGreaterThan(0);
      expect(intel.recommendedActions.some((a) => a.priority === "IMMEDIATE")).toBe(true);
    });

    it("evaluates linked work item SLA breaches and reflects them in explainable findings", async () => {
      const mockIncidentId = "22222222-2222-2222-2222-222222222222";
      const mockTeamId = "team-1234-5678-90ab-cdef12345678";

      const mockTx = createMockTx({
        incident: {
          id: mockIncidentId,
          teamId: mockTeamId,
          title: "Database Read Replica Latency",
          severity: "SEV2",
          impact: "MAJOR_DEGRADATION",
          status: "MITIGATING",
          commanderId: "user-cmd-1",
          declaredAt: new Date("2026-10-18T11:00:00.000Z"),
          updatedAt: new Date("2026-10-18T11:45:00.000Z"),
        },
        commanderName: "Sarah Connor",
        responders: [
          { userId: "user-cmd-1", role: "COMMANDER", userName: "Sarah Connor" },
          { userId: "user-ops-2", role: "OPERATIONS", userName: "John Connor" },
          { userId: "user-comm-3", role: "COMMUNICATIONS", userName: "Miles Dyson" },
        ],
        linkedItems: [
          {
            workItem: {
              id: "item-1",
              title: "Failover to secondary cluster",
              status: "IN_PROGRESS",
              priority: "URGENT",
            },
            sla: {
              id: "sla-1",
              riskState: "BREACHED",
              resolutionDeadline: new Date("2026-10-18T11:30:00.000Z"),
              breachedAt: new Date("2026-10-18T11:30:00.000Z"),
            },
          },
        ],
        timeline: [
          {
            id: "event-1",
            createdAt: new Date("2026-10-18T11:45:00.000Z"), // 15 mins ago
          },
        ],
      });

      const service = new IncidentsIntelligenceService();
      const intel = await service.evaluateIncidentIntelligence(mockIncidentId, {
        now: fixedNow,
        tx: mockTx,
      });

      expect(intel.commandStatus.hasCommander).toBe(true);
      expect(intel.commandStatus.missingKeyRoles).toHaveLength(0);
      expect(intel.activityStatus.isStale).toBe(false);

      // Verify SLA breached detection
      expect(intel.slaStatus.hasSla).toBe(true);
      expect(intel.slaStatus.overallRiskState).toBe("BREACHED");
      expect(intel.slaStatus.breachedCount).toBe(1);
      expect(intel.slaStatus.isOverdue).toBe(true);

      // Must have an SLA_BREACH category finding
      const slaFinding = intel.findings.find((f) => f.category === "SLA_BREACH");
      expect(slaFinding).toBeDefined();
      expect(slaFinding?.severity).toBe("CRITICAL");
      expect(slaFinding?.evidence).toContain("BREACHED");
      expect(slaFinding?.recommendedAction).toBeTruthy();
    });

    it("safely handles resolved incidents by capping risk score and providing resolution context", async () => {
      const mockIncidentId = "33333333-3333-3333-3333-333333333333";
      const mockTeamId = "team-1234-5678-90ab-cdef12345678";

      const mockTx = createMockTx({
        incident: {
          id: mockIncidentId,
          teamId: mockTeamId,
          title: "Resolved API Cache Invalidation",
          severity: "SEV3",
          impact: "MINOR_DEGRADATION",
          status: "RESOLVED",
          commanderId: "user-1",
          declaredAt: new Date("2026-10-18T08:00:00.000Z"),
          updatedAt: new Date("2026-10-18T09:30:00.000Z"),
        },
        commanderName: "Jane Doe",
        responders: [],
        linkedItems: [
          {
            workItem: { id: "item-resolved", status: "RESOLVED" },
            sla: null,
          },
        ],
        timeline: [],
      });

      const service = new IncidentsIntelligenceService();
      const intel = await service.evaluateIncidentIntelligence(mockIncidentId, {
        now: fixedNow,
        tx: mockTx,
      });

      expect(intel.isResolved).toBe(true);
      expect(intel.riskLevel).toBe("LOW");
      expect(intel.riskScore).toBeLessThanOrEqual(20);
      expect(intel.riskSummary).toContain("Resolved incident");
    });

    it("handles missing SLA records cleanly without throwing or fabricating SLA metrics", async () => {
      const mockIncidentId = "44444444-4444-4444-4444-444444444444";
      const mockTeamId = "team-1234-5678-90ab-cdef12345678";

      const mockTx = createMockTx({
        incident: {
          id: mockIncidentId,
          teamId: mockTeamId,
          title: "Simple Task Issue",
          severity: "SEV4",
          impact: "NO_IMPACT",
          status: "DECLARED",
          commanderId: null,
          declaredAt: new Date("2026-10-18T11:50:00.000Z"),
          updatedAt: new Date("2026-10-18T11:50:00.000Z"),
        },
        commanderName: null,
        responders: [],
        linkedItems: [],
        timeline: [],
      });

      const service = new IncidentsIntelligenceService();
      const intel = await service.evaluateIncidentIntelligence(mockIncidentId, {
        now: fixedNow,
        tx: mockTx,
      });

      expect(intel.slaStatus.hasSla).toBe(false);
      expect(intel.slaStatus.overallRiskState).toBe("NO_SLA");
      expect(intel.slaStatus.breachedCount).toBe(0);
      expect(intel.slaStatus.earliestDeadline).toBeNull();
      expect(intel.slaStatus.isOverdue).toBe(false);
    });

    it("throws NotFoundError when incident record does not exist", async () => {
      const mockTx = createMockTx({ incident: null });

      const service = new IncidentsIntelligenceService();
      await expect(
        service.evaluateIncidentIntelligence("non-existent-id", { tx: mockTx })
      ).rejects.toThrow(NotFoundError);
    });
  });
});
