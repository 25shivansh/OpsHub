import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest, validate } from "../../middleware";
import { demoLoginSchema, loginSchema } from "./auth.schemas";
import { authService } from "./auth.service";

export const authRouter = Router();

/**
 * POST /api/v1/auth/login
 * Validates credentials and returns JWT access token and sanitized user profile.
 */
authRouter.post(
  "/login",
  validate({ body: loginSchema }),
  async (req, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.login(req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/auth/demo-login
 * Issues a session for a seeded demo persona in non-production environments.
 */
authRouter.post(
  "/demo-login",
  validate({ body: demoLoginSchema }),
  async (req, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.loginDemo(req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/auth/me
 * Retrieves the currently authenticated user's profile and their team memberships.
 */
authRouter.get(
  "/me",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.getCurrentUser(req.user!.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);
