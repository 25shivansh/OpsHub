import { z } from "zod";

export const workItemTypeEnumSchema = z.enum(["TASK", "INCIDENT", "REQUEST"]);
export const workItemPriorityEnumSchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);

export const teamIdParamSchema = z.object({
  teamId: z.string().uuid("Invalid team ID format"),
});

export const policyIdParamSchema = z.object({
  teamId: z.string().uuid("Invalid team ID format"),
  policyId: z.string().uuid("Invalid policy ID format"),
});

export const createSlaPolicySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name cannot be blank")
      .max(120, "Name must be 120 characters or fewer"),
    description: z
      .string()
      .trim()
      .max(1000, "Description must be 1000 characters or fewer")
      .optional()
      .nullable(),
    workItemType: workItemTypeEnumSchema.optional().nullable(),
    priority: workItemPriorityEnumSchema.optional().nullable(),
    responseTargetMinutes: z
      .number({ required_error: "Response target minutes is required" })
      .int("Response target must be an integer")
      .positive("Response target must be greater than 0"),
    resolutionTargetMinutes: z
      .number({ required_error: "Resolution target minutes is required" })
      .int("Resolution target must be an integer")
      .positive("Resolution target must be greater than 0"),
    warningThresholdPercent: z
      .number()
      .int("Warning threshold must be an integer")
      .min(1, "Warning threshold must be at least 1%")
      .max(99, "Warning threshold must be at most 99%")
      .default(75),
    isActive: z.boolean().default(true),
  })
  .refine(
    (data) => data.resolutionTargetMinutes >= data.responseTargetMinutes,
    {
      message:
        "Resolution target minutes must be greater than or equal to response target minutes",
      path: ["resolutionTargetMinutes"],
    }
  );

export const updateSlaPolicySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name cannot be blank")
      .max(120, "Name must be 120 characters or fewer")
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Description must be 1000 characters or fewer")
      .optional()
      .nullable(),
    responseTargetMinutes: z
      .number()
      .int("Response target must be an integer")
      .positive("Response target must be greater than 0")
      .optional(),
    resolutionTargetMinutes: z
      .number()
      .int("Resolution target must be an integer")
      .positive("Resolution target must be greater than 0")
      .optional(),
    warningThresholdPercent: z
      .number()
      .int("Warning threshold must be an integer")
      .min(1, "Warning threshold must be at least 1%")
      .max(99, "Warning threshold must be at most 99%")
      .optional(),
  })
  .refine(
    (data) => {
      if (
        data.responseTargetMinutes !== undefined &&
        data.resolutionTargetMinutes !== undefined
      ) {
        return data.resolutionTargetMinutes >= data.responseTargetMinutes;
      }
      return true;
    },
    {
      message:
        "Resolution target minutes must be greater than or equal to response target minutes",
      path: ["resolutionTargetMinutes"],
    }
  );

export const toggleSlaPolicyActiveSchema = z.object({
  isActive: z.boolean({
    required_error: "isActive boolean is required",
  }),
});

export type CreateSlaPolicyInput = z.infer<typeof createSlaPolicySchema>;
export type UpdateSlaPolicyInput = z.infer<typeof updateSlaPolicySchema>;
export type ToggleSlaPolicyActiveInput = z.infer<
  typeof toggleSlaPolicyActiveSchema
>;
