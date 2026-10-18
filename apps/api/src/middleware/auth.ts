import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { db, users } from "../db";
import { sql } from "drizzle-orm";
import { UnauthorizedError } from "../shared/errors";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export interface JwtTokenPayload {
  sub: string;
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}

/**
 * Authentication middleware that verifies JWT access token and attaches the authenticated user.
 * Rejects requests with missing, malformed, or expired tokens, and rejects inactive users.
 */
export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Authentication token is missing or malformed");
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError("Authentication token is missing or malformed");
    }

    let payload: JwtTokenPayload;
    try {
      payload = jwt.verify(token, config.JWT_SECRET) as JwtTokenPayload;
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        throw new UnauthorizedError("Authentication token has expired");
      }
      throw new UnauthorizedError("Invalid authentication token");
    }

    if (!payload.sub) {
      throw new UnauthorizedError("Invalid token subject");
    }

    // Retrieve active user from database
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(sql`${users.id} = ${payload.sub}`)
      .limit(1);

    if (!user) {
      throw new UnauthorizedError("User account no longer exists");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("User account is inactive");
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
