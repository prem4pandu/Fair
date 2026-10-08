import { GraphQLError } from "graphql";

const defaults = {
  BAD_USER_INPUT: { status: 200, message: "Invalid request" },
  NOT_FOUND: { status: 200, message: "Resource not found" },
  ADDRESS_LIMIT_REACHED: {
    status: 200,
    message: "Saved address limit reached",
  },
  AUTHENTICATION_FAILED: { status: 200, message: "Authentication required" },
  AUTH_DISABLED: {
    status: 200,
    message: "Password authentication is unavailable",
  },
  ACCOUNT_EXISTS: { status: 200, message: "Account already exists" },
  CONFIGURATION_UNAVAILABLE: {
    status: 200,
    message: "Configuration unavailable",
  },
  UNAUTHENTICATED: { status: 401, message: "Unauthenticated" },
  TOKEN_EXPIRED: { status: 401, message: "Access token expired" },
  INVALID_TOKEN: { status: 401, message: "Invalid token" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  PUBLIC_ACCESS_DENIED: {
    status: 403,
    message: "Unauthorized: invalid token",
  },
  RATE_LIMITED: {
    status: 200,
    message: "Too many attempts, try again later",
  },
  CONFLICT: { status: 200, message: "The resource changed, try again" },
  NOT_IMPLEMENTED: {
    status: 200,
    message: "This operation is not available yet",
  },
  SERVICE_UNAVAILABLE: { status: 503, message: "Service unavailable" },
  PROVIDER_UNAVAILABLE: {
    status: 200,
    message: "This service is not available",
  },
  INTERNAL_SERVER_ERROR: { status: 500, message: "GraphQL request failed" },
  // Produced before a resolver runs. Preserve GraphQL's actionable message.
  GRAPHQL_VALIDATION_FAILED: { status: 400, message: "Invalid request" },
  GRAPHQL_PARSE_FAILED: { status: 400, message: "Invalid request" },
} as const;

export type ErrorCode = keyof typeof defaults;

// The Enatega customer app treats these message fragments as authentication
// failures and replays the request. Business errors must never contain them.
export const FORBIDDEN_WORDS = [
  "unauthorized",
  "unauthenticated",
  "jwt expired",
  "invalid token",
  "forbidden",
] as const;

const authCodes = new Set<ErrorCode>([
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "INVALID_TOKEN",
  "FORBIDDEN",
  "PUBLIC_ACCESS_DENIED",
]);

export function appError(code: ErrorCode, message?: string): GraphQLError {
  const text = message ?? defaults[code].message;
  if (
    !authCodes.has(code) &&
    FORBIDDEN_WORDS.some((word) => text.toLowerCase().includes(word))
  ) {
    throw new Error(`Error message uses a reserved word: ${text}`);
  }
  return new GraphQLError(text, { extensions: { code } });
}

export function statusFor(code: string): number {
  return Object.hasOwn(defaults, code)
    ? defaults[code as ErrorCode].status
    : defaults.INTERNAL_SERVER_ERROR.status;
}

const passThroughMessage = new Set<ErrorCode>([
  "GRAPHQL_VALIDATION_FAILED",
  "GRAPHQL_PARSE_FAILED",
]);

export function formatError(formatted: {
  message: string;
  extensions?: Record<string, unknown>;
}): { message: string; extensions: { code: ErrorCode } } {
  const code = String(formatted.extensions?.code ?? "INTERNAL_SERVER_ERROR");
  if (!Object.hasOwn(defaults, code)) {
    return {
      message: defaults.INTERNAL_SERVER_ERROR.message,
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    };
  }

  const knownCode = code as ErrorCode;
  return {
    message:
      knownCode === "INTERNAL_SERVER_ERROR"
        ? defaults.INTERNAL_SERVER_ERROR.message
        : passThroughMessage.has(knownCode) || formatted.message
          ? formatted.message
          : defaults[knownCode].message,
    extensions: { code: knownCode },
  };
}
