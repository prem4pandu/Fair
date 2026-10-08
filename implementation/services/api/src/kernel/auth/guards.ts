import { appError } from "../errors.js";
import type { SessionValidator } from "./sessions.js";
import type { UserTokens, UserType } from "./tokens.js";

export type AuthContext = {
  userId: string;
  type: UserType;
  sessionId: string;
  permissions: string[];
  restaurantIds: string[];
  vendorId: string | null;
  riderId: string | null;
};

export async function resolveAuth(
  header: string | undefined,
  tokens: UserTokens,
  sessions: SessionValidator,
): Promise<Pick<AuthContext, "userId" | "type" | "sessionId"> | null> {
  const value = header?.trim() ?? "";
  if (!value) return null;

  const token = value.toLowerCase().startsWith("bearer ")
    ? value.slice(7).trim()
    : value;
  if (!token) return null;

  const claims = await tokens.verify(token);
  if (!(await sessions.isActive(claims.sid))) {
    throw appError("INVALID_TOKEN");
  }
  return {
    userId: claims.sub,
    type: claims.typ,
    sessionId: claims.sid,
  };
}

export function requireAuth(
  auth: AuthContext | null,
  ...types: UserType[]
): AuthContext {
  if (!auth) throw appError("UNAUTHENTICATED");
  if (types.length && !types.includes(auth.type) && auth.type !== "ADMIN") {
    throw appError("FORBIDDEN");
  }
  return auth;
}

export function requirePermission(
  auth: AuthContext | null,
  permission: string,
): AuthContext {
  const caller = requireAuth(auth, "ADMIN", "STAFF");
  if (caller.type === "STAFF" && !caller.permissions.includes(permission)) {
    throw appError("FORBIDDEN");
  }
  return caller;
}

export function requireOwnership(
  auth: AuthContext,
  scope: {
    restaurantId?: string | null;
    vendorId?: string | null;
    riderId?: string | null;
    userId?: string | null;
  },
  staffPermission?: string,
): void {
  if (auth.type === "ADMIN") return;
  if (
    auth.type === "STAFF" &&
    staffPermission !== undefined &&
    auth.permissions.includes(staffPermission)
  ) {
    return;
  }

  const allowed =
    (scope.restaurantId == null ||
      auth.restaurantIds.includes(scope.restaurantId)) &&
    (scope.vendorId == null || auth.vendorId === scope.vendorId) &&
    (scope.riderId == null || auth.riderId === scope.riderId) &&
    (scope.userId == null || auth.userId === scope.userId);
  if (!allowed) throw appError("FORBIDDEN");
}
