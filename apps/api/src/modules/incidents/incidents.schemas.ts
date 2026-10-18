import { z } from "zod";

// =============================================================================
// Shared constants
// =============================================================================

export const INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
export const INCIDENT_IMPACTS = [
  "TOTAL_OUTAGE",
  "MAJOR_DEGRADATION",
  "MINOR_DEGRADATION",
  "NO_IMPACT",
] as const;
export const INCIDENT_STATUSES = [
  "DECLARED",
  "INVESTIGATING",
  "IDENTIFIED",
  "MITIGATING",
  "MONITORING",
  "RESOLVED",
  "POSTMORTEM",
  "CLOSED",
] as const;
export const INCIDENT_RESPONDER_ROLES = [
  "COMMANDER",
  "COMMUNICATIONS",
  "OPERATIONS",
  "SUBJECT_MATTER_EXPERT",
  "OBSERVER",
] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentResponderRole = (typeof INCIDENT_RESPONDER_ROLES)[number];

// =============================================================================
// Params
// =============================================================================

export const incidentParamsSchema = z.object({
  id: z.string().uuid("Invalid incident ID format"),
});

export const incidentResponderParamsSchema = z.object({
  id: z.string().uuid("Invalid incident ID format"),
  userId: z.string().uuid("Invalid user ID format"),
});

export const incidentLinkedItemParamsSchema = z.object({
  id: z.string().uuid("Invalid incident ID format"),
  itemId: z.string().uuid("Invalid work item ID format"),
});

// =============================================================================
// List query
// =============================================================================

export const listIncidentsQuerySchema = z.object({
  teamId: z.string().uuid("Invalid teamId format").optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["declaredAt", "severity", "status", "updatedAt", "title"])
    .default("declaredAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// =============================================================================
// Declare (create) incident
// =============================================================================

export const declareIncidentSchema = z.object({
  teamId: z.string().uuid("Invalid teamId format"),
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title cannot be blank")
    .max(300, "Title must not exceed 300 characters"),
  summary: z.string().max(10000, "Summary too long").optional().nullable(),
  severity: z.enum(INCIDENT_SEVERITIES).default("SEV3"),
  impact: z.enum(INCIDENT_IMPACTS).default("NO_IMPACT"),
  commanderId: z
    .string()
    .uuid("Invalid commander ID format")
    .optional()
    .nullable(),
});

// =============================================================================
// Update incident
// =============================================================================

export const updateIncidentSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be blank")
      .max(300, "Title must not exceed 300 characters")
      .optional(),
    summary: z.string().max(10000).optional().nullable(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    impact: z.enum(INCIDENT_IMPACTS).optional(),
    mitigationNotes: z.string().max(10000).optional().nullable(),
    postmortemUrl: z
      .string()
      .url("Invalid URL format")
      .max(2048)
      .optional()
      .nullable(),
    expectedVersion: z.coerce
      .number()
      .int()
      .min(1, "expectedVersion must be a positive integer")
      .optional(),
  })
  .refine(
    (data) => {
      const { expectedVersion, ...fields } = data;
      return Object.keys(fields).length > 0;
    },
    { message: "At least one mutable field must be provided for update" }
  );

// =============================================================================
// Transition incident status
// =============================================================================

export const transitionIncidentSchema = z.object({
  status: z.enum(INCIDENT_STATUSES, {
    required_error: "Target status is required",
  }),
  message: z
    .string()
    .max(2000, "Transition message too long")
    .optional()
    .nullable(),
  expectedVersion: z.coerce
    .number()
    .int()
    .min(1, "expectedVersion must be a positive integer")
    .optional(),
});

// =============================================================================
// Manage responders
// =============================================================================

export const addResponderSchema = z.object({
  userId: z.string().uuid("Invalid user ID format"),
  role: z.enum(INCIDENT_RESPONDER_ROLES).default("OPERATIONS"),
});

export const removeResponderSchema = z.object({
  userId: z.string().uuid("Invalid user ID format"),
});

// =============================================================================
// Timeline note
// =============================================================================

export const addTimelineNoteSchema = z.object({
  message: z
    .string({ required_error: "Message is required" })
    .trim()
    .min(1, "Message cannot be blank")
    .max(5000, "Message must not exceed 5000 characters"),
});

// =============================================================================
// Link / unlink work items
// =============================================================================

export const linkWorkItemSchema = z.object({
  workItemId: z.string().uuid("Invalid work item ID format"),
});

export const unlinkWorkItemSchema = z.object({
  workItemId: z.string().uuid("Invalid work item ID format"),
});

// =============================================================================
// Incident Intelligence
// =============================================================================

export const incidentIntelligenceQuerySchema = z.object({
  teamId: z.string().uuid("Invalid team ID format"),
});

// =============================================================================
// Inferred types
// =============================================================================

export type IncidentParams = z.infer<typeof incidentParamsSchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
export type DeclareIncidentInput = z.infer<typeof declareIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type TransitionIncidentInput = z.infer<typeof transitionIncidentSchema>;
export type AddResponderInput = z.infer<typeof addResponderSchema>;
export type RemoveResponderInput = z.infer<typeof removeResponderSchema>;
export type AddTimelineNoteInput = z.infer<typeof addTimelineNoteSchema>;
export type LinkWorkItemInput = z.infer<typeof linkWorkItemSchema>;
export type UnlinkWorkItemInput = z.infer<typeof unlinkWorkItemSchema>;
export type IncidentIntelligenceQuery = z.infer<typeof incidentIntelligenceQuerySchema>;
