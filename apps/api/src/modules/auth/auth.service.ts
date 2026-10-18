import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sql } from "drizzle-orm";
import { config } from "../../config";
import { db, teamMemberships, teams, users } from "../../db";
import { UnauthorizedError } from "../../shared/errors";
import { DemoLoginInput, LoginInput } from "./auth.schemas";

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserTeamSummary {
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: string;
  joinedAt: Date;
}

export class AuthService {
  private createSession(user: SafeUser): { token: string; user: SafeUser } {
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
      },
      config.JWT_SECRET,
      {
        expiresIn: config.JWT_EXPIRES_IN as any,
      }
    );

    return { token, user };
  }

  /**
   * Authenticates user with case-insensitive email and password.
   * Rejects inactive accounts and returns generic error to prevent user enumeration.
   */
  async login(input: LoginInput): Promise<{ token: string; user: SafeUser }> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // Query user by case-insensitive email
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    // Generic failure if user doesn't exist
    if (!user) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Reject inactive users with generic unauthorized message
    if (!user.isActive) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Verify bcrypt password hash
    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    // Return safe user object (omit passwordHash completely)
    const safeUser: SafeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return this.createSession(safeUser);
  }

  /**
   * Issues a short-lived demo session for the four seeded personas in development.
   * This keeps the demo password out of the browser bundle while leaving password
   * authentication unchanged for normal accounts.
   */
  async loginDemo(input: DemoLoginInput): Promise<{ token: string; user: SafeUser }> {
    if (config.NODE_ENV === "production") {
      throw new UnauthorizedError("Demo sign-in is unavailable");
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
      .limit(1);

    if (!user || !user.isActive) {
      throw new UnauthorizedError("Demo account is unavailable");
    }

    return this.createSession(user);
  }

  /**
   * Retrieves user profile and team memberships for the currently authenticated user.
   */
  async getCurrentUser(userId: string): Promise<{ user: SafeUser; teams: UserTeamSummary[] }> {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(sql`${users.id} = ${userId}`)
      .limit(1);

    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    const memberships = await db
      .select({
        teamId: teams.id,
        teamName: teams.name,
        teamSlug: teams.slug,
        role: teamMemberships.role,
        joinedAt: teamMemberships.joinedAt,
      })
      .from(teamMemberships)
      .innerJoin(teams, sql`${teams.id} = ${teamMemberships.teamId}`)
      .where(sql`${teamMemberships.userId} = ${userId}`)
      .orderBy(sql`${teams.name} ASC`);

    return {
      user,
      teams: memberships,
    };
  }
}

export const authService = new AuthService();
