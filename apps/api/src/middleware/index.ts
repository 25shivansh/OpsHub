import { Request, Response, NextFunction } from "express";
import { sendError } from "../shared/errors";

export * from "./auth";
export * from "./validate";
export * from "./authorize";
export * from "./idempotency";

/**
 * Global Express error handling middleware.
 * Ensures consistent JSON error responses without exposing stack traces, internal database details, or secrets.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  sendError(res, err);
}
