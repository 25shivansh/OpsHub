import { z } from "zod";

export const demoScenarioEnum = z.enum([
  "TRANSIENT_TIMEOUT",
  "RATE_LIMIT_EXCEEDED",
  "DOWNSTREAM_500",
]);

export type DemoScenario = z.infer<typeof demoScenarioEnum>;

export const triggerDemoJobSchema = z.object({
  scenario: demoScenarioEnum.default("TRANSIENT_TIMEOUT"),
  scenarioName: z
    .string()
    .trim()
    .max(120, "Scenario name must be 120 characters or fewer")
    .optional(),
  errorMessage: z
    .string()
    .trim()
    .max(500, "Error message must be 500 characters or fewer")
    .optional(),
  simulateTransientRecovery: z.boolean().default(true),
  maxAttempts: z
    .number()
    .int("maxAttempts must be an integer")
    .min(1, "maxAttempts must be at least 1")
    .max(5, "maxAttempts must be at most 5")
    .optional(),
  teamId: z.string().uuid("Invalid team ID format").optional(),
});

export type TriggerDemoJobInput = z.infer<typeof triggerDemoJobSchema>;

export const jobIdParamSchema = z.object({
  jobId: z
    .string()
    .trim()
    .min(1, "Job ID is required")
    .max(128, "Job ID is too long"),
});

export const listJobsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .optional(),
  teamId: z.string().uuid("Invalid team ID format").optional(),
});
