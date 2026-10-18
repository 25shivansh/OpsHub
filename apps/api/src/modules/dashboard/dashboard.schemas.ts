import { z } from "zod";

export const dashboardSummaryQuerySchema = z.object({
  teamId: z.string().uuid("Invalid teamId format").optional(),
});

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;
