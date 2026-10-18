import { z } from "zod";

export const workItemParamsSchema = z.object({
  id: z.string().uuid("Invalid work item ID format"),
});

export const listWorkItemsQuerySchema = z.object({
  teamId: z.string().uuid("Invalid teamId format").optional(),
  status: z
    .enum(["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"])
    .optional(),
  type: z.enum(["TASK", "INCIDENT", "REQUEST"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assigneeId: z.string().uuid("Invalid assigneeId format").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(["createdAt", "updatedAt", "priority", "dueAt", "title", "version"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createWorkItemSchema = z.object({
  teamId: z.string().uuid("Invalid teamId format"),
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title cannot be blank")
    .max(200, "Title must not exceed 200 characters"),
  description: z.string().max(5000, "Description too long").optional().nullable(),
  type: z.enum(["TASK", "INCIDENT", "REQUEST"]).default("TASK"),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  assigneeId: z.string().uuid("Invalid assigneeId format").optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
});

export const updateWorkItemSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be blank")
      .max(200, "Title must not exceed 200 characters")
      .optional(),
    description: z.string().max(5000).optional().nullable(),
    type: z.enum(["TASK", "INCIDENT", "REQUEST"]).optional(),
    status: z
      .enum(["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"])
      .optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    assigneeId: z.string().uuid("Invalid assigneeId format").optional().nullable(),
    dueAt: z.coerce.date().optional().nullable(),
    expectedVersion: z.coerce
      .number()
      .int()
      .min(1, "expectedVersion must be a positive integer")
      .optional(),
  })
  .refine(
    (data) => {
      // Must contain at least one field to update
      const { expectedVersion, ...fields } = data;
      return Object.keys(fields).length > 0;
    },
    { message: "At least one mutable field must be provided for update" }
  );

export const claimWorkItemSchema = z
  .object({
    expectedVersion: z.coerce
      .number()
      .int()
      .min(1, "expectedVersion must be a positive integer")
      .optional(),
  })
  .optional();

export const transitionWorkItemSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"], {
    required_error: "Target status is required",
  }),
  expectedVersion: z.coerce
    .number()
    .int()
    .min(1, "expectedVersion must be a positive integer")
    .optional(),
});

export const assignWorkItemSchema = z.object({
  assigneeId: z.string().uuid("Invalid assigneeId format").nullable(),
  expectedVersion: z.coerce
    .number()
    .int()
    .min(1, "expectedVersion must be a positive integer")
    .optional(),
});

export type WorkItemParams = z.infer<typeof workItemParamsSchema>;
export type ListWorkItemsQuery = z.infer<typeof listWorkItemsQuerySchema>;
export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;
export type ClaimWorkItemInput = z.infer<typeof claimWorkItemSchema>;
export type TransitionWorkItemInput = z.infer<typeof transitionWorkItemSchema>;
export type AssignWorkItemInput = z.infer<typeof assignWorkItemSchema>;
