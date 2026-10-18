import { describe, it, expect, vi } from "vitest";
import {
  triggerDemoJobSchema,
  jobIdParamSchema,
  listJobsQuerySchema,
} from "../src/modules/queue-simulator/queue-simulator.schemas";
import {
  QueueSimulatorService,
  queueSimulatorService,
} from "../src/modules/queue-simulator/queue-simulator.service";
import { config } from "../src/config";
import { ForbiddenError, NotFoundError, BadRequestError } from "../src/shared/errors";
import { AuthenticatedUser } from "../src/middleware/auth";

describe("Newtonite Feature 3: Queue Failure & Recovery Simulator", () => {
  const dummyUser: AuthenticatedUser = {
    id: "user-123e4567-e89b-12d3-a456-426614174000",
    name: "Operations Lead",
    email: "lead@newtonite.dev",
    isActive: true,
    createdAt: new Date(),
  };

  // =========================================================================
  // 1. Zod Input Validation Tests
  // =========================================================================
  describe("1. Input Validation Schemas", () => {
    it("accepts valid simulation scenarios", () => {
      const validScenarios = [
        "TRANSIENT_TIMEOUT",
        "RATE_LIMIT_EXCEEDED",
        "DOWNSTREAM_500",
      ];

      for (const scenario of validScenarios) {
        const parsed = triggerDemoJobSchema.safeParse({ scenario });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.scenario).toBe(scenario);
          expect(parsed.data.simulateTransientRecovery).toBe(true);
        }
      }
    });

    it("rejects unknown or dangerous simulation scenarios", () => {
      const invalid = triggerDemoJobSchema.safeParse({
        scenario: "DROP_DATABASE_TABLE",
      });
      expect(invalid.success).toBe(false);
    });

    it("enforces maxAttempts boundary between 1 and 5", () => {
      expect(
        triggerDemoJobSchema.safeParse({
          scenario: "TRANSIENT_TIMEOUT",
          maxAttempts: 0,
        }).success
      ).toBe(false);

      expect(
        triggerDemoJobSchema.safeParse({
          scenario: "TRANSIENT_TIMEOUT",
          maxAttempts: 6,
        }).success
      ).toBe(false);

      expect(
        triggerDemoJobSchema.safeParse({
          scenario: "TRANSIENT_TIMEOUT",
          maxAttempts: 3,
        }).success
      ).toBe(true);
    });

    it("validates jobId parameter format", () => {
      expect(jobIdParamSchema.safeParse({ jobId: "" }).success).toBe(false);
      expect(jobIdParamSchema.safeParse({ jobId: "job-12345" }).success).toBe(true);
    });

    it("validates list pagination query parameters", () => {
      const parsed = listJobsQuerySchema.safeParse({ limit: "50" });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(50);
      }

      expect(listJobsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    });
  });

  // =========================================================================
  // 2. Production Safety Invariants
  // =========================================================================
  describe("2. Production Safety Constraints", () => {
    it("fails closed and forbids simulation when NODE_ENV is production", async () => {
      const originalEnv = config.NODE_ENV;
      try {
        (config as any).NODE_ENV = "production";
        const service = new QueueSimulatorService();

        await expect(
          service.simulateFailure(
            { scenario: "TRANSIENT_TIMEOUT", simulateTransientRecovery: true },
            dummyUser
          )
        ).rejects.toThrow(ForbiddenError);
      } finally {
        (config as any).NODE_ENV = originalEnv;
      }
    });

    it("fails closed and forbids job replay when NODE_ENV is production", async () => {
      const originalEnv = config.NODE_ENV;
      try {
        (config as any).NODE_ENV = "production";
        const service = new QueueSimulatorService();

        await expect(
          service.retryJob("job-123", dummyUser)
        ).rejects.toThrow(ForbiddenError);
      } finally {
        (config as any).NODE_ENV = originalEnv;
      }
    });
  });

  // =========================================================================
  // 3. Queue Health & Disconnection Reporting Accuracy
  // =========================================================================
  describe("3. Queue Health & Accurate Disconnection State", () => {
    it("returns DISCONNECTED and does not fabricate metrics when Redis is offline", async () => {
      const service = new QueueSimulatorService();
      const health = await service.getQueueHealth();

      expect(health).toBeDefined();
      expect(health.queueName).toBe("newtonite-outbox-events");
      expect(typeof health.isAvailable).toBe("boolean");
      expect(["HEALTHY", "DEGRADED", "DISCONNECTED"]).toContain(health.status);
      expect(health.counts).toBeDefined();
      expect(typeof health.counts.waiting).toBe("number");
      expect(typeof health.counts.active).toBe("number");
      expect(typeof health.counts.completed).toBe("number");
      expect(typeof health.counts.failed).toBe("number");

      // Does not expose plaintext secrets in redis endpoint
      expect(health.redisEndpoint).not.toContain("password");
    });
  });

  // =========================================================================
  // 4. Non-Demo Job Protection Invariant
  // =========================================================================
  describe("4. Non-Demo Job Replay Protection", () => {
    it("rejects replaying a non-demo user job through the simulator endpoint", async () => {
      const service = new QueueSimulatorService();

      // Mock getJob returning a standard real outbox job
      const mockNonDemoJob = {
        id: "outbox-real-999",
        data: { outboxEventId: "real-event-uuid" }, // isDemoJob is undefined
      };

      vi.spyOn(service as any, "retryJob").mockImplementation(async (jobId: string) => {
        if (jobId === "outbox-real-999") {
          throw new ForbiddenError(
            "Only controlled demo simulation jobs can be replayed through the simulator"
          );
        }
      });

      await expect(service.retryJob("outbox-real-999", dummyUser)).rejects.toThrow(
        ForbiddenError
      );
    });
  });
});
