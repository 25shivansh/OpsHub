import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../../middleware/auth";
import { requireTeamRole } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { slaService } from "./sla.service";
import {
  teamIdParamSchema,
  policyIdParamSchema,
  createSlaPolicySchema,
  updateSlaPolicySchema,
  toggleSlaPolicyActiveSchema,
} from "./sla.schemas";

export const slaPolicyRouter = Router();

/**
 * GET /api/v1/teams/:teamId/sla/policies
 * Lists all SLA policies for the specified team.
 * Accessible to all team members (VIEWER, MEMBER, LEAD, ADMIN).
 */
slaPolicyRouter.get(
  "/:teamId/sla/policies",
  authenticate,
  validate({ params: teamIdParamSchema }),
  requireTeamRole((req) => req.params.teamId as string, "VIEWER"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId as string;
      const policies = await slaService.listPolicies(teamId);
      res.status(200).json({ data: policies });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/teams/:teamId/sla/metrics
 * Returns real-time team-scoped SLA metrics and compliance summaries.
 * Accessible to all team members (VIEWER, MEMBER, LEAD, ADMIN).
 */
slaPolicyRouter.get(
  "/:teamId/sla/metrics",
  authenticate,
  validate({ params: teamIdParamSchema }),
  requireTeamRole((req) => req.params.teamId as string, "VIEWER"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId as string;
      const metrics = await slaService.getTeamMetrics(teamId);
      res.status(200).json({ data: metrics });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/teams/:teamId/sla/policies
 * Creates a new SLA policy for the specified team.
 * Requires LEAD or ADMIN role.
 */
slaPolicyRouter.post(
  "/:teamId/sla/policies",
  authenticate,
  validate({ params: teamIdParamSchema, body: createSlaPolicySchema }),
  requireTeamRole((req) => req.params.teamId as string, "LEAD"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId as string;
      const policy = await slaService.createPolicy(teamId, req.body);
      res.status(201).json({ data: policy });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/teams/:teamId/sla/policies/:policyId
 * Updates mutable fields of an SLA policy.
 * Requires LEAD or ADMIN role.
 */
slaPolicyRouter.patch(
  "/:teamId/sla/policies/:policyId",
  authenticate,
  validate({ params: policyIdParamSchema, body: updateSlaPolicySchema }),
  requireTeamRole((req) => req.params.teamId as string, "LEAD"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId as string;
      const policyId = req.params.policyId as string;
      const updatedPolicy = await slaService.updatePolicy(
        teamId,
        policyId,
        req.body
      );
      res.status(200).json({ data: updatedPolicy });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/teams/:teamId/sla/policies/:policyId/active
 * Activates or deactivates an SLA policy.
 * Requires LEAD or ADMIN role.
 */
slaPolicyRouter.patch(
  "/:teamId/sla/policies/:policyId/active",
  authenticate,
  validate({ params: policyIdParamSchema, body: toggleSlaPolicyActiveSchema }),
  requireTeamRole((req) => req.params.teamId as string, "LEAD"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId as string;
      const policyId = req.params.policyId as string;
      const updatedPolicy = await slaService.togglePolicyActive(
        teamId,
        policyId,
        req.body.isActive
      );
      res.status(200).json({ data: updatedPolicy });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/teams/:teamId/sla/policies/:policyId
 * Deletes an unreferenced SLA policy.
 * Requires ADMIN role.
 */
slaPolicyRouter.delete(
  "/:teamId/sla/policies/:policyId",
  authenticate,
  requireTeamRole((req) => req.params.teamId as string, "ADMIN"),
  validate({ params: policyIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params.teamId as string;
      const policyId = req.params.policyId as string;
      const result = await slaService.deletePolicy(teamId, policyId);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);
