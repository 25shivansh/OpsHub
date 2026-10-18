import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((val) => val === "true"),
});

export const notificationParamsSchema = z.object({
  id: z.string().uuid("Invalid notification ID format"),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type NotificationParams = z.infer<typeof notificationParamsSchema>;
