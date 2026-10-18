import { describe, it, expect, vi } from "vitest";
import { incidentParamsSchema } from "../src/modules/incidents/incidents.schemas";
import {
  IncidentsBlastRadiusService,
} from "../src/modules/incidents/incidents-blast-radius.service";
import { NotFoundError } from "../src/shared/errors";

function createMockTx(options: {
  incident?: any;
  commanderName?: string | null;
  commanderEmail?: string | null;
  linkedItems?: any[];
  linkers?: any[];
}) {
  let selectIndex = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectIndex++;
      const currentCall = selectIndex;

      let result: any = [];
      if (currentCall === 1) {
        result = options.incident
          ? [
              {
                incident: options.incident,
                commanderName: options.commanderName ?? null,
                commanderEmail: options.commanderEmail ?? null,
              },
            ]
          : [];
      } else if (currentCall === 2) {
        result = options.linkedItems ?? [];
      } else if (currentCall === 3) {
        result = options.linkers ?? [];
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

describe("Newtonite Feature 5: Dependency & Blast-Radius Map", () => {
  const service = new IncidentsBlastRadiusService();

  // =========================================================================
  // 1. Schema Validation Tests
  // =========================================================================
  describe("1. Parameter & Schema Validation", () => {
    it("accepts valid UUID for blast-radius endpoint params", () => {
      const validUuid = "6b7acbea-9e27-43f8-855b-793ebca22296";
      const result = incidentParamsSchema.safeParse({ id: validUuid });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(validUuid);
      }
    });

    it("rejects non-UUID malicious parameter inputs", () => {
      const malicious = "'; DROP TABLE incidents; --";
      const result = incidentParamsSchema.safeParse({ id: malicious });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. Incident Not Found
  // =========================================================================
  describe("2. Incident Existence & Authorization", () => {
    it("throws NotFoundError when incident does not exist", async () => {
      const mockTx = createMockTx({ incident: null });
      await expect(
        service.getIncidentBlastRadius("00000000-0000-0000-0000-000000000000", {
          tx: mockTx,
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // 3. Honest Empty State (0 linked items)
  // =========================================================================
  describe("3. Honest Empty State (No Linked Items)", () => {
    it("returns single root node and zero edges when no work items are linked", async () => {
      const incidentId = "6b7acbea-9e27-43f8-855b-793ebca22296";
      const mockTx = createMockTx({
        incident: {
          id: incidentId,
          title: "API Gateway 502 Errors",
          teamId: "team-123",
          severity: "SEV2",
          impact: "MAJOR_DEGRADATION",
          status: "INVESTIGATING",
          commanderId: "user-cmd",
          declaredAt: new Date("2026-10-18T10:00:00Z"),
          resolvedAt: null,
        },
        commanderName: "Jane Commander",
        commanderEmail: "jane@newtonite.dev",
        linkedItems: [],
      });

      const result = await service.getIncidentBlastRadius(incidentId, { tx: mockTx });

      expect(result.incidentId).toBe(incidentId);
      expect(result.totalDirectlyLinkedItems).toBe(0);
      expect(result.unresolvedCount).toBe(0);
      expect(result.blastRadiusLevel).toBe("MINIMAL");
      expect(result.impactSummary).toContain("No work items are currently linked");
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].type).toBe("INCIDENT_ROOT");
      expect(result.edges).toHaveLength(0); // Zero fake edges
    });
  });

  // =========================================================================
  // 4. Graph Construction & Direct Links
  // =========================================================================
  describe("4. Graph Construction & Real Database Linkages", () => {
    it("builds root node and direct mitigation edges for linked work items", async () => {
      const incidentId = "6b7acbea-9e27-43f8-855b-793ebca22296";
      const item1Id = "11111111-1111-1111-1111-111111111111";
      const item2Id = "22222222-2222-2222-2222-222222222222";

      const mockTx = createMockTx({
        incident: {
          id: incidentId,
          title: "Database Connection Saturation",
          teamId: "team-123",
          severity: "SEV1",
          impact: "TOTAL_OUTAGE",
          status: "MITIGATING",
          commanderId: "user-cmd",
          declaredAt: new Date("2026-10-18T10:00:00Z"),
          resolvedAt: null,
        },
        commanderName: "Jane Commander",
        commanderEmail: "jane@newtonite.dev",
        linkedItems: [
          {
            link: {
              incidentId,
              workItemId: item1Id,
              linkedById: "user-cmd",
              linkedAt: new Date("2026-10-18T10:05:00Z"),
            },
            item: {
              id: item1Id,
              title: "Restart Supabase Pooler",
              type: "TASK",
              status: "IN_PROGRESS",
              priority: "URGENT",
              assigneeId: "user-dev1",
            },
            assigneeName: "Alice Engineer",
            assigneeEmail: "alice@newtonite.dev",
            sla: {
              riskState: "BREACHED",
              resolutionDeadline: new Date(Date.now() - 3600000),
              responseDeadline: null,
              breachedAt: new Date(Date.now() - 1800000),
            },
          },
          {
            link: {
              incidentId,
              workItemId: item2Id,
              linkedById: "user-cmd",
              linkedAt: new Date("2026-10-18T10:10:00Z"),
            },
            item: {
              id: item2Id,
              title: "Scale RDS Read Replicas",
              type: "TASK",
              status: "RESOLVED",
              priority: "HIGH",
              assigneeId: "user-dev2",
            },
            assigneeName: "Bob Ops",
            assigneeEmail: "bob@newtonite.dev",
            sla: {
              riskState: "COMPLETED",
              resolutionDeadline: new Date(Date.now() + 3600000),
              responseDeadline: null,
              breachedAt: null,
            },
          },
        ],
        linkers: [{ id: "user-cmd", name: "Jane Commander" }],
      });

      const result = await service.getIncidentBlastRadius(incidentId, { tx: mockTx });

      expect(result.totalDirectlyLinkedItems).toBe(2);
      expect(result.unresolvedCount).toBe(1);
      expect(result.resolvedCount).toBe(1);
      expect(result.urgentOrHighCount).toBe(1);
      expect(result.breachedSlaCount).toBe(1);
      expect(result.blastRadiusLevel).toBe("CRITICAL"); // SEV1 + unresolved + SLA breach
      expect(result.nodes).toHaveLength(3); // 1 root + 2 work items

      // Check direct link edges
      const directEdges = result.edges.filter((e) => e.relationshipType === "DIRECT_LINK");
      expect(directEdges).toHaveLength(2);
      expect(directEdges[0].source).toBe(incidentId);
      expect(directEdges[0].target).toBe(item1Id);
      expect(directEdges[0].isDirect).toBe(true);
    });
  });

  // =========================================================================
  // 5. Shared Assignee Correlation
  // =========================================================================
  describe("5. Shared Assignee Correlation Detection", () => {
    it("creates secondary correlation edge when 2 work items share identical assignee", async () => {
      const incidentId = "6b7acbea-9e27-43f8-855b-793ebca22296";
      const item1Id = "item-alpha";
      const item2Id = "item-beta";
      const sharedAssigneeId = "engineer-shared-1";

      const mockTx = createMockTx({
        incident: {
          id: incidentId,
          title: "Cache Node Degradation",
          teamId: "team-123",
          severity: "SEV3",
          impact: "MINOR_DEGRADATION",
          status: "IDENTIFIED",
          commanderId: null,
          declaredAt: new Date(),
          resolvedAt: null,
        },
        linkedItems: [
          {
            link: { incidentId, workItemId: item1Id, linkedAt: new Date() },
            item: {
              id: item1Id,
              title: "Flush Redis buffer",
              type: "TASK",
              status: "OPEN",
              priority: "NORMAL",
              assigneeId: sharedAssigneeId,
            },
            assigneeName: "Shared Engineer",
            assigneeEmail: "shared@newtonite.dev",
            sla: null,
          },
          {
            link: { incidentId, workItemId: item2Id, linkedAt: new Date() },
            item: {
              id: item2Id,
              title: "Increase Redis TTL",
              type: "TASK",
              status: "OPEN",
              priority: "NORMAL",
              assigneeId: sharedAssigneeId,
            },
            assigneeName: "Shared Engineer",
            assigneeEmail: "shared@newtonite.dev",
            sla: null,
          },
        ],
      });

      const result = await service.getIncidentBlastRadius(incidentId, { tx: mockTx });

      // Edges: 2 direct links from root + 1 shared assignee edge between alpha and beta
      expect(result.edges).toHaveLength(3);
      const sharedEdges = result.edges.filter((e) => e.relationshipType === "SHARED_ASSIGNEE");
      expect(sharedEdges).toHaveLength(1);
      expect(sharedEdges[0].source).toBe(item1Id);
      expect(sharedEdges[0].target).toBe(item2Id);
      expect(sharedEdges[0].isDirect).toBe(false);
      expect(sharedEdges[0].label).toBe("Shared Assignee");
    });
  });
});
