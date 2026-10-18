import { Router, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, teamMemberships } from "../../db";
import { authenticate, AuthenticatedRequest } from "../../middleware/auth";
import {
  getTeamMembership,
  hasMinimumRole,
  TeamMembershipRole,
} from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { ForbiddenError, NotFoundError } from "../../shared/errors";
import {
  jobIdParamSchema,
  listJobsQuerySchema,
  triggerDemoJobSchema,
} from "./queue-simulator.schemas";
import { queueSimulatorService } from "./queue-simulator.service";

export const queueSimulatorRouter = Router();

/**
 * Helper to enforce that the authenticated user possesses at least minRole
 * either within a specific team (if teamId is provided) or across any of their teams.
 */
async function requireQueueOperatorRole(
  req: AuthenticatedRequest,
  minRole: TeamMembershipRole = "LEAD"
): Promise<void> {
  const userId = req.user!.id;
  const teamId = (req.body?.teamId as string) || (req.query?.teamId as string);

  if (teamId) {
    const membership = await getTeamMembership(userId, teamId);
    if (!membership) {
      throw new NotFoundError("Team not found or inaccessible");
    }
    if (!hasMinimumRole(membership.role, minRole)) {
      throw new ForbiddenError(
        `Insufficient permissions: queue operations require at least ${minRole} role, but user has ${membership.role}`
      );
    }
    return;
  }

  // Check all team memberships of user
  const memberships = await db
    .select({ role: teamMemberships.role })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));

  const hasPermittedRole = memberships.some((m) =>
    hasMinimumRole(m.role as TeamMembershipRole, minRole)
  );

  if (!hasPermittedRole) {
    throw new ForbiddenError(
      `Insufficient permissions: queue operations require ${minRole} or ADMIN role`
    );
  }
}

/**
 * GET /api/v1/queue/health
 * Returns queue availability status, latency, and BullMQ + Outbox job counters.
 * Accessible to all authenticated users (read-only).
 */
queueSimulatorRouter.get(
  "/health",
  authenticate,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const health = await queueSimulatorService.getQueueHealth();
      res.status(200).json({ data: health });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/queue/jobs/failed
 * Lists currently failed jobs with safe metadata and sanitized error reasons.
 * Accessible to all authenticated users (read-only).
 */
queueSimulatorRouter.get(
  "/jobs/failed",
  authenticate,
  validate({ query: listJobsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query.limit) || 25;
      const jobs = await queueSimulatorService.getFailedJobs(limit);
      res.status(200).json({ data: jobs });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/queue/jobs/completed
 * Lists recently completed jobs for verifying recovery transitions.
 * Accessible to all authenticated users (read-only).
 */
queueSimulatorRouter.get(
  "/jobs/completed",
  authenticate,
  validate({ query: listJobsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query.limit) || 25;
      const jobs = await queueSimulatorService.getCompletedJobs(limit);
      res.status(200).json({ data: jobs });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/queue/simulate-failure
 * Enqueues a controlled, predictable demo failure job.
 * Gated to LEAD and ADMIN.
 */
queueSimulatorRouter.post(
  "/simulate-failure",
  authenticate,
  validate({ body: triggerDemoJobSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await requireQueueOperatorRole(req, "LEAD");
      const job = await queueSimulatorService.simulateFailure(
        req.body,
        req.user!
      );
      res.status(201).json({ data: job });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/queue/jobs/:jobId/retry
 * Replays an eligible failed demo simulation job.
 * Gated to LEAD and ADMIN.
 */
queueSimulatorRouter.post(
  "/jobs/:jobId/retry",
  authenticate,
  validate({ params: jobIdParamSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await requireQueueOperatorRole(req, "LEAD");
      const jobId = req.params.jobId as string;
      const job = await queueSimulatorService.retryJob(jobId, req.user!);
      res.status(200).json({ data: job });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/queue/clean
 * Cleans completed demo jobs from queue.
 * Gated to ADMIN.
 */
queueSimulatorRouter.post(
  "/clean",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await requireQueueOperatorRole(req, "ADMIN");
      const result = await queueSimulatorService.cleanCompletedJobs();
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);
