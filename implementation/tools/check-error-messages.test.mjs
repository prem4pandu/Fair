import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkErrorMessages } from "./check-error-messages.mjs";

const implementation = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CONTRACT = `import { GraphQLError } from "graphql";

const defaults = {
  BAD_USER_INPUT: { status: 200, message: "Invalid request" },
  UNAUTHENTICATED: { status: 401, message: "Unauthenticated" },
  PUBLIC_ACCESS_DENIED: {
    status: 403,
    message: "Unauthorized: invalid token",
  },
} as const;

export type ErrorCode = keyof typeof defaults;

export const FORBIDDEN_WORDS = [
  "unauthorized",
  "unauthenticated",
  "jwt expired",
  "invalid token",
  "forbidden",
] as const;

const authCodes = new Set<ErrorCode>([
  "UNAUTHENTICATED",
  "PUBLIC_ACCESS_DENIED",
]);
`;

/** Runs the checker over an in-memory repository. */
function check(sources, contract = CONTRACT) {
  const files = Object.keys(sources).map((name) => `/repo/${name}`);
  return checkErrorMessages({
    root: "/repo",
    readFile: (file) =>
      path.basename(file) === "errors.ts"
        ? contract
        : (sources[path.basename(file)] ?? ""),
    listFiles: () =>
      files.filter((file) => path.basename(file) !== "errors.ts"),
  });
}

test("accepts business messages that avoid reserved words", () => {
  const result = check({
    "module.ts": `export const a = () => appError("BAD_USER_INPUT", "Address is required");`,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.checked, 1);
});

test("rejects a reserved word in a non-auth error at its exact location", () => {
  const result = check({
    "module.ts": `const x = 1;\nexport const a = () => appError("BAD_USER_INPUT", "Forbidden action");`,
  });
  assert.equal(result.errors.length, 1);
  assert.match(
    result.errors[0],
    /module\.ts:2: BAD_USER_INPUT message contains reserved word\(s\) forbidden/,
  );
});

test("allows reserved words on authentication codes the clients must recognise", () => {
  const result = check({
    "gate.ts": `export const a = () => appError("PUBLIC_ACCESS_DENIED", "Unauthorized: expired");`,
  });
  assert.deepEqual(result.errors, []);
});

test("rejects unknown error codes", () => {
  const result = check({
    "module.ts": `export const a = () => appError("MADE_UP_CODE", "Nope");`,
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /unknown error code MADE_UP_CODE/);
});

test("rejects a reserved word in a default message for a non-auth code", () => {
  const contract = CONTRACT.replace(
    `BAD_USER_INPUT: { status: 200, message: "Invalid request" }`,
    `BAD_USER_INPUT: { status: 200, message: "Forbidden request" }`,
  );
  const result = check({ "module.ts": `export const a = 1;` }, contract);
  assert.equal(result.errors.length, 1);
  assert.match(
    result.errors[0],
    /default BAD_USER_INPUT message contains forbidden/,
  );
});

test("reports non-literal messages instead of guessing", () => {
  const result = check({
    "module.ts": `export const a = () => appError("BAD_USER_INPUT", reason);`,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.dynamic.length, 1);
  assert.match(result.dynamic[0], /BAD_USER_INPUT message is not a literal/);
});

test("fails closed when the error contract cannot be read", () => {
  const result = checkErrorMessages({
    root: "/repo",
    readFile: () => {
      throw new Error("ENOENT");
    },
    listFiles: () => [],
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /cannot be verified/);
});

test("fails closed when the contract itself is malformed", () => {
  const result = check({ "module.ts": `export const a = 1;` }, "// empty");
  assert.ok(result.errors.length >= 3);
  assert.equal(result.checked, 0);
});

test("the real repository satisfies the error-message contract", () => {
  const result = checkErrorMessages({ root: implementation });
  assert.deepEqual(result.errors, []);
  assert.ok(result.checked > 0);
  assert.ok(result.words.includes("invalid token"));
});
