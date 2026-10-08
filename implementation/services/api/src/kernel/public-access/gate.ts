import type { NextFunction, Request, Response } from "express";
import { Kind, parse, type OperationDefinitionNode } from "graphql";
import type { Verification } from "./token.js";

type Headers = Record<string, string | string[] | undefined>;

const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};

// The store and rider clients set `x-skip-public-auth: "true"` on the
// metricsGeneral mint so their request interceptor does not attach a public
// token. The gate tolerates that header and, for compatibility, treats the two
// documented opt-in literals as an explicit request to skip public auth. This
// only relaxes the anti-abuse public token: it never grants a user identity.
const SKIP_PUBLIC_AUTH = "x-skip-public-auth";

function skipsPublicAuth(headers: Headers): boolean {
  const value = header(headers, SKIP_PUBLIC_AUTH).toLowerCase();
  return value === "true" || value === "1";
}

// Only metricsGeneral is exempt, and only when it is the sole root operation
// selected by operationName or by GraphQL's single-operation rule.
function isHandshakeOnly(body: {
  query?: unknown;
  operationName?: unknown;
}): boolean | null {
  if (typeof body.query !== "string") return null;

  let document;
  try {
    document = parse(body.query);
  } catch {
    return null;
  }

  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION,
  );
  const selected =
    typeof body.operationName === "string"
      ? operations.find(
          (operation) => operation.name?.value === body.operationName,
        )
      : operations.length === 1
        ? operations[0]
        : undefined;

  if (!selected) return false;
  return (
    (selected.operation === "mutation" || selected.operation === "query") &&
    selected.selectionSet.selections.length > 0 &&
    selected.selectionSet.selections.every(
      (selection) =>
        selection.kind === Kind.FIELD &&
        selection.name.value === "metricsGeneral",
    )
  );
}

export type GateResult = { pass: true } | { pass: false; message: string };

export async function gateDecision(
  body: { query?: unknown; operationName?: unknown },
  headers: Headers,
  verify: (token: string, nonce: string) => Promise<Verification>,
): Promise<GateResult> {
  if (skipsPublicAuth(headers)) return { pass: true };

  const handshake = isHandshakeOnly(body);
  if (handshake === null) return { pass: true };

  const nonce = header(headers, "nonce");
  if (handshake)
    return nonce
      ? { pass: true }
      : { pass: false, message: "Unauthorized: nonce header missing" };

  const bearer = header(headers, "bop-auth");
  const token = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : bearer;
  if (!token) return { pass: false, message: "Unauthorized: token missing" };
  if (!nonce)
    return { pass: false, message: "Unauthorized: nonce header missing" };

  const result = await verify(token, nonce);
  return result.ok ? { pass: true } : { pass: false, message: result.message };
}

export function publicAccessMiddleware(
  enforced: boolean,
  verify: (token: string, nonce: string) => Promise<Verification>,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!enforced) return next();
    if (request.method !== "POST") {
      response.status(405).json({
        errors: [
          {
            message: "GraphQL requests must use POST",
            extensions: { code: "BAD_USER_INPUT" },
          },
        ],
      });
      return;
    }
    if (Array.isArray(request.body)) {
      response.status(400).json({
        errors: [
          {
            message: "Batched requests are not supported",
            extensions: { code: "BAD_USER_INPUT" },
          },
        ],
      });
      return;
    }

    const decision = await gateDecision(
      request.body ?? {},
      request.headers,
      verify,
    );
    if (decision.pass) return next();

    response.status(403).json({
      data: null,
      errors: [
        {
          message: decision.message,
          extensions: { code: "PUBLIC_ACCESS_DENIED" },
        },
      ],
    });
  };
}
