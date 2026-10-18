import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest, validate } from "../../middleware";
import { dashboardSummaryQuerySchema } from "./dashboard.schemas";
import { dashboardService } from "./dashboard.service";

export const dashboardRouter = Router();

/**
 * GET /api/v1/dashboard/summary
 * Retrieves high-level operational metrics and recent activity for an authorized team.
 */
dashboardRouter.get(
  "/summary",
  authenticate,
  validate({ query: dashboardSummaryQuerySchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const teamId = req.query.teamId as string | undefined;
      const result = await dashboardService.getDashboardSummary(req.user!, teamId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
