import { Router, Response, NextFunction } from "express";
import {
  authenticate,
  AuthenticatedRequest,
  validate,
  idempotency,
} from "../../middleware";
import {
  addResponderSchema,
  addTimelineNoteSchema,
  declareIncidentSchema,
  incidentLinkedItemParamsSchema,
  incidentParamsSchema,
  incidentResponderParamsSchema,
  linkWorkItemSchema,
  listIncidentsQuerySchema,
  transitionIncidentSchema,
  updateIncidentSchema,
} from "./incidents.schemas";
import { incidentsService } from "./incidents.service";

export const incidentsRouter = Router();

/**
 * GET /api/v1/incidents
 * Retrieves a paginated list of incidents for the user's team.
 */
incidentsRouter.get(
  "/",
  authenticate,
  validate({ query: listIncidentsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await incidentsService.listIncidents(req.user!, req.query as any);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/incidents
 * Declares a new incident, assigns the commander, and logs initial timeline event.
 */
incidentsRouter.post(
  "/",
  authenticate,
  validate({ body: declareIncidentSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await incidentsService.declareIncident(req.user!, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/incidents/:id
 * Retrieves a single incident with responders and linked work item count.
 */
incidentsRouter.get(
  "/:id",
  authenticate,
  validate({ params: incidentParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.getIncidentById(req.user!, id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/incidents/:id
 * Updates mutable fields of an incident with optimistic concurrency control.
 */
incidentsRouter.patch(
  "/:id",
  authenticate,
  validate({ params: incidentParamsSchema, body: updateIncidentSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.updateIncident(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/incidents/:id/transition
 * Executes a role-governed lifecycle status transition with timeline tracking.
 */
incidentsRouter.post(
  "/:id/transition",
  authenticate,
  validate({ params: incidentParamsSchema, body: transitionIncidentSchema }),
  idempotency,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.transitionIncident(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/incidents/:id/timeline
 * Retrieves the full chronological audit timeline of events and notes.
 */
incidentsRouter.get(
  "/:id/timeline",
  authenticate,
  validate({ params: incidentParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.getTimeline(req.user!, id);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/incidents/:id/timeline/notes
 * Adds a new status update or observation note to the incident timeline.
 */
incidentsRouter.post(
  "/:id/timeline/notes",
  authenticate,
  validate({ params: incidentParamsSchema, body: addTimelineNoteSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.addTimelineNote(req.user!, id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/incidents/:id/responders
 * Adds a responder to the incident team.
 */
incidentsRouter.post(
  "/:id/responders",
  authenticate,
  validate({ params: incidentParamsSchema, body: addResponderSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.addResponder(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/incidents/:id/responders/:userId
 * Removes a responder from the incident team.
 */
incidentsRouter.delete(
  "/:id/responders/:userId",
  authenticate,
  validate({ params: incidentResponderParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
      const result = await incidentsService.removeResponder(req.user!, id, { userId });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/incidents/:id/items
 * Retrieves work items linked to this incident.
 */
incidentsRouter.get(
  "/:id/items",
  authenticate,
  validate({ params: incidentParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.getLinkedItems(req.user!, id);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/incidents/:id/items
 * Links an existing work item to the incident for tracking mitigation work.
 */
incidentsRouter.post(
  "/:id/items",
  authenticate,
  validate({ params: incidentParamsSchema, body: linkWorkItemSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await incidentsService.linkWorkItem(req.user!, id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/incidents/:id/items/:itemId
 * Unlinks a work item from the incident.
 */
incidentsRouter.delete(
  "/:id/items/:itemId",
  authenticate,
  validate({ params: incidentLinkedItemParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      const result = await incidentsService.unlinkWorkItem(req.user!, id, itemId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
