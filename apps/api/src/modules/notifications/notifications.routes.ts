import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest, validate } from "../../middleware";
import {
  listNotificationsQuerySchema,
  notificationParamsSchema,
} from "./notifications.schemas";
import { notificationsService } from "./notifications.service";

export const notificationsRouter = Router();

/**
 * GET /api/v1/notifications
 * Retrieves a paginated list of notifications for the authenticated caller.
 */
notificationsRouter.get(
  "/",
  authenticate,
  validate({ query: listNotificationsQuerySchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await notificationsService.listNotifications(
        req.user!,
        req.query as any
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/notifications/unread-count
 * Returns total count of unread notifications for the caller.
 */
notificationsRouter.get(
  "/unread-count",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await notificationsService.getUnreadCount(req.user!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/notifications/:id/read
 * Marks a specific notification as read.
 */
notificationsRouter.patch(
  "/:id/read",
  authenticate,
  validate({ params: notificationParamsSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await notificationsService.markAsRead(req.user!, id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/notifications/read-all
 * Marks all unread notifications for the caller as read.
 */
notificationsRouter.post(
  "/read-all",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await notificationsService.markAllAsRead(req.user!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
