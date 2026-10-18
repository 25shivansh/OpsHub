import { Response } from "express";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(statusCode: number, code: string, message: string, details?: any) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: any) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Insufficient permissions") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Version conflict: resource was updated concurrently", details?: any) {
    super(409, "CONFLICT", message, details);
  }
}

export function sendError(res: Response, error: AppError | Error): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  // Handle body-parser JSON syntax errors as 400 Bad Request
  if (error instanceof SyntaxError && "status" in error && (error as any).status === 400) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Malformed JSON payload in request body",
      },
    });
    return;
  }

  // Generic internal server error (never leak raw SQL, stack traces, or secrets)
  console.error("Unhandled server error:", error.message);
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An internal server error occurred",
    },
  });
}
