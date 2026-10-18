import { Response, NextFunction } from "express";
import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, idempotencyRecords } from "../db";
import { AuthenticatedRequest } from "./auth";
import { BadRequestError, ConflictError } from "../shared/errors";

/**
 * Deterministically stringifies an object by sorting its keys recursively.
 * Ensures consistent hashing regardless of key order in request payloads.
 */
export function canonicalizePayload(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizePayload).join(",")}]`;
  }
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalizePayload(obj[key])}`
  );
  return `{${pairs.join(",")}}`;
}

/**
 * Computes a deterministic SHA-256 hash of the HTTP method, request path, and canonical payload.
 */
export function computeRequestHash(method: string, path: string, body: any): string {
  const normalizedPath = path.toLowerCase().replace(/\/+$/, "") || "/";
  const canonicalBody = body ? canonicalizePayload(body) : "";
  const payload = `${method.toUpperCase()}:${normalizedPath}:${canonicalBody}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Middleware that provides robust, transactional idempotency for mutation endpoints.
 *
 * Requirements:
 * - Scoped strictly to the authenticated actor (req.user.id).
 * - Identifies retries using the Idempotency-Key or X-Idempotency-Key header.
 * - Replays stored responses with Idempotent-Replay: true.
 * - Rejects payload mismatches with 422 Unprocessable Entity.
 * - Safely handles concurrent duplicate requests with 409 Conflict.
 * - Cleans up in-flight locks on failed mutations to allow clean retries.
 */
export async function idempotency(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only mutation methods need idempotency protection
  const mutationMethods = ["POST", "PATCH", "PUT", "DELETE"];
  if (!mutationMethods.includes(req.method.toUpperCase())) {
    return next();
  }

  // 1. Extract Idempotency Key header
  const rawKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
  if (!rawKey) {
    // Idempotency key is optional; if absent, proceed normally
    return next();
  }

  const key = (Array.isArray(rawKey) ? rawKey[0] : rawKey).trim();
  if (!key) {
    throw new BadRequestError("Idempotency key cannot be blank");
  }

  if (key.length > 255) {
    throw new BadRequestError("Idempotency key must not exceed 255 characters");
  }

  if (!req.user?.id) {
    // If not authenticated yet, continue to auth middleware
    return next();
  }

  const actorId = req.user.id;
  const requestHash = computeRequestHash(req.method, req.baseUrl + req.path, req.body);

  try {
    // 2. Check for an existing idempotency record
    const [existing] = await db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.actorId, actorId),
          eq(idempotencyRecords.key, key)
        )
      )
      .limit(1);

    if (existing) {
      // If payload hash doesn't match, reject reuse with different payload
      if (existing.requestHash !== requestHash) {
        res.status(422).json({
          error: {
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "Idempotency key has already been used with a different request payload",
          },
        });
        return;
      }

      // If already resolved, replay stored response
      if (existing.responseStatus !== null) {
        res.setHeader("Idempotent-Replay", "true");
        res.setHeader("X-Idempotent-Replay", "true");
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      }

      // If in-flight, return conflict
      throw new ConflictError(
        "A request with this idempotency key is currently being processed. Please retry shortly.",
        { key }
      );
    }

    // 3. Insert in-flight reservation record
    // Default expiration: 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    try {
      await db.insert(idempotencyRecords).values({
        actorId,
        key,
        requestHash,
        responseStatus: null,
        responseBody: null,
        expiresAt,
      });
    } catch (insertErr: any) {
      // Handle race condition: concurrent request inserted the key in the exact same millisecond
      if (insertErr?.code === "23505" || insertErr?.message?.includes("idempotency_records_actor_key_idx")) {
        const [concurrentRecord] = await db
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.actorId, actorId),
              eq(idempotencyRecords.key, key)
            )
          )
          .limit(1);

        if (concurrentRecord) {
          if (concurrentRecord.requestHash !== requestHash) {
            res.status(422).json({
              error: {
                code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                message: "Idempotency key has already been used with a different request payload",
              },
            });
            return;
          }

          if (concurrentRecord.responseStatus !== null) {
            res.setHeader("Idempotent-Replay", "true");
            res.setHeader("X-Idempotent-Replay", "true");
            res.status(concurrentRecord.responseStatus).json(concurrentRecord.responseBody);
            return;
          }
        }

        throw new ConflictError(
          "A request with this idempotency key is currently being processed. Please retry shortly.",
          { key }
        );
      }
      throw insertErr;
    }

    // 4. Intercept response to store result or clean up on failure
    let completed = false;
    const originalJson = res.json.bind(res);

    res.json = function (body: any): Response {
      completed = true;
      const status = res.statusCode;

      if (status >= 200 && status < 400) {
        // Persist successful response asynchronously / synchronously
        db.update(idempotencyRecords)
          .set({
            responseStatus: status,
            responseBody: body,
          })
          .where(
            and(
              eq(idempotencyRecords.actorId, actorId),
              eq(idempotencyRecords.key, key)
            )
          )
          .catch((err) => {
            console.error("Failed to update idempotency record:", err);
          });
      } else {
        // Remove in-flight reservation on business or validation failure to allow safe retry
        db.delete(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.actorId, actorId),
              eq(idempotencyRecords.key, key),
              isNull(idempotencyRecords.responseStatus)
            )
          )
          .catch((err) => {
            console.error("Failed to clean up idempotency record:", err);
          });
      }

      return originalJson(body);
    };

    // Clean up if connection closes prematurely without sending response
    res.on("close", () => {
      if (!completed) {
        db.delete(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.actorId, actorId),
              eq(idempotencyRecords.key, key),
              isNull(idempotencyRecords.responseStatus)
            )
          )
          .catch(() => {});
      }
    });

    next();
  } catch (err) {
    next(err);
  }
}
