import { NextRequest, NextResponse } from "next/server";
import {
  identityUserSchema,
  identityOperations,
  sessionPayloadSchema,
  accessTokenSchema,
  refreshTokenSchema,
  registrationSchema,
  passwordLoginSchema,
  type IdentityUser,
  type LoginApplication,
} from "@fairbite/identity-contracts";
import { APPLICATION } from "./application";
export class BoundaryError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
const messages: Record<string, string> = {
  WEB_ORIGIN_UNCONFIGURED: "The application origin is not configured.",
  WEB_ORIGIN_INVALID: "The application origin configuration is invalid.",
  BAD_USER_INPUT: "Check the submitted details.",
  AUTHENTICATION_FAILED: "Email, password or session is invalid.",
  INVALID_INPUT: "Check the submitted details.",
  FORBIDDEN: "This application cannot access that account.",
  UNAUTHENTICATED: "Sign in to continue.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  ACCOUNT_EXISTS: "An account already uses this email.",
  RATE_LIMITED: "Too many attempts. Please try again later.",
  AUTH_DISABLED: "Password authentication is unavailable.",
  SESSION_REVOKED: "Your session is no longer valid.",
  SESSION_EXPIRED: "Your session has expired.",
  SERVICE_UNAVAILABLE: "The identity service is unavailable.",
  CSRF_REJECTED: "This request could not be verified.",
  UNCONFIGURED: "The identity service is not configured.",
  INVALID_CONFIGURATION: "The identity service configuration is invalid.",
};
export function webOrigin(raw = process.env.FAIRBITE_WEB_ORIGIN): URL {
  if (!raw) throw new BoundaryError("WEB_ORIGIN_UNCONFIGURED", 503);
  try {
    const origin = new URL(raw);
    if (
      origin.origin !== raw ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      (origin.protocol !== "https:" &&
        !(
          process.env.NODE_ENV !== "production" &&
          origin.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
        ))
    )
      throw Error();
    return origin;
  } catch {
    throw new BoundaryError("WEB_ORIGIN_INVALID", 503);
  }
}
export function sameOrigin(request: Request) {
  const trusted = webOrigin();
  if (
    request.headers.get("host") !== trusted.host ||
    request.headers.get("origin") !== trusted.origin
  )
    throw new BoundaryError("CSRF_REJECTED", 403);
}
export function endpoint(raw = process.env.FAIRBITE_API_URL): URL {
  if (!raw) throw new BoundaryError("UNCONFIGURED", 503);
  try {
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/graphql" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw Error();
    return url;
  } catch {
    throw new BoundaryError("INVALID_CONFIGURATION", 503);
  }
}
export async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
): Promise<unknown> {
  if (!body) throw new BoundaryError("INVALID_INPUT", 400);
  const reader = body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 8000);
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      count += item.value.byteLength;
      if (count > 16384) {
        void reader.cancel().catch(() => {});
        throw new BoundaryError("INVALID_INPUT", 400);
      }
      chunks.push(item.value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (timedOut) throw new BoundaryError("INVALID_INPUT", 400);
  const bytes = new Uint8Array(count);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BoundaryError("INVALID_INPUT", 400);
  }
}
export async function input(
  request: Request,
  allowed: string[],
  required: string[],
) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new BoundaryError("INVALID_INPUT", 400);
  const value = await boundedJson(request.body);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BoundaryError("INVALID_INPUT", 400);
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !allowed.includes(key)) ||
    required.some((key) => typeof record[key] !== "string") ||
    Object.values(record).some(
      (value) => typeof value !== "string" || value.length > 254,
    )
  )
    throw new BoundaryError("INVALID_INPUT", 400);
  return record;
}
export async function graphql(
  operation: string,
  variables: Record<string, unknown>,
  access?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(access ? { authorization: `Bearer ${access}` } : {}),
      },
      body: JSON.stringify({ query: operation, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new BoundaryError("SERVICE_UNAVAILABLE", 503);
    const parsed = await boundedJson(response.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw Error();
    const result = parsed as { errors?: unknown; data?: unknown };
    if (result.errors) {
      let code = "SERVICE_UNAVAILABLE";
      if (Array.isArray(result.errors)) {
        const candidate = result.errors[0]?.extensions?.code;
        if (
          typeof candidate === "string" &&
          [
            "BAD_USER_INPUT",
            "AUTHENTICATION_FAILED",
            "FORBIDDEN",
            "RATE_LIMITED",
            "SERVICE_UNAVAILABLE",
            "AUTH_DISABLED",
            "ACCOUNT_EXISTS",
          ].includes(candidate) &&
          Object.hasOwn(messages, candidate)
        )
          code = candidate;
      }
      throw new BoundaryError(
        code,
        ["FORBIDDEN"].includes(code)
          ? 403
          : ["INVALID_INPUT", "BAD_USER_INPUT", "ACCOUNT_EXISTS"].includes(code)
            ? 400
            : code === "RATE_LIMITED"
              ? 429
              : code === "SERVICE_UNAVAILABLE" || code === "AUTH_DISABLED"
                ? 503
                : 401,
      );
    }
    if (
      !result.data ||
      typeof result.data !== "object" ||
      Array.isArray(result.data)
    )
      throw Error();
    return result.data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BoundaryError && error.code !== "INVALID_INPUT")
      throw error;
    throw new BoundaryError("SERVICE_UNAVAILABLE", 503);
  }
}
export function assertRole(
  user: IdentityUser,
  application: LoginApplication = APPLICATION,
) {
  const role = {
    CUSTOMER: "CUSTOMER",
    MERCHANT: "MERCHANT_STAFF",
    ADMIN: "ADMIN",
    RIDER: "RIDER",
  }[application];
  if (!user.roles.includes(role as IdentityUser["roles"][number]))
    throw new BoundaryError("FORBIDDEN", 403);
}
export function names() {
  const prefix = process.env.NODE_ENV === "production" ? "__Host-" : "dev-";
  return {
    access: `${prefix}fairbite-${APPLICATION.toLowerCase()}-access`,
    refresh: `${prefix}fairbite-${APPLICATION.toLowerCase()}-refresh`,
  };
}
function response(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
function setCookies(
  reply: NextResponse,
  payload: ReturnType<typeof sessionPayloadSchema.parse>,
) {
  const keys = names();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  reply.cookies.set(keys.access, payload.accessToken, {
    ...options,
    maxAge: payload.accessTokenExpiresInSeconds,
  });
  reply.cookies.set(keys.refresh, payload.refreshToken, {
    ...options,
    maxAge: payload.refreshTokenExpiresInSeconds,
  });
}
function clearCookies(reply: NextResponse) {
  for (const key of Object.values(names()))
    reply.cookies.set(key, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
}
export async function authPost(
  request: NextRequest,
  action: "login" | "register" | "refresh" | "logout",
) {
  try {
    sameOrigin(request);
    const data = await input(
      request,
      action === "login"
        ? ["email", "password"]
        : action === "register"
          ? ["email", "password", "displayName"]
          : [],
      action === "login"
        ? ["email", "password"]
        : action === "register"
          ? ["email", "password", "displayName"]
          : [],
    );
    if (action === "register" && APPLICATION !== "CUSTOMER")
      throw new BoundaryError("FORBIDDEN", 403);
    const keys = names();
    const refresh = request.cookies.get(keys.refresh)?.value;
    if (action === "logout") {
      let revoked = false;
      if (refresh) {
        try {
          const result = await graphql(identityOperations.logoutSession, {
            input: { refreshToken: refresh },
          });
          revoked =
            (result.logoutSession as { accepted?: unknown })?.accepted === true;
        } catch {
          /* Browser session must still clear during outage. */
        }
      }
      const reply = response({
        accepted: true,
        serverRevoked: revoked,
        message: revoked
          ? "Signed out."
          : refresh
            ? "Signed out on this browser. Server session revocation could not be confirmed."
            : "Signed out on this browser.",
      });
      clearCookies(reply);
      return reply;
    }
    if (action === "refresh" && !refresh)
      throw new BoundaryError("UNAUTHENTICATED", 401);
    const key =
      action === "login"
        ? "loginPassword"
        : action === "register"
          ? "registerCustomer"
          : "refreshSession";
    const authInput =
      action === "login"
        ? passwordLoginSchema.parse({ ...data, application: APPLICATION })
        : action === "register"
          ? registrationSchema.parse(data)
          : {
              refreshToken: refreshTokenSchema.parse(refresh),
              application: APPLICATION,
            };
    const result = await graphql(identityOperations[key], { input: authInput });
    const parsedPayload = sessionPayloadSchema.safeParse(result[key]);
    if (!parsedPayload.success)
      throw new BoundaryError("SERVICE_UNAVAILABLE", 503);
    const payload = parsedPayload.data;
    if (payload.application !== APPLICATION)
      throw new BoundaryError("FORBIDDEN", 403);
    assertRole(payload.user);
    if (
      payload.accessTokenExpiresInSeconds > 300 ||
      payload.refreshTokenExpiresInSeconds > 2592000
    )
      throw new BoundaryError("SERVICE_UNAVAILABLE", 503);
    const reply = response({ user: payload.user });
    setCookies(reply, payload);
    return reply;
  } catch (error) {
    const failure =
      error instanceof BoundaryError
        ? error
        : error instanceof Error && error.name === "ZodError"
          ? new BoundaryError("INVALID_INPUT", 400)
          : new BoundaryError("SERVICE_UNAVAILABLE", 503);
    const reply = response(
      {
        code: failure.code,
        message: messages[failure.code] ?? messages.SERVICE_UNAVAILABLE,
      },
      failure.status,
    );
    if (action === "refresh" && [401, 403].includes(failure.status))
      clearCookies(reply);
    return reply;
  }
}
export async function currentUser(
  access: string | undefined,
): Promise<IdentityUser> {
  if (!access || !accessTokenSchema.safeParse(access).success)
    throw new BoundaryError("UNAUTHENTICATED", 401);
  const result = await graphql(
    identityOperations.me,
    { application: APPLICATION },
    access,
  );
  const user = identityUserSchema.parse(result.me);
  assertRole(user);
  return user;
}
export async function authMe(request: NextRequest) {
  try {
    return response({
      user: await currentUser(request.cookies.get(names().access)?.value),
    });
  } catch (error) {
    const failure =
      error instanceof BoundaryError
        ? error
        : new BoundaryError("SERVICE_UNAVAILABLE", 503);
    return response(
      {
        code: failure.code,
        message: messages[failure.code] ?? messages.SERVICE_UNAVAILABLE,
      },
      failure.status,
    );
  }
}
