import { Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db, teamMemberships, TeamMembership } from "../db";
import { ForbiddenError, NotFoundError, BadRequestError } from "../shared/errors";
import { AuthenticatedRequest } from "./auth";

export type TeamMembershipRole = "VIEWER" | "MEMBER" | "LEAD" | "ADMIN";

export const ROLE_HIERARCHY: Record<TeamMembershipRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  LEAD: 2,
  ADMIN: 3,
};

export interface AuthorizedRequest extends AuthenticatedRequest {
  teamMembership?: {
    teamId: string;
    role: TeamMembershipRole;
  };
}

/**
 * Checks whether userRole has at least the privilege of minRole.
 */
export function hasMinimumRole(
  userRole: TeamMembershipRole,
  minRole: TeamMembershipRole
): boolean {
  return (ROLE_HIERARCHY[userRole] ?? -1) >= (ROLE_HIERARCHY[minRole] ?? 99);
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves team membership for a user in a team.
 */
export async function getTeamMembership(
  userId: string,
  teamId: string
): Promise<{ teamId: string; role: TeamMembershipRole } | null> {
  if (!teamId || typeof teamId !== "string" || !UUID_REGEX.test(teamId)) {
    return null;
  }

  const [membership] = await db
    .select({
      teamId: teamMemberships.teamId,
      role: teamMemberships.role,
    })
    .from(teamMemberships)
    .where(
      sql`${teamMemberships.userId} = ${userId} AND ${teamMemberships.teamId} = ${teamId}`
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  return {
    teamId: membership.teamId,
    role: membership.role as TeamMembershipRole,
  };
}

/**
 * Middleware factory that enforces the authenticated user is a member of the specified team
 * with at least the required role.
 *
 * If membership is absent, returns 404 to avoid leaking the existence of external teams (IDOR mitigation).
 * If membership exists but role is insufficient (e.g. VIEWER attempting mutation), returns 403 Forbidden.
 */
export function requireTeamRole(
  extractTeamId: (req: AuthorizedRequest) => string | undefined,
  minRole: TeamMembershipRole = "VIEWER"
) {
  return async (
    req: AuthorizedRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new ForbiddenError("Authentication required before authorization");
      }

      const teamId = extractTeamId(req);
      if (!teamId) {
        throw new BadRequestError("Team ID is required for authorization");
      }

      const membership = await getTeamMembership(req.user.id, teamId);
      if (!membership) {
        // Return 404 to avoid leaking existence of teams to non-members
        throw new NotFoundError("Team not found or inaccessible");
      }

      if (!hasMinimumRole(membership.role, minRole)) {
        throw new ForbiddenError(
          `Insufficient permissions: action requires ${minRole} role, but user has ${membership.role}`
        );
      }

      req.teamMembership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}
