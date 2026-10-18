import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest, validate, idempotency } from "../../middleware";
import {
  assignWorkItemSchema,
  claimWorkItemSchema,
  createWorkItemSchema,
  listWorkItemsQuerySchema,
  transitionWorkItemSchema,
  updateWorkItemSchema,
  workItemParamsSchema,
} from "./work-items.schemas";
import { workItemsService } from "./work-items.service";

export const workItemsRouter = Router();

/**
 * GET /api/v1/items
 * Retrieves a paginated list of work items scoped to a team the user belongs to.
 */
workItemsRouter.get(
  "/",
  authenticate,
  validate({ query: listWorkItemsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await workItemsService.listWorkItems(req.user!, req.query as any);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/items
 * Creates a new work item within an authorized team and emits a CREATED activity event.
 */
workItemsRouter.post(
  "/",
  authenticate,
  validate({ body: createWorkItemSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await workItemsService.createWorkItem(req.user!, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/items/:id
 * Retrieves a single work item if the authenticated user belongs to the item's team.
 */
workItemsRouter.get(
  "/:id",
  authenticate,
  validate({ params: workItemParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await workItemsService.getWorkItemById(req.user!, id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/items/:id
 * Mutates an existing work item with optimistic concurrency control and workflow validation.
 */
workItemsRouter.patch(
  "/:id",
  authenticate,
  validate({ params: workItemParamsSchema, body: updateWorkItemSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await workItemsService.updateWorkItem(
        req.user!,
        id,
        req.body
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/items/:id/claim
 * Atomically claims an unassigned work item in OPEN status.
 */
workItemsRouter.post(
  "/:id/claim",
  authenticate,
  validate({ params: workItemParamsSchema, body: claimWorkItemSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await workItemsService.claimWorkItem(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/items/:id/transition
 * Executes a role-governed workflow transition.
 */
workItemsRouter.post(
  "/:id/transition",
  authenticate,
  validate({ params: workItemParamsSchema, body: transitionWorkItemSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await workItemsService.transitionWorkItem(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/items/:id/assign
 * Dedicated assignment endpoint for assigning an item to an active team member or unassigning it.
 */
workItemsRouter.post(
  "/:id/assign",
  authenticate,
  validate({ params: workItemParamsSchema, body: assignWorkItemSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await workItemsService.assignWorkItem(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
