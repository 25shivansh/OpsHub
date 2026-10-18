import { Request, Response, NextFunction } from "express";
import { ZodTypeAny, ZodError } from "zod";
import { BadRequestError } from "../shared/errors";

export interface RequestValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates request body, query parameters, and URL path parameters using Zod schemas.
 * Returns consistent 400 Bad Request error with field-level details upon validation failure.
 */
export function validate(schemas: RequestValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as any;
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as any;
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        }));
        next(new BadRequestError("Invalid request data", issues));
      } else {
        next(err);
      }
    }
  };
}
