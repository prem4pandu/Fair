# Wave 0 — Foundation (kernel, transport, tooling, test and E2E harness)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4 and §6 first.

**Goal:** Give every later lane a working transport (HTTP + both WebSocket protocols), the public-access handshake, user-token verification, the error contract, codecs, the `NOT_IMPLEMENTED` fallback, contract/coverage gates, the database test harness and a Playwright harness that runs the real Enatega admin and customer web apps against our API.

**Architecture:** New code lives in `services/api/src/kernel/`, `services/api/test/support/`, `tools/` and `e2e/`. `app.ts` is reduced to wiring. Three agents work in parallel: **W0-A** (kernel and transport), **W0-B** (contract tooling and gates), **W0-C** (test, coverage and E2E harness). They share no files; the lead merges A, then B, then C.

**Tech stack:** as in the master plan. New dependencies: `ws` 8.22.0 (present in the offline store), `@vitest/coverage-v8` 4.1.11 (needs registry access, see master §10).

Paths below are relative to `implementation/` unless they start with `/`.

---

## Agent W0-A — kernel and transport

Owns: `services/api/src/kernel/**`, `services/api/src/app.ts`, `services/api/src/main.ts`, `services/api/src/config.ts`, `services/api/test/unit/kernel/**`, `contracts/enatega/kernel.graphql`, `contracts/enatega/scalars.graphql`.

### Task A1: Configuration for the new transport

**Files:**
- Modify: `services/api/src/config.ts`
- Modify: `services/api/.env.example`
- Test: `services/api/test/unit/kernel/config.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/kernel/config.spec.ts
import { describe, expect, it } from "vitest";
import { readConfig } from "../../../src/config.js";

const base = {
  APP_ENV: "test",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};
const key = (fill: string) => Buffer.alloc(32, fill).toString("base64url");

describe("transport configuration", () => {
  it("defaults to loopback, 1mb bodies and enforced public access", () => {
    const config = readConfig(base);
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.GRAPHQL_BODY_LIMIT).toBe("1mb");
    expect(config.PUBLIC_ACCESS_ENFORCED).toBe(true);
    expect(config.PUBLIC_ACCESS_TTL_SECONDS).toBe(900);
  });
  it("requires a public-access secret when enforcement is on outside test", () => {
    expect(() => readConfig({ ...base, APP_ENV: "development" })).toThrow(
      /PUBLIC_ACCESS_SECRET/,
    );
    expect(
      readConfig({
        ...base,
        APP_ENV: "development",
        PUBLIC_ACCESS_SECRET: key("a"),
      }).PUBLIC_ACCESS_SECRET,
    ).toBe(key("a"));
  });
  it("rejects a public-access TTL at or below the 30 second client refresh buffer", () => {
    expect(() =>
      readConfig({ ...base, PUBLIC_ACCESS_TTL_SECONDS: "30" }),
    ).toThrow(/PUBLIC_ACCESS_TTL_SECONDS/);
  });
  it("accepts 0.0.0.0 so devices on the LAN can connect", () => {
    expect(readConfig({ ...base, HOST: "0.0.0.0" }).HOST).toBe("0.0.0.0");
  });
  it("requires an https public base URL in production", () => {
    expect(() =>
      readConfig({
        ...base,
        APP_ENV: "production",
        PUBLIC_BASE_URL: "http://api.example.com",
      }),
    ).toThrow(/PUBLIC_BASE_URL/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/config.spec.ts`
Expected: FAIL — `config.HOST` is `undefined`.

- [ ] **Step 3: Implement**

In `services/api/src/config.ts`, extend the zod object (keep every existing key and refinement) with:

```ts
    HOST: z.enum(["127.0.0.1", "0.0.0.0", "::", "::1"]).default("127.0.0.1"),
    PUBLIC_BASE_URL: z.url().default("http://localhost:4100"),
    GRAPHQL_BODY_LIMIT: z
      .string()
      .regex(/^\d+(kb|mb)$/)
      .default("1mb"),
    PUBLIC_ACCESS_ENFORCED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    PUBLIC_ACCESS_SECRET: z.string().optional(),
    PUBLIC_ACCESS_TTL_SECONDS: z.coerce.number().int().min(31).max(86400).default(900),
    USER_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
```

Add to the `superRefine` body:

```ts
    const canonicalKey = (secret: string | undefined) =>
      !!secret &&
      /^[A-Za-z0-9_-]{43}$/.test(secret) &&
      Buffer.from(secret, "base64url").length === 32 &&
      Buffer.from(secret, "base64url").toString("base64url") === secret;
    if (
      value.PUBLIC_ACCESS_ENFORCED &&
      value.APP_ENV !== "test" &&
      !canonicalKey(value.PUBLIC_ACCESS_SECRET)
    )
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_ACCESS_SECRET"],
        message: "Canonical 32-byte key required",
      });
    if (
      value.APP_ENV === "production" &&
      new URL(value.PUBLIC_BASE_URL).protocol !== "https:"
    )
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_BASE_URL"],
        message: "https required",
      });
```

In `readConfig`, after parsing, set a deterministic test key when none is given so tests never need a secret:

```ts
  const publicAccessSecret =
    parsed.data.PUBLIC_ACCESS_SECRET ??
    (parsed.data.APP_ENV === "test"
      ? Buffer.alloc(32, 7).toString("base64url")
      : undefined);
  return { ...parsed.data, PUBLIC_ACCESS_SECRET: publicAccessSecret, origins };
```

Append to `services/api/.env.example`:

```dotenv
# Bind address. 0.0.0.0 lets emulators and devices on the LAN reach the API.
HOST=127.0.0.1
PUBLIC_BASE_URL=http://localhost:4100
GRAPHQL_BODY_LIMIT=1mb
# Public-access handshake (metricsGeneral). Inject a canonical base64url 32-byte key.
PUBLIC_ACCESS_ENFORCED=true
# PUBLIC_ACCESS_SECRET=
PUBLIC_ACCESS_TTL_SECONDS=900
USER_TOKEN_TTL_SECONDS=900
```

- [ ] **Step 4: Run the test and the existing config test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/config.spec.ts test/config.spec.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/config.ts services/api/.env.example services/api/test/unit/kernel/config.spec.ts
git commit -m "feat(L0): add transport and public-access configuration"
```

### Task A2: Error contract

**Files:**
- Create: `services/api/src/kernel/errors.ts`
- Create: `services/api/src/kernel/http-status.plugin.ts`
- Test: `services/api/test/unit/kernel/errors.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/kernel/errors.spec.ts
import { describe, expect, it } from "vitest";
import { GraphQLError } from "graphql";
import {
  appError,
  formatError,
  statusFor,
  FORBIDDEN_WORDS,
} from "../../../src/kernel/errors.js";

describe("error contract", () => {
  it("keeps allow-listed codes and their messages", () => {
    const error = appError("BAD_USER_INPUT", "Minimum order not met");
    expect(formatError({ message: error.message, extensions: error.extensions })).toEqual({
      message: "Minimum order not met",
      extensions: { code: "BAD_USER_INPUT" },
    });
  });
  it("uses the default message when none is given", () => {
    const error = appError("TOKEN_EXPIRED");
    expect(error.message).toBe("Access token expired");
  });
  it("masks unknown codes as INTERNAL_SERVER_ERROR", () => {
    expect(
      formatError({ message: "db exploded", extensions: { code: "WHATEVER" } }),
    ).toEqual({
      message: "GraphQL request failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  });
  it("maps GraphQL validation failures to BAD_USER_INPUT without leaking details", () => {
    expect(
      formatError({
        message: 'Cannot query field "x" on type "Query".',
        extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
      }),
    ).toEqual({
      message: 'Cannot query field "x" on type "Query".',
      extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
    });
  });
  it("maps codes to HTTP statuses", () => {
    expect(statusFor("UNAUTHENTICATED")).toBe(401);
    expect(statusFor("TOKEN_EXPIRED")).toBe(401);
    expect(statusFor("INVALID_TOKEN")).toBe(401);
    expect(statusFor("FORBIDDEN")).toBe(403);
    expect(statusFor("PUBLIC_ACCESS_DENIED")).toBe(403);
    expect(statusFor("SERVICE_UNAVAILABLE")).toBe(503);
    expect(statusFor("BAD_USER_INPUT")).toBe(200);
  });
  it("refuses business messages containing words that trigger client token refresh", () => {
    for (const word of FORBIDDEN_WORDS)
      expect(() => appError("BAD_USER_INPUT", `You are ${word} here`)).toThrow(
        /reserved word/,
      );
  });
  it("produces GraphQLError instances", () => {
    expect(appError("NOT_FOUND")).toBeInstanceOf(GraphQLError);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/errors.spec.ts`
Expected: FAIL — cannot find module `kernel/errors.js`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/errors.ts
import { GraphQLError } from "graphql";

const defaults = {
  BAD_USER_INPUT: { status: 200, message: "Invalid request" },
  NOT_FOUND: { status: 200, message: "Resource not found" },
  UNAUTHENTICATED: { status: 401, message: "Unauthenticated" },
  TOKEN_EXPIRED: { status: 401, message: "Access token expired" },
  INVALID_TOKEN: { status: 401, message: "Invalid token" },
  FORBIDDEN: { status: 403, message: "Forbidden" },
  PUBLIC_ACCESS_DENIED: { status: 403, message: "Unauthorized: invalid token" },
  RATE_LIMITED: { status: 200, message: "Too many attempts, try again later" },
  CONFLICT: { status: 200, message: "The resource changed, try again" },
  NOT_IMPLEMENTED: { status: 200, message: "This operation is not available yet" },
  SERVICE_UNAVAILABLE: { status: 503, message: "Service unavailable" },
  PROVIDER_UNAVAILABLE: { status: 200, message: "This service is not available" },
  INTERNAL_SERVER_ERROR: { status: 500, message: "GraphQL request failed" },
  // Produced by graphql-js / Apollo before resolvers run; passed through unchanged.
  GRAPHQL_VALIDATION_FAILED: { status: 400, message: "Invalid request" },
  GRAPHQL_PARSE_FAILED: { status: 400, message: "Invalid request" },
} as const;
export type ErrorCode = keyof typeof defaults;

// The customer app re-mints its public token and replays the request when an
// error message matches these words (reference/02 §0.3). Only auth codes may use them.
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
  )
    throw new Error(`Error message uses a reserved word: ${text}`);
  return new GraphQLError(text, { extensions: { code } });
}

export function statusFor(code: string): number {
  return Object.hasOwn(defaults, code)
    ? defaults[code as ErrorCode].status
    : 500;
}

const passThroughMessage = new Set<string>([
  "GRAPHQL_VALIDATION_FAILED",
  "GRAPHQL_PARSE_FAILED",
]);
export function formatError(formatted: {
  message: string;
  extensions?: Record<string, unknown>;
}) {
  const code = String(formatted.extensions?.code ?? "INTERNAL_SERVER_ERROR");
  if (!Object.hasOwn(defaults, code))
    return {
      message: defaults.INTERNAL_SERVER_ERROR.message,
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    };
  return {
    message:
      code === "INTERNAL_SERVER_ERROR"
        ? defaults.INTERNAL_SERVER_ERROR.message
        : passThroughMessage.has(code) || formatted.message
          ? formatted.message
          : defaults[code as ErrorCode].message,
    extensions: { code },
  };
}
```

```ts
// services/api/src/kernel/http-status.plugin.ts
import type { ApolloServerPlugin } from "@apollo/server";
import { statusFor } from "./errors.js";

// Sets the HTTP status from the most severe error code so clients that branch on
// status (reference/01 §3.4) see 401/403/503 rather than 200.
export const httpStatusPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async willSendResponse({ response, errors }) {
        if (!errors?.length) return;
        const status = Math.max(
          ...errors.map((error) =>
            statusFor(String(error.extensions?.code ?? "INTERNAL_SERVER_ERROR")),
          ),
        );
        if (status !== 200) response.http.status = status;
      },
    };
  },
};
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/errors.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/kernel/errors.ts services/api/src/kernel/http-status.plugin.ts services/api/test/unit/kernel/errors.spec.ts
git commit -m "feat(L0): add error contract and HTTP status plugin"
```

### Task A3: Codecs — ids, money, time, geo, pagination

**Files:**
- Create: `services/api/src/kernel/ids.ts`, `money.ts`, `time.ts`, `geo.ts`, `pagination.ts`
- Test: `services/api/test/unit/kernel/codecs.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/kernel/codecs.spec.ts
import { describe, expect, it } from "vitest";
import { newId, parseId } from "../../../src/kernel/ids.js";
import { toMinor, toMajor, sumMinor, percentOf } from "../../../src/kernel/money.js";
import { isoString, epochMillisString, parseClientDate } from "../../../src/kernel/time.js";
import {
  point,
  parseCoordinate,
  polygon,
  openingTimes,
  isOpenAt,
  containsPoint,
  haversineKm,
} from "../../../src/kernel/geo.js";
import { paginate, p1, p2, p4, p6 } from "../../../src/kernel/pagination.js";

describe("ids", () => {
  it("creates time-ordered UUIDv7 ids", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
  it("rejects malformed ids with BAD_USER_INPUT", () => {
    expect(() => parseId("abc", "restaurant")).toThrow(/restaurant/);
    expect(parseId(newId().toUpperCase(), "x")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("money", () => {
  it("converts major floats to integer minor units with half-up rounding", () => {
    expect(toMinor(12.345, 2)).toBe(1235);
    expect(toMinor(0.1 + 0.2, 2)).toBe(30);
    expect(toMinor(1000, 0)).toBe(1000);
    expect(toMinor(1.2345, 3)).toBe(1235);
  });
  it("converts back for the wire", () => {
    expect(toMajor(1235, 2)).toBe(12.35);
    expect(toMajor(5, 0)).toBe(5);
  });
  it("rejects non-finite and negative amounts where required", () => {
    expect(() => toMinor(Number.NaN, 2)).toThrow();
    expect(() => toMinor(-1, 2, { allowNegative: false })).toThrow();
  });
  it("sums and takes integer percentages", () => {
    expect(sumMinor([100, 250, 1])).toBe(351);
    expect(percentOf(1000, 7.5)).toBe(75);
    expect(percentOf(999, 10)).toBe(100);
  });
});

describe("time", () => {
  const date = new Date("2026-10-08T12:00:00.000Z");
  it("formats lifecycle timestamps as ISO and review timestamps as epoch ms strings", () => {
    expect(isoString(date)).toBe("2026-10-08T12:00:00.000Z");
    expect(epochMillisString(date)).toBe(String(date.getTime()));
    expect(isoString(null)).toBeNull();
  });
  it("parses YYYY-MM-DD and full ISO client dates", () => {
    expect(parseClientDate("2026-10-08")?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(parseClientDate("2026-10-07T18:30:00.000Z")?.toISOString()).toBe(
      "2026-10-07T18:30:00.000Z",
    );
    expect(parseClientDate("nonsense")).toBeNull();
  });
});

describe("geo", () => {
  it("builds GeoJSON points as [lng, lat]", () => {
    expect(point(101.7, 3.1)).toEqual({ type: "Point", coordinates: [101.7, 3.1] });
  });
  it("parses numeric strings and rejects out-of-range coordinates", () => {
    expect(parseCoordinate("3.14", "latitude")).toBe(3.14);
    expect(() => parseCoordinate("91", "latitude")).toThrow();
    expect(() => parseCoordinate("181", "longitude")).toThrow();
  });
  it("validates closed polygon rings", () => {
    const ring = [[[0, 0], [0, 1], [1, 1], [0, 0]]];
    expect(polygon(ring)).toEqual({ type: "Polygon", coordinates: ring });
    expect(() => polygon([[[0, 0], [0, 1], [1, 1]]])).toThrow(/closed/);
  });
  it("checks point-in-polygon", () => {
    const square = polygon([[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]]);
    expect(containsPoint(square, 1, 1)).toBe(true);
    expect(containsPoint(square, 3, 1)).toBe(false);
  });
  it("computes haversine distance", () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
  });
  it("normalises opening times to [HH, MM] arrays and evaluates them in a timezone", () => {
    const times = openingTimes([
      { day: "THU", times: [{ startTime: ["09", "00"], endTime: ["17", "30"] }] },
    ]);
    expect(times[0].times[0].startTime).toEqual(["09", "00"]);
    // 2026-10-08 is a Thursday; 10:00 in Asia/Kuala_Lumpur is 02:00Z.
    expect(isOpenAt(times, new Date("2026-10-08T02:00:00Z"), "Asia/Kuala_Lumpur")).toBe(true);
    expect(isOpenAt(times, new Date("2026-10-08T10:00:00Z"), "Asia/Kuala_Lumpur")).toBe(false);
  });
  it("accepts HH:MM strings from web forms", () => {
    expect(
      openingTimes([{ day: "MON", times: [{ startTime: "08:15", endTime: "20:00" }] }])[0]
        .times[0],
    ).toEqual({ startTime: ["08", "15"], endTime: ["20", "00"] });
  });
});

describe("pagination", () => {
  it("defaults to page 1, limit 10 and caps at maxLimit", () => {
    expect(paginate({})).toEqual({ page: 1, limit: 10, skip: 0 });
    expect(paginate({ page: 3, limit: 1000, maxLimit: 100 })).toEqual({
      page: 3,
      limit: 100,
      skip: 200,
    });
  });
  it("shapes P1, P2, P4 and P6 responses", () => {
    const window = paginate({ page: 2, limit: 10 });
    expect(p1(["a"], 21, window)).toEqual({
      data: ["a"],
      totalCount: 21,
      currentPage: 2,
      totalPages: 3,
      nextPage: 3,
      prevPage: 1,
    });
    expect(p2(["o"], 21, window).orders).toEqual(["o"]);
    expect(p4(["t"], 21)).toEqual({ success: true, message: null, data: ["t"], pagination: { total: 21 } });
    expect(p6("tickets", ["x"], 21, window)).toEqual({
      tickets: ["x"],
      docsCount: 21,
      totalPages: 3,
      currentPage: 2,
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/codecs.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/ids.ts
import { randomBytes } from "node:crypto";
import { appError } from "./errors.js";

let lastMs = 0;
let sequence = 0;
// RFC 9562 UUIDv7: 48-bit ms timestamp, version 7, 12-bit monotonic counter, variant 10.
export function newId(now = Date.now()): string {
  if (now === lastMs) sequence = (sequence + 1) & 0xfff;
  else {
    lastMs = now;
    sequence = randomBytes(2).readUInt16BE() & 0x7ff;
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function parseId(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuid.test(value.toLowerCase()))
    throw appError("BAD_USER_INPUT", `Invalid ${field} id`);
  return value.toLowerCase();
}
export function parseOptionalId(value: unknown, field: string): string | null {
  return value == null || value === "" ? null : parseId(value, field);
}
```

```ts
// services/api/src/kernel/money.ts
import { appError } from "./errors.js";

// Half-up rounding on the decimal string avoids binary float artefacts (0.1 + 0.2).
export function toMinor(
  major: number,
  exponent: number,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): number {
  if (!Number.isFinite(major)) throw appError("BAD_USER_INPUT", "Invalid amount");
  if (!allowNegative && major < 0) throw appError("BAD_USER_INPUT", "Amount must not be negative");
  const scaled = Number((Math.abs(major) * 10 ** exponent).toPrecision(15));
  const minor = Math.floor(scaled + 0.5) * Math.sign(major || 1);
  if (!Number.isSafeInteger(minor)) throw appError("BAD_USER_INPUT", "Amount too large");
  return minor === 0 ? 0 : minor;
}
export function toMajor(minor: number | bigint, exponent: number): number {
  return Number(minor) / 10 ** exponent;
}
export function sumMinor(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
// Integer percentage of a minor amount, half-up. percent may have decimals (7.5 %).
export function percentOf(minor: number, percent: number): number {
  return Math.floor((minor * Math.round(percent * 100)) / 10000 + 0.5);
}
```

```ts
// services/api/src/kernel/time.ts
export function isoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
export function epochMillisString(value: Date | null | undefined): string | null {
  return value ? String(value.getTime()) : null;
}
export function parseClientDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
```

```ts
// services/api/src/kernel/geo.ts
import { appError } from "./errors.js";

export type Point = { type: "Point"; coordinates: [number, number] };
export type Polygon = { type: "Polygon"; coordinates: [number, number][][] };
export const point = (longitude: number, latitude: number): Point => ({
  type: "Point",
  coordinates: [longitude, latitude],
});
export function parseCoordinate(value: unknown, axis: "latitude" | "longitude"): number {
  const number = typeof value === "string" ? Number(value.trim()) : value;
  const limit = axis === "latitude" ? 90 : 180;
  if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > limit)
    throw appError("BAD_USER_INPUT", `Invalid ${axis}`);
  return number;
}
export function polygon(rings: unknown): Polygon {
  if (!Array.isArray(rings) || rings.length === 0)
    throw appError("BAD_USER_INPUT", "Invalid polygon");
  const parsed = rings.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4)
      throw appError("BAD_USER_INPUT", "Invalid polygon");
    const points = ring.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw appError("BAD_USER_INPUT", "Invalid polygon");
      return [parseCoordinate(pair[0], "longitude"), parseCoordinate(pair[1], "latitude")] as [
        number,
        number,
      ];
    });
    const [first, last] = [points[0], points[points.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1])
      throw appError("BAD_USER_INPUT", "Polygon ring must be closed");
    return points;
  });
  return { type: "Polygon", coordinates: parsed };
}
// Ray casting on the outer ring; holes (rings 1..n) exclude.
export function containsPoint(shape: Polygon, longitude: number, latitude: number): boolean {
  const inRing = (ring: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > latitude !== yj > latitude && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  };
  const [outer, ...holes] = shape.coordinates;
  return inRing(outer) && !holes.some(inRing);
}
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
type Day = (typeof days)[number];
type Slot = { startTime: [string, string]; endTime: [string, string] };
export type OpeningTimes = { day: Day; times: Slot[] }[];
function hhmm(value: unknown): [string, string] {
  const parts = Array.isArray(value) ? value.map(String) : String(value ?? "").split(":");
  if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1]))
    throw appError("BAD_USER_INPUT", "Invalid opening time");
  const [h, m] = parts.map(Number);
  if (h > 23 || m > 59) throw appError("BAD_USER_INPUT", "Invalid opening time");
  return [String(h).padStart(2, "0"), String(m).padStart(2, "0")];
}
export function openingTimes(input: unknown): OpeningTimes {
  if (!Array.isArray(input)) throw appError("BAD_USER_INPUT", "Invalid opening times");
  return input.map((entry) => {
    const day = String(entry?.day ?? "") as Day;
    if (!days.includes(day)) throw appError("BAD_USER_INPUT", "Invalid opening day");
    const times = (Array.isArray(entry.times) ? entry.times : []).map(
      (slot: { startTime: unknown; endTime: unknown }) => {
        const startTime = hhmm(slot.startTime);
        const endTime = hhmm(slot.endTime);
        if (startTime.join("") > endTime.join(""))
          throw appError("BAD_USER_INPUT", "Opening time must end after it starts");
        return { startTime, endTime };
      },
    );
    return { day, times };
  });
}
// Inclusive bounds, no overnight slots — the same semantics the apps display (reference/02 §0.5).
export function isOpenAt(times: OpeningTimes, at: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === "weekday")!.value.toUpperCase().slice(0, 3);
  const clock = `${parts.find((p) => p.type === "hour")!.value}${parts.find((p) => p.type === "minute")!.value}`;
  return times
    .filter((entry) => entry.day === weekday)
    .some((entry) =>
      entry.times.some(
        (slot) => slot.startTime.join("") <= clock && clock <= slot.endTime.join(""),
      ),
    );
}
```

```ts
// services/api/src/kernel/pagination.ts
export type Window = { page: number; limit: number; skip: number };
export function paginate({
  page,
  limit,
  maxLimit = 100,
}: {
  page?: number | null;
  limit?: number | null;
  maxLimit?: number;
}): Window {
  const safePage = Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
  const safeLimit =
    Number.isInteger(limit) && (limit as number) > 0 ? Math.min(limit as number, maxLimit) : 10;
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}
const pages = (total: number, window: Window) => {
  const totalPages = Math.max(1, Math.ceil(total / window.limit));
  return {
    totalPages,
    currentPage: window.page,
    nextPage: window.page < totalPages ? window.page + 1 : null,
    prevPage: window.page > 1 ? window.page - 1 : null,
  };
};
// Shapes from reference/04 §4.
export const p1 = <T>(data: T[], totalCount: number, window: Window) => ({
  data,
  totalCount,
  ...pages(totalCount, window),
});
export const p2 = <T>(orders: T[], totalCount: number, window: Window) => ({
  orders,
  totalCount,
  ...pages(totalCount, window),
});
export const p4 = <T>(data: T, total: number) => ({
  success: true,
  message: null,
  data,
  pagination: { total },
});
export const p5 = <T>(data: T[], total: number, window: Window) => {
  const { totalPages, currentPage } = pages(total, window);
  return {
    data,
    total,
    page: currentPage,
    pageSize: window.limit,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
  };
};
export const p6 = <K extends string, T>(key: K, rows: T[], docsCount: number, window: Window) => {
  const { totalPages, currentPage } = pages(docsCount, window);
  return { [key]: rows, docsCount, totalPages, currentPage } as Record<K, T[]> & {
    docsCount: number;
    totalPages: number;
    currentPage: number;
  };
};
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/codecs.spec.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/kernel/{ids,money,time,geo,pagination}.ts services/api/test/unit/kernel/codecs.spec.ts
git commit -m "feat(L0): add id, money, time, geo and pagination codecs"
```

### Task A4: Public-access handshake (`metricsGeneral` and the gate)

Spec: `reference/01-client-transport-and-launch.md` §2.5 (S1–S10). Read it before starting.

**Files:**
- Create: `contracts/enatega/kernel.graphql`
- Create: `services/api/src/kernel/public-access/token.ts`
- Create: `services/api/src/kernel/public-access/gate.ts`
- Create: `services/api/src/kernel/public-access/resolver.ts`
- Test: `services/api/test/unit/kernel/public-access.spec.ts`

- [ ] **Step 1: Write the SDL**

```graphql
# contracts/enatega/kernel.graphql
# Public-access handshake used by every Enatega app before other operations.
# Only `experience` (token) and `hehe` (ISO-8601 expiry) are read by clients;
# the other fields are selected by every client and must exist (reference/01 §2.2).
type MetricsGeneral {
  excellence: String
  topgun: String
  experience: String!
  skydiver: String
  rider: String
  haha: String
  hehe: String!
  huhu: String
  yoyo: String
  turu: String
}

type Mutation {
  metricsGeneral: MetricsGeneral!
}

type Query {
  _kernel: String
}

type Subscription {
  _kernel: String
}
```

- [ ] **Step 2: Write the failing test**

```ts
// services/api/test/unit/kernel/public-access.spec.ts
import { describe, expect, it } from "vitest";
import { PublicAccessTokens } from "../../../src/kernel/public-access/token.js";
import { gateDecision } from "../../../src/kernel/public-access/gate.js";

const secret = Buffer.alloc(32, 9).toString("base64url");
const at = (iso: string) => ({ now: () => new Date(iso) });

describe("public-access tokens", () => {
  it("mints a token bound to the nonce with an ISO expiry", async () => {
    const tokens = new PublicAccessTokens(secret, 900, at("2026-10-08T00:00:00Z"));
    const minted = await tokens.mint("device-1");
    expect(minted.hehe).toBe("2026-10-08T00:15:00.000Z");
    expect(await tokens.verify(minted.experience, "device-1")).toEqual({ ok: true });
  });
  it("re-minting for the same nonce leaves earlier tokens valid", async () => {
    const tokens = new PublicAccessTokens(secret, 900, at("2026-10-08T00:00:00Z"));
    const first = await tokens.mint("n");
    await tokens.mint("n");
    expect(await tokens.verify(first.experience, "n")).toEqual({ ok: true });
  });
  it("reports each failure with the exact client-recognised reason", async () => {
    const early = new PublicAccessTokens(secret, 900, at("2026-10-08T00:00:00Z"));
    const late = new PublicAccessTokens(secret, 900, at("2026-10-08T01:00:00Z"));
    const minted = await early.mint("n");
    expect(await early.verify(minted.experience, "other")).toEqual({
      ok: false,
      message: "Unauthorized: fingerprint mismatch",
    });
    expect(await late.verify(minted.experience, "n")).toEqual({
      ok: false,
      message: "Unauthorized: jwt expired",
    });
    expect(await early.verify("garbage", "n")).toEqual({
      ok: false,
      message: "Unauthorized: invalid token",
    });
  });
  it("accepts opaque nonces with dots, spaces and a leading dash", async () => {
    const tokens = new PublicAccessTokens(secret, 900, at("2026-10-08T00:00:00Z"));
    const nonce = "-iPhone14,2 17.0-lq3k-0123456789abcdef0123456789abcdef";
    expect(await tokens.verify((await tokens.mint(nonce)).experience, nonce)).toEqual({ ok: true });
  });
});

describe("gate decision", () => {
  const ok = async () => ({ ok: true as const });
  it("lets metricsGeneral through without bop-auth, whatever the operation name", async () => {
    for (const query of [
      "mutation MetricsGeneral { metricsGeneral { experience hehe } }",
      "mutation BackgroundPublicToken { metricsGeneral { experience hehe } }",
      "mutation { metricsGeneral { experience hehe } }",
    ])
      expect(await gateDecision({ query }, { nonce: "n" }, ok)).toEqual({ pass: true });
  });
  it("requires a nonce for metricsGeneral", async () => {
    expect(
      await gateDecision({ query: "mutation { metricsGeneral { experience } }" }, {}, ok),
    ).toEqual({ pass: false, message: "Unauthorized: nonce header missing" });
  });
  it("requires bop-auth and nonce for every other operation", async () => {
    expect(await gateDecision({ query: "{ configuration { _id } }" }, { nonce: "n" }, ok)).toEqual(
      { pass: false, message: "Unauthorized: token missing" },
    );
    expect(
      await gateDecision({ query: "{ configuration { _id } }" }, { "bop-auth": "Bearer t" }, ok),
    ).toEqual({ pass: false, message: "Unauthorized: nonce header missing" });
    expect(
      await gateDecision(
        { query: "{ configuration { _id } }" },
        { "bop-auth": "Bearer t", nonce: "n" },
        ok,
      ),
    ).toEqual({ pass: true });
  });
  it("treats an empty bop-auth as missing", async () => {
    expect(
      await gateDecision({ query: "{ a }" }, { "bop-auth": "", nonce: "n" }, ok),
    ).toEqual({ pass: false, message: "Unauthorized: token missing" });
  });
  it("does not gate mixed documents that include metricsGeneral and another root", async () => {
    expect(
      await gateDecision({ query: "mutation { metricsGeneral { hehe } other }" }, { nonce: "n" }, ok),
    ).toEqual({ pass: false, message: "Unauthorized: token missing" });
  });
  it("leaves unparsable bodies to Apollo (it returns GRAPHQL_PARSE_FAILED)", async () => {
    expect(await gateDecision({ query: "{{{" }, {}, ok)).toEqual({ pass: true });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/public-access.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

```ts
// services/api/src/kernel/public-access/token.ts
import { SignJWT, jwtVerify, errors } from "jose";
import { randomBytes } from "node:crypto";
import type { Clock } from "../time.js";
import { systemClock } from "../time.js";

export type Verification = { ok: true } | { ok: false; message: string };

export class PublicAccessTokens {
  private readonly key: Uint8Array;
  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock = systemClock,
  ) {
    this.key = Buffer.from(secret, "base64url");
  }
  async mint(nonce: string) {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const experience = await new SignJWT({ nonce, typ: "public" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomBytes(12).toString("base64url"))
      .sign(this.key);
    const decoy = () => randomBytes(9).toString("base64url");
    return {
      excellence: decoy(),
      topgun: decoy(),
      experience,
      skydiver: decoy(),
      rider: decoy(),
      haha: decoy(),
      hehe: new Date(expiresAt * 1000).toISOString(),
      huhu: decoy(),
      yoyo: decoy(),
      turu: decoy(),
    };
  }
  async verify(token: string, nonce: string): Promise<Verification> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        currentDate: this.clock.now(),
      });
      if (payload.typ !== "public") return { ok: false, message: "Unauthorized: invalid token" };
      if (payload.nonce !== nonce)
        return { ok: false, message: "Unauthorized: fingerprint mismatch" };
      return { ok: true };
    } catch (error) {
      if (error instanceof errors.JWTExpired)
        return { ok: false, message: "Unauthorized: jwt expired" };
      return { ok: false, message: "Unauthorized: invalid token" };
    }
  }
}
```

```ts
// services/api/src/kernel/public-access/gate.ts
import { parse, Kind, type OperationDefinitionNode } from "graphql";
import type { Request, Response, NextFunction } from "express";
import type { Verification } from "./token.js";

type Headers = Record<string, string | string[] | undefined>;
const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
};
// Only metricsGeneral is exempt, and only when it is the sole root field of the
// operation that will execute (operationName or the single operation).
function isHandshakeOnly(body: { query?: unknown; operationName?: unknown }): boolean | null {
  if (typeof body.query !== "string") return null;
  let document;
  try {
    document = parse(body.query);
  } catch {
    return null;
  }
  const operations = document.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  const selected =
    typeof body.operationName === "string"
      ? operations.find((o) => o.name?.value === body.operationName)
      : operations.length === 1
        ? operations[0]
        : undefined;
  if (!selected) return false;
  return (
    selected.operation === "mutation" &&
    selected.selectionSet.selections.every(
      (s) => s.kind === Kind.FIELD && s.name.value === "metricsGeneral",
    )
  );
}
export type GateResult = { pass: true } | { pass: false; message: string };
export async function gateDecision(
  body: { query?: unknown; operationName?: unknown },
  headers: Headers,
  verify: (token: string, nonce: string) => Promise<Verification>,
): Promise<GateResult> {
  const handshake = isHandshakeOnly(body);
  if (handshake === null) return { pass: true };
  const nonce = header(headers, "nonce");
  if (handshake)
    return nonce ? { pass: true } : { pass: false, message: "Unauthorized: nonce header missing" };
  const bearer = header(headers, "bop-auth");
  const token = bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : bearer;
  if (!token) return { pass: false, message: "Unauthorized: token missing" };
  if (!nonce) return { pass: false, message: "Unauthorized: nonce header missing" };
  const result = await verify(token, nonce);
  return result.ok ? { pass: true } : { pass: false, message: result.message };
}
export function publicAccessMiddleware(
  enforced: boolean,
  verify: (token: string, nonce: string) => Promise<Verification>,
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!enforced || request.method !== "POST") return next();
    if (Array.isArray(request.body)) {
      response.status(400).json({ errors: [{ message: "Batched requests are not supported", extensions: { code: "BAD_USER_INPUT" } }] });
      return;
    }
    const decision = await gateDecision(request.body ?? {}, request.headers, verify);
    if (decision.pass) return next();
    response.status(403).json({
      data: null,
      errors: [{ message: decision.message, extensions: { code: "PUBLIC_ACCESS_DENIED" } }],
    });
  };
}
```

```ts
// services/api/src/kernel/public-access/resolver.ts
import { Context, Mutation, Resolver } from "@nestjs/graphql";
import { Inject } from "@nestjs/common";
import { PublicAccessTokens } from "./token.js";
import type { RequestContext } from "../context.js";

@Resolver()
export class PublicAccessResolver {
  constructor(@Inject(PublicAccessTokens) private readonly tokens: PublicAccessTokens) {}
  // The gate has already required a non-empty nonce for this operation.
  @Mutation("metricsGeneral") metricsGeneral(@Context() context: RequestContext) {
    return this.tokens.mint(context.nonce);
  }
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/public-access.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add contracts/enatega/kernel.graphql services/api/src/kernel/public-access services/api/test/unit/kernel/public-access.spec.ts
git commit -m "feat(L0): add metricsGeneral public-access handshake and gate"
```

### Task A5: Request context, user tokens and auth guards

**Files:**
- Create: `services/api/src/kernel/context.ts`
- Create: `services/api/src/kernel/auth/tokens.ts`
- Create: `services/api/src/kernel/auth/guards.ts`
- Create: `services/api/src/kernel/auth/sessions.ts`
- Test: `services/api/test/unit/kernel/auth.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/kernel/auth.spec.ts
import { describe, expect, it } from "vitest";
import { UserTokens } from "../../../src/kernel/auth/tokens.js";
import { resolveAuth, requireAuth, requirePermission, requireOwnership } from "../../../src/kernel/auth/guards.js";

const secret = Buffer.alloc(32, 3).toString("base64url");
const clock = (iso: string) => ({ now: () => new Date(iso) });
const sessions = { isActive: async (sid: string) => sid !== "revoked" };

describe("user tokens", () => {
  it("issues JWTs with exp whose payload segment is atob-safe", async () => {
    const tokens = new UserTokens(secret, 900, clock("2026-10-08T00:00:00Z"));
    for (let i = 0; i < 50; i++) {
      const { token, expiresAt } = await tokens.issue({ sub: `user-${i}`, typ: "RESTAURANT", sid: `s-${i}` });
      const payload = token.split(".")[1];
      expect(payload).not.toMatch(/[-_]/);
      expect(JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4))).exp).toBe(
        Math.floor(expiresAt.getTime() / 1000),
      );
    }
  });
});

describe("guards", () => {
  const tokens = new UserTokens(secret, 900, clock("2026-10-08T00:00:00Z"));
  const later = new UserTokens(secret, 900, clock("2026-10-08T01:00:00Z"));
  it("returns null for anonymous requests and auth for valid tokens", async () => {
    expect(await resolveAuth(undefined, tokens, sessions)).toBeNull();
    expect(await resolveAuth("", tokens, sessions)).toBeNull();
    const { token } = await tokens.issue({ sub: "u1", typ: "CUSTOMER", sid: "s1" });
    expect(await resolveAuth(`Bearer ${token}`, tokens, sessions)).toMatchObject({
      userId: "u1",
      type: "CUSTOMER",
      sessionId: "s1",
    });
  });
  it("distinguishes expired, invalid and revoked tokens", async () => {
    const { token } = await tokens.issue({ sub: "u1", typ: "CUSTOMER", sid: "s1" });
    await expect(resolveAuth(`Bearer ${token}`, later, sessions)).rejects.toMatchObject({
      extensions: { code: "TOKEN_EXPIRED" },
    });
    await expect(resolveAuth("Bearer nope", tokens, sessions)).rejects.toMatchObject({
      extensions: { code: "INVALID_TOKEN" },
    });
    const revoked = await tokens.issue({ sub: "u1", typ: "CUSTOMER", sid: "revoked" });
    await expect(resolveAuth(`Bearer ${revoked.token}`, tokens, sessions)).rejects.toMatchObject({
      extensions: { code: "INVALID_TOKEN" },
    });
  });
  it("enforces types, permissions and ownership", () => {
    const staff = { userId: "s", type: "STAFF" as const, sessionId: "x", permissions: ["Riders"], restaurantIds: [], vendorId: null, riderId: null };
    expect(() => requireAuth(null)).toThrow(/Unauthenticated/);
    expect(() => requireAuth(staff, "CUSTOMER")).toThrow(/Forbidden/);
    expect(requireAuth(staff, "STAFF", "ADMIN")).toBe(staff);
    expect(() => requirePermission(staff, "Users")).toThrow(/Forbidden/);
    expect(() => requirePermission(staff, "Riders")).not.toThrow();
    const owner = { ...staff, type: "RESTAURANT" as const, restaurantIds: ["r1"] };
    expect(() => requireOwnership(owner, { restaurantId: "r2" })).toThrow(/Forbidden/);
    expect(() => requireOwnership(owner, { restaurantId: "r1" })).not.toThrow();
    const admin = { ...staff, type: "ADMIN" as const, permissions: [] };
    expect(() => requirePermission(admin, "Users")).not.toThrow();
    expect(() => requireOwnership(admin, { restaurantId: "any" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/auth.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/auth/tokens.ts
import { SignJWT, jwtVerify, errors } from "jose";
import { randomBytes } from "node:crypto";
import { appError } from "../errors.js";
import { systemClock, type Clock } from "../time.js";

export const USER_TYPES = ["CUSTOMER", "RIDER", "RESTAURANT", "VENDOR", "ADMIN", "STAFF"] as const;
export type UserType = (typeof USER_TYPES)[number];
export type TokenClaims = { sub: string; typ: UserType; sid: string };

export class UserTokens {
  private readonly key: Uint8Array;
  constructor(secret: string, private readonly ttlSeconds: number, private readonly clock: Clock = systemClock) {
    this.key = Buffer.from(secret, "base64url");
  }
  // The store app decodes the payload with atob(), which rejects base64url '-' and '_'
  // (reference/01 §1.5). Re-sign with a different random `n` until the payload is clean.
  async issue(claims: TokenClaims) {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const exp = issuedAt + this.ttlSeconds;
    for (let attempt = 0; attempt < 256; attempt++) {
      const token = await new SignJWT({ typ: claims.typ, sid: claims.sid, n: randomBytes(3).toString("hex") })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(claims.sub)
        .setIssuedAt(issuedAt)
        .setExpirationTime(exp)
        .sign(this.key);
      if (!/[-_]/.test(token.split(".")[1])) return { token, expiresAt: new Date(exp * 1000) };
    }
    throw new Error("Unable to produce an atob-safe token");
  }
  async verify(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], currentDate: this.clock.now() });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || !USER_TYPES.includes(payload.typ as UserType))
        throw appError("INVALID_TOKEN");
      return { sub: payload.sub, typ: payload.typ as UserType, sid: payload.sid };
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw appError("TOKEN_EXPIRED");
      throw appError("INVALID_TOKEN");
    }
  }
}
```

```ts
// services/api/src/kernel/auth/sessions.ts
// Implemented by L1 (identity). Wave 0 registers a Prisma implementation that
// checks IdentitySessionFamily.revokedAt and expiresAt.
export interface SessionValidator {
  isActive(sessionId: string): Promise<boolean>;
}
export const SESSION_VALIDATOR = Symbol("SESSION_VALIDATOR");
export interface PrincipalLoader {
  load(userId: string, type: string): Promise<{
    permissions: string[];
    restaurantIds: string[];
    vendorId: string | null;
    riderId: string | null;
  } | null>;
}
export const PRINCIPAL_LOADER = Symbol("PRINCIPAL_LOADER");
```

```ts
// services/api/src/kernel/auth/guards.ts
import { appError } from "../errors.js";
import type { UserTokens, UserType } from "./tokens.js";
import type { SessionValidator } from "./sessions.js";

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
  const token = value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : value;
  if (!token) return null;
  const claims = await tokens.verify(token);
  if (!(await sessions.isActive(claims.sid))) throw appError("INVALID_TOKEN");
  return { userId: claims.sub, type: claims.typ, sessionId: claims.sid };
}
export function requireAuth(auth: AuthContext | null, ...types: UserType[]): AuthContext {
  if (!auth) throw appError("UNAUTHENTICATED");
  if (types.length && !types.includes(auth.type) && auth.type !== "ADMIN") throw appError("FORBIDDEN");
  return auth;
}
export function requirePermission(auth: AuthContext | null, permission: string): AuthContext {
  const caller = requireAuth(auth, "ADMIN", "STAFF");
  if (caller.type === "STAFF" && !caller.permissions.includes(permission)) throw appError("FORBIDDEN");
  return caller;
}
export function requireOwnership(
  auth: AuthContext,
  scope: { restaurantId?: string | null; vendorId?: string | null; riderId?: string | null; userId?: string | null },
  staffPermission?: string,
): void {
  if (auth.type === "ADMIN") return;
  if (auth.type === "STAFF" && staffPermission && auth.permissions.includes(staffPermission)) return;
  const ok =
    (scope.restaurantId == null || auth.restaurantIds.includes(scope.restaurantId)) &&
    (scope.vendorId == null || auth.vendorId === scope.vendorId) &&
    (scope.riderId == null || auth.riderId === scope.riderId) &&
    (scope.userId == null || auth.userId === scope.userId);
  if (!ok) throw appError("FORBIDDEN");
}
```

```ts
// services/api/src/kernel/context.ts
import type { AuthContext } from "./auth/guards.js";

export type RequestContext = {
  requestId: string;
  ip: string;
  nonce: string;
  platform: string | null;
  language: string;
  // Resolved on first use; throws TOKEN_EXPIRED / INVALID_TOKEN for bad tokens.
  auth: () => Promise<AuthContext | null>;
  transport: "http" | "ws";
};
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/auth.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/kernel/context.ts services/api/src/kernel/auth services/api/test/unit/kernel/auth.spec.ts
git commit -m "feat(L0): add user tokens, request context and auth guards"
```

### Task A6: Operation limits and `NOT_IMPLEMENTED` fallback

**Files:**
- Create: `services/api/src/kernel/limits.ts` (exports `boundedOperation`; the compatibility tool reads this file after W0-B Task B2)
- Create: `services/api/src/kernel/not-implemented.ts`
- Test: `services/api/test/unit/kernel/limits.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/kernel/limits.spec.ts
import { describe, expect, it } from "vitest";
import { buildSchema, parse, validate, graphql } from "graphql";
import { boundedOperation, LIMITS } from "../../../src/kernel/limits.js";
import { fillNotImplemented } from "../../../src/kernel/not-implemented.js";

const schema = buildSchema(`
  type Node { a: Int, child: Node }
  type Query { node: Node, ready: String }
  type Mutation { one: Int, two: Int }
  type Subscription { tick: Int }
`);
const errorsFor = (query: string) => validate(schema, parse(query), [boundedOperation]);

describe("operation limits", () => {
  it("accepts documents within the limits", () => {
    expect(errorsFor("{ node { a child { a } } }")).toHaveLength(0);
  });
  it("rejects documents deeper than the depth limit", () => {
    const deep = "{ node " + "{ child ".repeat(LIMITS.depth) + "{ a }" + " }".repeat(LIMITS.depth) + " }";
    expect(errorsFor(deep)[0].message).toBe("Operation exceeds allowed limits");
  });
  it("rejects more than one mutation root", () => {
    expect(errorsFor("mutation { one two }")).toHaveLength(1);
  });
  it("rejects fragment cycles", () => {
    expect(
      errorsFor("query { node { ...A } } fragment A on Node { child { ...B } } fragment B on Node { child { ...A } }").length,
    ).toBeGreaterThan(0);
  });
});

describe("NOT_IMPLEMENTED fallback", () => {
  it("fills unresolved root fields with a NOT_IMPLEMENTED error and keeps implemented ones", async () => {
    const executable = buildSchema("type Query { ready: String, missing: String }");
    executable.getQueryType()!.getFields().ready.resolve = () => "yes";
    fillNotImplemented(executable);
    const result = await graphql({ schema: executable, source: "{ ready missing }" });
    expect(result.data).toEqual({ ready: "yes", missing: null });
    expect(result.errors?.[0].message).toBe("missing is not available yet");
    expect(result.errors?.[0].extensions.code).toBe("NOT_IMPLEMENTED");
  });
  it("fills subscriptions without subscribe functions", () => {
    fillNotImplemented(schema);
    const tick = schema.getSubscriptionType()!.getFields().tick;
    expect(() => tick.subscribe!(undefined, {}, {}, {} as never)).toThrow(/not available yet/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/limits.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/limits.ts
import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from "graphql";

// Sized so the largest pinned Enatega document passes with headroom; the Wave 1
// contract test (`pnpm check:enatega`) proves every app document is accepted.
export const LIMITS = { depth: 15, fields: 600, definitions: 60, aliases: 30 } as const;

// Name is load-bearing: tools/check-enatega-compatibility.mjs extracts this rule.
export const boundedOperation: ValidationRule = (context) => ({
  Document(node) {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of node.definitions)
      if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    let fields = 0;
    let aliases = 0;
    let exceeded = node.definitions.length > LIMITS.definitions;
    const walk = (selection: SelectionSetNode, depth: number, seen: Set<string>): void => {
      if (depth > LIMITS.depth || fields > LIMITS.fields) {
        exceeded = true;
        return;
      }
      for (const entry of selection.selections) {
        if (entry.kind === Kind.FIELD) {
          fields++;
          if (entry.alias) aliases++;
          if (entry.selectionSet) walk(entry.selectionSet, depth + 1, seen);
        } else if (entry.kind === Kind.INLINE_FRAGMENT) walk(entry.selectionSet, depth, seen);
        else {
          const name = entry.name.value;
          if (seen.has(name)) {
            exceeded = true;
            return;
          }
          const fragment = fragments.get(name);
          if (fragment) walk(fragment.selectionSet, depth, new Set([...seen, name]));
        }
        if (fields > LIMITS.fields || aliases > LIMITS.aliases) {
          exceeded = true;
          return;
        }
      }
    };
    for (const definition of node.definitions)
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        if (
          definition.operation === "mutation" &&
          definition.selectionSet.selections.filter((s) => s.kind === Kind.FIELD).length > 1
        )
          exceeded = true;
        walk(definition.selectionSet, 1, new Set());
      }
    if (exceeded) context.reportError(new GraphQLError("Operation exceeds allowed limits"));
  },
});
```

```ts
// services/api/src/kernel/not-implemented.ts
import type { GraphQLSchema } from "graphql";
import { appError } from "./errors.js";

// Every root field in the contract exists from Wave 1; fields without a resolver
// fail explicitly instead of returning null or fake data.
export function fillNotImplemented(schema: GraphQLSchema): GraphQLSchema {
  for (const type of [schema.getQueryType(), schema.getMutationType()])
    for (const field of Object.values(type?.getFields() ?? {}))
      if (!field.resolve)
        field.resolve = () => {
          throw appError("NOT_IMPLEMENTED", `${field.name} is not available yet`);
        };
  for (const field of Object.values(schema.getSubscriptionType()?.getFields() ?? {}))
    if (!field.subscribe)
      field.subscribe = () => {
        throw appError("NOT_IMPLEMENTED", `${field.name} is not available yet`);
      };
  return schema;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/limits.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/kernel/limits.ts services/api/src/kernel/not-implemented.ts services/api/test/unit/kernel/limits.spec.ts
git commit -m "feat(L0): add operation limits and NOT_IMPLEMENTED fallback"
```

### Task A7: Redis pub/sub

**Files:**
- Create: `services/api/src/kernel/pubsub.ts`
- Test: `services/api/test/integration/kernel/pubsub.integration.spec.ts` (uses W0-C `stack.ts` once merged; until then start Redis inline with `GenericContainer` as the existing configuration integration test does)

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/kernel/pubsub.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { RedisPubSub } from "../../../src/kernel/pubsub.js";

let redis: StartedTestContainer;
let a: RedisPubSub;
let b: RedisPubSub;
beforeAll(async () => {
  redis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  const url = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  a = new RedisPubSub(url);
  b = new RedisPubSub(url);
});
afterAll(async () => {
  await a?.close();
  await b?.close();
  await redis?.stop();
});

describe("redis pub/sub", () => {
  it("delivers events published by one instance to subscribers on another", async () => {
    const iterator = b.subscribe<{ n: number }>("order:1")[Symbol.asyncIterator]();
    await b.ready("order:1");
    await a.publish("order:1", { n: 1 });
    await a.publish("order:1", { n: 2 });
    expect((await iterator.next()).value).toEqual({ n: 1 });
    expect((await iterator.next()).value).toEqual({ n: 2 });
    await iterator.return!();
  });
  it("applies filters and unsubscribes when the iterator returns", async () => {
    const iterable = b.subscribe<{ rider: string }>("zone:z", (event) => event.rider === "r1");
    const iterator = iterable[Symbol.asyncIterator]();
    await b.ready("zone:z");
    await a.publish("zone:z", { rider: "r2" });
    await a.publish("zone:z", { rider: "r1" });
    expect((await iterator.next()).value).toEqual({ rider: "r1" });
    await iterator.return!();
    expect(b.listenerCount("zone:z")).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/kernel/pubsub.integration.spec.ts`
Expected: FAIL — module not found. (If Docker cannot pull images, record the blocker from master §10 and continue; the test must pass before G0.)

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/pubsub.ts
import { Redis } from "ioredis";

type Listener = (payload: unknown) => void;
export interface PubSub {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe<T>(topic: string, filter?: (payload: T) => boolean): AsyncIterable<T>;
}
export const PUBSUB = Symbol("PUBSUB");

// Small, dependency-free Redis pub/sub so several API instances share events.
export class RedisPubSub implements PubSub {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly subscriptions = new Map<string, Promise<unknown>>();
  constructor(url: string) {
    this.publisher = new Redis(url, { maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null });
    this.publisher.on("error", () => {});
    this.subscriber.on("error", () => {});
    this.subscriber.on("message", (topic: string, message: string) => {
      const payload = JSON.parse(message);
      for (const listener of this.listeners.get(topic) ?? []) listener(payload);
    });
  }
  async publish(topic: string, payload: unknown) {
    await this.publisher.publish(topic, JSON.stringify(payload));
  }
  ready(topic: string) {
    return this.subscriptions.get(topic) ?? Promise.resolve();
  }
  listenerCount(topic: string) {
    return this.listeners.get(topic)?.size ?? 0;
  }
  subscribe<T>(topic: string, filter?: (payload: T) => boolean): AsyncIterable<T> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        const queue: T[] = [];
        const waiting: ((result: IteratorResult<T>) => void)[] = [];
        let done = false;
        const listener: Listener = (payload) => {
          if (done || (filter && !filter(payload as T))) return;
          const resolve = waiting.shift();
          if (resolve) resolve({ value: payload as T, done: false });
          else queue.push(payload as T);
        };
        let set = self.listeners.get(topic);
        if (!set) {
          set = new Set();
          self.listeners.set(topic, set);
          self.subscriptions.set(topic, self.subscriber.subscribe(topic));
        }
        set.add(listener);
        const finish = async (): Promise<IteratorResult<T>> => {
          if (!done) {
            done = true;
            set!.delete(listener);
            if (set!.size === 0) {
              self.listeners.delete(topic);
              self.subscriptions.delete(topic);
              await self.subscriber.unsubscribe(topic);
            }
            for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true });
          }
          return { value: undefined, done: true };
        };
        return {
          next: () =>
            queue.length
              ? Promise.resolve({ value: queue.shift()!, done: false })
              : done
                ? Promise.resolve({ value: undefined, done: true })
                : new Promise((resolve) => waiting.push(resolve)),
          return: finish,
          throw: async (error) => {
            await finish();
            throw error;
          },
        };
      },
    };
  }
  async close() {
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/kernel/pubsub.integration.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/kernel/pubsub.ts services/api/test/integration/kernel/pubsub.integration.spec.ts
git commit -m "feat(L0): add Redis pub/sub shared across API instances"
```

### Task A8: WebSocket server for both subscription protocols

Protocol references: legacy `subscriptions-transport-ws` (subprotocol `graphql-ws`): client `connection_init {payload}`, `start {id, payload:{query, variables, operationName}}`, `stop {id}`, `connection_terminate`; server `connection_ack`, `connection_error {payload}`, `ka`, `data {id, payload:{data, errors}}`, `error {id, payload}`, `complete {id}`. New protocol (subprotocol `graphql-transport-ws`): served by `graphql-ws` 6 `useServer` from `graphql-ws/use/ws`.

**Files:**
- Modify: `services/api/package.json` — add `"ws": "8.22.0"` to dependencies and `"@types/ws": "8.18.1"` to devDependencies, then run `pnpm install --offline` from `implementation/` (if `@types/ws` is not in the store, it needs registry access — master §10).
- Create: `services/api/src/kernel/ws/legacy-protocol.ts`
- Create: `services/api/src/kernel/ws/server.ts`
- Test: `services/api/test/unit/kernel/legacy-protocol.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/kernel/legacy-protocol.spec.ts
import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { buildSchema } from "graphql";
import { LegacySubscriptionSession } from "../../../src/kernel/ws/legacy-protocol.js";

class FakeSocket extends EventEmitter {
  sent: unknown[] = [];
  closed: number | null = null;
  readyState = 1;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number) {
    this.closed = code;
  }
}
async function* ticks() {
  yield { tick: 1 };
  yield { tick: 2 };
}
const schema = buildSchema("type Query { a: Int } type Subscription { tick: Int }");
schema.getSubscriptionType()!.getFields().tick.subscribe = () => ticks();
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("legacy subscriptions-transport-ws session", () => {
  it("acks connection_init with the connectionParams passed to onConnect", async () => {
    const socket = new FakeSocket();
    let params: unknown;
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async (p) => {
        params = p;
        return { ok: true };
      },
      keepAliveMs: 0,
    });
    socket.emit("message", JSON.stringify({ type: "connection_init", payload: { authorization: "" } }));
    await flush();
    expect(params).toEqual({ authorization: "" });
    expect(socket.sent).toEqual([{ type: "connection_ack" }]);
  });
  it("streams data messages then complete for a start", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, { onConnect: async () => ({}), keepAliveMs: 0 });
    socket.emit("message", JSON.stringify({ type: "connection_init", payload: {} }));
    socket.emit("message", JSON.stringify({ type: "start", id: "1", payload: { query: "subscription { tick }" } }));
    await flush();
    expect(socket.sent).toEqual([
      { type: "connection_ack" },
      { type: "data", id: "1", payload: { data: { tick: 1 } } },
      { type: "data", id: "1", payload: { data: { tick: 2 } } },
      { type: "complete", id: "1" },
    ]);
  });
  it("returns validation errors as an error message", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, { onConnect: async () => ({}), keepAliveMs: 0 });
    socket.emit("message", JSON.stringify({ type: "connection_init", payload: {} }));
    socket.emit("message", JSON.stringify({ type: "start", id: "2", payload: { query: "subscription { nope }" } }));
    await flush();
    expect(socket.sent[1]).toMatchObject({ type: "error", id: "2" });
  });
  it("rejects start before connection_init", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, { onConnect: async () => ({}), keepAliveMs: 0 });
    socket.emit("message", JSON.stringify({ type: "start", id: "1", payload: { query: "subscription { tick }" } }));
    await flush();
    expect(socket.sent[0]).toMatchObject({ type: "error", id: "1" });
  });
  it("sends connection_error and closes when onConnect throws", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async () => {
        throw new Error("Invalid token");
      },
      keepAliveMs: 0,
    });
    socket.emit("message", JSON.stringify({ type: "connection_init", payload: {} }));
    await flush();
    expect(socket.sent[0]).toEqual({ type: "connection_error", payload: { message: "Invalid token" } });
    expect(socket.closed).toBe(1011);
  });
  it("sends ka after ack when keep-alive is enabled", async () => {
    const socket = new FakeSocket();
    const session = new LegacySubscriptionSession(socket as never, schema, { onConnect: async () => ({}), keepAliveMs: 5 });
    socket.emit("message", JSON.stringify({ type: "connection_init", payload: {} }));
    await flush();
    expect(socket.sent).toContainEqual({ type: "ka" });
    session.dispose();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/legacy-protocol.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/ws/legacy-protocol.ts
import {
  parse,
  validate,
  subscribe,
  specifiedRules,
  type ExecutionResult,
  type GraphQLSchema,
  type ValidationRule,
} from "graphql";
import type { WebSocket } from "ws";
import { formatError } from "../errors.js";

type Message =
  | { type: "connection_init"; payload?: Record<string, unknown> }
  | { type: "start"; id: string; payload: { query: string; variables?: Record<string, unknown>; operationName?: string } }
  | { type: "stop"; id: string }
  | { type: "connection_terminate" };
export type LegacyOptions = {
  onConnect: (params: Record<string, unknown>) => Promise<unknown>;
  keepAliveMs: number;
  rules?: ValidationRule[];
};

// Server side of the legacy subscriptions-transport-ws protocol used by all six
// Enatega apps (reference/01 §4). @nestjs/graphql 14 no longer ships it.
export class LegacySubscriptionSession {
  private context: unknown;
  private initialised = false;
  private readonly operations = new Map<string, AsyncIterator<ExecutionResult>>();
  private keepAlive: NodeJS.Timeout | undefined;
  constructor(
    private readonly socket: Pick<WebSocket, "send" | "close" | "on" | "readyState">,
    private readonly schema: GraphQLSchema,
    private readonly options: LegacyOptions,
  ) {
    socket.on("message", (data: Buffer | string) => void this.handle(String(data)));
    socket.on("close", () => this.dispose());
  }
  private send(message: object) {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }
  private async handle(raw: string) {
    let message: Message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.send({ type: "error", payload: { message: "Invalid message" } });
    }
    switch (message.type) {
      case "connection_init":
        try {
          this.context = await this.options.onConnect(message.payload ?? {});
          this.initialised = true;
          this.send({ type: "connection_ack" });
          if (this.options.keepAliveMs > 0) {
            this.send({ type: "ka" });
            this.keepAlive = setInterval(() => this.send({ type: "ka" }), this.options.keepAliveMs);
          }
        } catch (error) {
          this.send({ type: "connection_error", payload: { message: (error as Error).message } });
          this.socket.close(1011);
        }
        return;
      case "start":
        return this.start(message.id, message.payload);
      case "stop":
        await this.operations.get(message.id)?.return?.();
        this.operations.delete(message.id);
        return;
      case "connection_terminate":
        this.dispose();
        this.socket.close(1000);
        return;
      default:
        this.send({ type: "error", payload: { message: "Unknown message type" } });
    }
  }
  private async start(id: string, payload: { query: string; variables?: Record<string, unknown>; operationName?: string }) {
    if (!this.initialised) return this.send({ type: "error", id, payload: { message: "Connection not initialised" } });
    await this.operations.get(id)?.return?.();
    let document;
    try {
      document = parse(payload.query);
    } catch (error) {
      return this.send({ type: "error", id, payload: { message: (error as Error).message } });
    }
    const errors = validate(this.schema, document, [...specifiedRules, ...(this.options.rules ?? [])]);
    if (errors.length) return this.send({ type: "error", id, payload: errors.map((e) => formatError({ message: e.message, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } })) });
    const result = await subscribe({
      schema: this.schema,
      document,
      variableValues: payload.variables,
      operationName: payload.operationName,
      contextValue: this.context,
    });
    if (!(Symbol.asyncIterator in result)) {
      this.send({ type: "data", id, payload: { data: result.data ?? null, errors: result.errors?.map(formatError) } });
      return this.send({ type: "complete", id });
    }
    const iterator = result[Symbol.asyncIterator]();
    this.operations.set(id, iterator);
    for (;;) {
      const next = await iterator.next();
      if (next.done || !this.operations.has(id)) break;
      const value = next.value;
      this.send({
        type: "data",
        id,
        payload: value.errors ? { data: value.data ?? null, errors: value.errors.map(formatError) } : { data: value.data },
      });
    }
    if (this.operations.delete(id)) this.send({ type: "complete", id });
  }
  dispose() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    for (const iterator of this.operations.values()) void iterator.return?.();
    this.operations.clear();
  }
}
```

```ts
// services/api/src/kernel/ws/server.ts
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";
import type { GraphQLSchema } from "graphql";
import { LegacySubscriptionSession } from "./legacy-protocol.js";
import { boundedOperation } from "../limits.js";

export type WsContextFactory = (params: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>;

// One path, two protocols, chosen by Sec-WebSocket-Protocol (master D9).
export function attachSubscriptionServer(http: HttpServer, schema: GraphQLSchema, context: WsContextFactory) {
  const legacy = new WebSocketServer({ noServer: true, handleProtocols: () => "graphql-ws" });
  const modern = new WebSocketServer({ noServer: true, handleProtocols: () => "graphql-transport-ws" });
  legacy.on("connection", (socket, request: IncomingMessage) => {
    new LegacySubscriptionSession(socket, schema, {
      onConnect: (params) => context(params, request),
      keepAliveMs: 15000,
      rules: [boundedOperation],
    });
  });
  const disposeModern = useServer(
    {
      schema,
      validationRules: [boundedOperation],
      context: (ctx) => context((ctx.connectionParams ?? {}) as Record<string, unknown>, ctx.extra.request),
    },
    modern,
  );
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/graphql") return socket.destroy();
    const offered = String(request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim());
    const target = offered.includes("graphql-transport-ws") ? modern : offered.includes("graphql-ws") ? legacy : null;
    if (!target) return socket.destroy();
    target.handleUpgrade(request, socket, head, (ws) => target.emit("connection", ws, request));
  });
  return async () => {
    await disposeModern.dispose();
    for (const client of legacy.clients) client.terminate();
    legacy.close();
    modern.close();
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/kernel/legacy-protocol.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/package.json ../pnpm-lock.yaml services/api/src/kernel/ws services/api/test/unit/kernel/legacy-protocol.spec.ts
git commit -m "feat(L0): serve legacy and graphql-ws subscription protocols on /graphql"
```

### Task A9: Rewire `app.ts` and `main.ts`

**Files:**
- Modify: `services/api/src/app.ts` (replace inline `boundedOperation`, `formatError`, typeDefs list, body limit, CORS; mount gate, plugins, WebSocket server, `transformSchema`)
- Modify: `services/api/src/main.ts` (listen on `config.HOST`)
- Create: `services/api/src/kernel/kernel.module.ts`
- Create: `services/api/src/kernel/schema.ts`
- Test: `services/api/test/integration/kernel/transport.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// services/api/test/integration/kernel/transport.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createClient } from "graphql-ws";
import { startStack, type Stack } from "../../support/stack.js";
import { startApi, type Api } from "../../support/app.js";

let stack: Stack;
let api: Api;
beforeAll(async () => {
  stack = await startStack();
  api = await startApi(stack);
});
afterAll(async () => {
  await api?.close();
  await stack?.stop();
});

describe("transport", () => {
  it("mints a public-access token and accepts it on later requests", async () => {
    const minted = await api.http.metricsGeneral("nonce-1");
    expect(minted.hehe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ok = await api.http.raw({ query: "{ _kernel }" }, { nonce: "nonce-1", "bop-auth": `Bearer ${minted.experience}` });
    expect(ok.status).toBe(200);
  });
  it("rejects requests without the handshake with HTTP 403 and the exact message", async () => {
    const response = await api.http.raw({ query: "{ _kernel }" }, { nonce: "n" });
    expect(response.status).toBe(403);
    expect(response.body.errors[0]).toEqual({
      message: "Unauthorized: token missing",
      extensions: { code: "PUBLIC_ACCESS_DENIED" },
    });
  });
  it("answers unimplemented roots with NOT_IMPLEMENTED", async () => {
    const result = await api.http.query("{ _kernel }");
    expect(result.errors[0].extensions.code).toBe("NOT_IMPLEMENTED");
  });
  it("accepts a 900 kB document body (Enatega documents exceed the old 16 kB cap)", async () => {
    const padding = " ".repeat(900 * 1024);
    const result = await api.http.query(`{ _kernel }${padding}`);
    expect(result.errors[0].extensions.code).toBe("NOT_IMPLEMENTED");
  });
  it("speaks the legacy graphql-ws subprotocol", async () => {
    const socket = new WebSocket(api.wsUrl, "graphql-ws");
    const messages: { type: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => socket.send(JSON.stringify({ type: "connection_init", payload: { authorization: "" } })));
      socket.on("message", (data) => {
        messages.push(JSON.parse(String(data)));
        if (messages.some((m) => m.type === "connection_ack")) resolve();
      });
      socket.on("error", reject);
    });
    socket.send(JSON.stringify({ type: "start", id: "1", payload: { query: "subscription { _kernel }" } }));
    await new Promise((r) => setTimeout(r, 200));
    expect(messages.find((m) => (m as { id?: string }).id === "1")).toMatchObject({ type: "error" });
    socket.close();
  });
  it("speaks the graphql-transport-ws subprotocol", async () => {
    const client = createClient({ url: api.wsUrl, webSocketImpl: WebSocket, lazy: false });
    const error = await new Promise((resolve) => {
      client.subscribe({ query: "subscription { _kernel }" }, { next: () => {}, error: resolve, complete: () => {} });
    });
    expect(JSON.stringify(error)).toContain("not available yet");
    await client.dispose();
  });
  it("refuses other subprotocols and paths", async () => {
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(api.wsUrl, "chat");
        socket.on("open", resolve);
        socket.on("error", reject);
      }),
    ).rejects.toBeTruthy();
  });
});
```

This test depends on W0-C Tasks C1–C3 (`stack.ts`, `app.ts`). If W0-C has not merged, write it now and run it after the merge; keep Step 2 for later.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/kernel/transport.integration.spec.ts`
Expected: FAIL — `metricsGeneral` is not in the schema.

- [ ] **Step 3: Implement**

```ts
// services/api/src/kernel/schema.ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contracts = new URL("../../../../contracts/", import.meta.url);
// Loads every SDL file under contracts/enatega in a stable order. The four
// legacy FairBite files are loaded until Wave 1 Task W1-0.9 removes them (D15).
export function loadTypeDefs(): string[] {
  const directory = fileURLToPath(new URL("enatega/", contracts));
  const files = existsSync(directory)
    ? readdirSync(directory).filter((f) => f.endsWith(".graphql")).sort()
    : [];
  const legacy = ["foundation.graphql", "identity.graphql", "catalog.graphql", "addresses.graphql", "configuration.graphql"]
    .map((f) => fileURLToPath(new URL(f, contracts)))
    .filter(existsSync);
  return [...files.map((f) => readFileSync(`${directory}/${f}`, "utf8")), ...legacy.map((f) => readFileSync(f, "utf8"))];
}
```

Because `kernel.graphql` declares `type Query`, `type Mutation` and `type Subscription`, every other SDL file (including the legacy ones) must use `extend type Query` / `extend type Mutation`. Change the first line of each legacy file that declares `type Query {` or `type Mutation {` to `extend type …` (`foundation.graphql` and `identity.graphql` today) and re-run `pnpm codegen`.

```ts
// services/api/src/kernel/kernel.module.ts
import { Module, type DynamicModule } from "@nestjs/common";
import type { Config } from "../config.js";
import { PublicAccessTokens } from "./public-access/token.js";
import { PublicAccessResolver } from "./public-access/resolver.js";
import { UserTokens } from "./auth/tokens.js";
import { PUBSUB, RedisPubSub } from "./pubsub.js";

@Module({})
export class KernelModule {
  static register(config: Config): DynamicModule {
    return {
      module: KernelModule,
      global: true,
      providers: [
        { provide: PublicAccessTokens, useValue: new PublicAccessTokens(config.PUBLIC_ACCESS_SECRET!, config.PUBLIC_ACCESS_TTL_SECONDS) },
        {
          provide: UserTokens,
          useValue: new UserTokens(
            config.ACCESS_TOKEN_SECRET ?? Buffer.alloc(32, 5).toString("base64url"),
            config.USER_TOKEN_TTL_SECONDS,
          ),
        },
        { provide: PUBSUB, useFactory: () => new RedisPubSub(config.REDIS_URL) },
        PublicAccessResolver,
      ],
      exports: [PublicAccessTokens, UserTokens, PUBSUB],
    };
  }
}
```

The fallback `ACCESS_TOKEN_SECRET` above is only reachable when `PASSWORD_AUTH_ENABLED=false`; L1 Task 1 makes `ACCESS_TOKEN_SECRET` mandatory outside `test`. Record that dependency in the handoff.

In `services/api/src/app.ts`:

1. Delete the inline `boundedOperation` and `formatError` (they now live in `kernel/limits.ts` and `kernel/errors.ts`).
2. Import `KernelModule` and add `KernelModule.register(config)` first in `imports`.
3. Replace the `typeDefs` array with `typeDefs: loadTypeDefs()`.
4. Set `validationRules: [boundedOperation]`, `formatError`, `plugins: [httpStatusPlugin]`, `transformSchema: (schema) => fillNotImplemented(schema)`.
5. Replace the context factory with:

```ts
        context: ({ req }: { req: Request }): RequestContext => {
          let resolved: Promise<AuthContext | null> | undefined;
          const header = (name: string) => {
            const value = req.headers[name];
            return (Array.isArray(value) ? value[0] : value) ?? "";
          };
          return {
            requestId: randomUUID(),
            ip: req.socket.remoteAddress ?? "unknown",
            nonce: header("nonce").trim(),
            platform: header("x-platform") || null,
            language: header("accept-language") || "en",
            transport: "http",
            auth: () => (resolved ??= authResolver(header("authorization"))),
          };
        },
```

where `authResolver` is created inside `createApp` from the `UserTokens` instance and a `SessionValidator` that queries `IdentitySessionFamily` (`SELECT 1 FROM "IdentitySessionFamily" WHERE id = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()`) through the existing `database` pool, followed by a `PrincipalLoader` returning `{ permissions: [], restaurantIds: [], vendorId: null, riderId: null }` until L1 registers the real loader.

6. Replace `app.use(json({ limit: "16kb" }))` with `app.use(json({ limit: config.GRAPHQL_BODY_LIMIT }))` followed by `app.use("/graphql", publicAccessMiddleware(config.PUBLIC_ACCESS_ENFORCED, (t, n) => publicTokens.verify(t, n)))`.
7. Replace `app.enableCors(...)` with:

```ts
  app.enableCors({
    origin: config.origins,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "content-type", "authorization", "nonce", "bop-auth", "userid", "isauth",
      "x-client-type", "x-platform", "accept", "accept-language", "x-skip-public-auth",
    ],
  });
```

8. After `await app.init()`, attach the WebSocket server:

```ts
  const schema = app.get(GraphQLSchemaHost).schema;
  const closeWs = attachSubscriptionServer(app.getHttpServer(), schema, async (params) => {
    const authorization = typeof params.authorization === "string" ? params.authorization : "";
    let resolved: Promise<AuthContext | null> | undefined;
    return {
      requestId: randomUUID(),
      ip: "ws",
      nonce: typeof params.nonce === "string" ? params.nonce : "",
      platform: typeof params["x-platform"] === "string" ? params["x-platform"] : null,
      language: typeof params["accept-language"] === "string" ? params["accept-language"] : "en",
      transport: "ws",
      auth: () => (resolved ??= authResolver(authorization)),
    } satisfies RequestContext;
  });
```

and close it in `DependencyLifecycle.onApplicationShutdown` (`await closeWs()`).

In `services/api/src/main.ts` change `await app.listen(config.PORT, "127.0.0.1")` to `await app.listen(config.PORT, config.HOST)`.

- [ ] **Step 4: Update the existing HTTP unit test for the new behaviour**

In `services/api/test/http.spec.ts`, every request that is not `metricsGeneral` now needs the handshake. Add at the top:

```ts
async function handshake(server: Parameters<typeof request>[0]) {
  const minted = await request(server)
    .post("/graphql")
    .set("nonce", "unit-test")
    .send({ query: "mutation { metricsGeneral { experience } }" });
  return { nonce: "unit-test", "bop-auth": `Bearer ${minted.body.data.metricsGeneral.experience}` };
}
```

and call `.set(await handshake(app.getHttpServer()))` before each `.send(...)`. Replace the 16 kB body test with a test that a 2 MB body returns 413.

- [ ] **Step 5: Run unit and integration tests**

Run: `pnpm --filter @fairbite/api test && pnpm --filter @fairbite/api test:integration`
Expected: PASS, including `transport.integration.spec.ts` (7 tests) and all pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add services/api/src services/api/test contracts
git commit -m "feat(L0): wire kernel transport, gate, limits and subscriptions into the API"
```

### Task A10: W0-A handoff

- [ ] Run: `pnpm lint && pnpm typecheck && pnpm --filter @fairbite/api test && pnpm --filter @fairbite/api test:integration`
- [ ] Report: commands and results, files changed, open questions (none expected), blockers (Docker, registry).

---

## Agent W0-B — contract tooling and gates

Owns: `tools/**`, root `package.json` scripts, `codegen.ts`, `turbo.json`.

### Task B1: Manifest tool skips untracked build artefacts

`npm ci` and `next dev` inside `vendor/enatega-ui/<app>` create `node_modules`, `.next` and `.env*` files. The manifest must ignore exactly the exclusions it declares.

**Files:**
- Modify: `tools/manifest-enatega-ui.mjs`
- Test: `tools/manifest-enatega-ui.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tools/manifest-enatega-ui.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles } from "./manifest-enatega-ui.mjs";

test("ignores dependency, build and env artefacts but keeps source", () => {
  const root = mkdtempSync(join(tmpdir(), "manifest-"));
  for (const dir of ["app/node_modules/x", "app/.next/cache", "app/.expo", "app/dist", "app/.turbo", "app/src"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "app/node_modules/x/index.js"), "");
  writeFileSync(join(root, "app/.next/cache/a"), "");
  writeFileSync(join(root, "app/.env.local"), "SECRET=1");
  writeFileSync(join(root, "app/.env"), "SECRET=1");
  writeFileSync(join(root, "app/.DS_Store"), "");
  writeFileSync(join(root, "app/src/page.tsx"), "export {}");
  writeFileSync(join(root, "app/.env.example"), "KEY=");
  assert.deepEqual(listFiles(root), ["app/.env.example", "app/src/page.tsx"]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tools/manifest-enatega-ui.test.mjs`
Expected: FAIL — `listFiles` is not exported.

- [ ] **Step 3: Implement**

In `tools/manifest-enatega-ui.mjs`, replace the `files` function and its first use with an exported `listFiles(root)` that returns POSIX relative paths and skips directories named `.git`, `node_modules`, `.next`, `.expo`, `dist`, `.turbo` and files named `.DS_Store`, `.env`, or matching `/^\.env\..+/` except `.env.example`. Keep `excludedPaths`. Only run the manifest build/check when the module is the entry point:

```js
export function listFiles(root) {
  const skipDirs = new Set([".git", "node_modules", ".next", ".expo", "dist", ".turbo"]);
  const skipFile = (name) =>
    name === ".DS_Store" || name === ".env" || (/^\.env\..+/.test(name) && name !== ".env.example");
  const walk = (directory) =>
    readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return skipDirs.has(entry.name) ? [] : walk(path);
        const rel = relative(root, path).split(sep).join("/");
        if (!entry.isFile() || ignored.has(entry.name) || skipFile(entry.name) || excludedPaths.has(rel)) return [];
        return [rel];
      });
  return walk(root);
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  /* existing manifest build and --check logic, using listFiles(source) */
}
```

- [ ] **Step 4: Run tests and the real check**

Run: `node --test tools/manifest-enatega-ui.test.mjs && node tools/manifest-enatega-ui.mjs --check`
Expected: test PASS; check prints `{"status":"verified","files":4137,…}`.

- [ ] **Step 5: Commit**

```bash
git add tools/manifest-enatega-ui.mjs tools/manifest-enatega-ui.test.mjs
git commit -m "fix(tools): ignore build and env artefacts in the Enatega UI manifest"
```

### Task B2: Compatibility checker reads the kernel rule and scopes by lane

**Files:**
- Modify: `tools/check-enatega-compatibility.mjs`
- Modify: `tools/check-enatega-compatibility.test.mjs`

- [ ] **Step 1: Write the failing tests** (append to the existing test file)

```js
test("reads boundedOperation from services/api/src/kernel/limits.ts when present", () => {
  const report = audit(fixtureSource, fixtureContractsWithKernelLimits, ["enatega-multivendor-web"]);
  assert.equal(report.serverLimits.source, "services/api/src/kernel/limits.ts");
});
test("--scope multivendor ignores documents whose only missing roots are L12", () => {
  const report = audit(fixtureSource, fixtureContracts, ["enatega-multivendor-web"], {
    scope: "multivendor",
    lanes: { "query.singleVendorDiscovery": "L12" },
  });
  assert.equal(report.staticCompatibility, "PASS");
});
```

Create the fixtures `fixtureContractsWithKernelLimits` (a temp directory with `contracts/` and `services/api/src/kernel/limits.ts` copied from the real file) and a web fixture document that selects only `singleVendorDiscovery`, using the helpers already in the test file.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test tools/check-enatega-compatibility.test.mjs`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Implement**

- Look for the rule first at `resolve(contracts, "../services/api/src/kernel/limits.ts")`, then at the old `app.ts` path. For `kernel/limits.ts`, also extract `LIMITS` (the object literal) and evaluate it in the same VM context before the rule.
- The body-limit check reads `GRAPHQL_BODY_LIMIT` default from `services/api/src/config.ts` (`/GRAPHQL_BODY_LIMIT[\s\S]*?default\("(\d+)(kb|mb)"\)/`), converting to bytes.
- Add an optional fourth `audit` parameter `{ scope, lanes }`. When `scope === "multivendor"`, a document whose `missingRoots` are all mapped to `L12` in `lanes` is marked `OUT_OF_SCOPE` and does not fail the gate. CLI: `--scope multivendor` loads lanes from `docs/OPERATION_LANES.json`.
- Update `package.json`: `"check:enatega": "node tools/check-enatega-compatibility.mjs vendor/enatega-ui contracts docs/ENATEGA_COMPATIBILITY_REPORT.json --check --scope multivendor"`, and make `contracts` mean "all `*.graphql` under `contracts/` recursively" in `files()`.

- [ ] **Step 4: Run tests**

Run: `node --test tools/check-enatega-compatibility.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/check-enatega-compatibility.mjs tools/check-enatega-compatibility.test.mjs package.json
git commit -m "feat(tools): read kernel limits and scope the contract gate by lane"
```

### Task B3: Shared document loader for tests

Tests must send the exact documents the apps send. The loader resolves an exported `gql` document (with its interpolated fragments) from a vendored source file.

**Files:**
- Create: `tools/lib/documents.mjs`
- Test: `tools/lib/documents.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tools/lib/documents.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDocument, listDocuments } from "./documents.mjs";

test("loads an exported gql document by name with its operation intact", () => {
  const text = loadDocument("enatega-multivendor-admin", "lib/api/graphql/mutations/metrics/index.ts", "METRICS_GENERAL");
  assert.match(text, /mutation MetricsGeneral/);
  assert.match(text, /metricsGeneral \{/);
});
test("inlines interpolated fragments from the same or imported files", () => {
  const docs = listDocuments("enatega-multivendor-web");
  const withFragments = docs.find((d) => d.interpolations > 0 && d.resolved);
  assert.ok(withFragments, "at least one interpolated document resolves");
  assert.doesNotMatch(withFragments.text, /\$\{/);
});
test("refuses paths outside vendor/enatega-ui", () => {
  assert.throws(() => loadDocument("..", "package.json", "x"), /outside/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tools/lib/documents.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Move the TypeScript-AST document extraction out of `check-enatega-compatibility.mjs` into `tools/lib/documents.mjs` and re-import it there, so both share one implementation. Exports:

- `listDocuments(app)` → `[{ file, line, exportName | null, text, interpolations, resolved }]` for every `gql`/`graphql` tagged template and `.graphql` file in `vendor/enatega-ui/<app>`, skipping `node_modules`, `.next`, `cypress`, `__tests__`.
- `loadDocument(app, file, exportName)` → the printed document text for the exported binding, with `${FRAGMENT}` interpolations replaced by the referenced fragment definitions (resolving local consts and relative imports up to 3 levels), throwing `Error("Unresolved document …")` if anything stays dynamic.
- Paths are resolved against `vendor/enatega-ui` and must stay inside it (`throw new Error("Path outside vendor/enatega-ui")`).

Upstream code is parsed with the TypeScript compiler API only; never `import`ed or executed.

- [ ] **Step 4: Run tests, including the checker's tests (it now imports the shared module)**

Run: `node --test tools/lib/documents.test.mjs tools/check-enatega-compatibility.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/lib tools/check-enatega-compatibility.mjs
git commit -m "feat(tools): share exact Enatega document extraction between gate and tests"
```

### Task B4: Operation coverage gate

**Files:**
- Create: `tools/check-operations.mjs`
- Test: `tools/check-operations.test.mjs`
- Modify: `package.json` (`"check:operations": "node tools/check-operations.mjs"`)

Behaviour:

1. Build the schema from `contracts/**/*.graphql` with `buildSchema`.
2. Read `docs/OPERATION_LANES.json`.
3. Find implemented roots by scanning `services/api/src/**/*.ts` for `@Query("name")`, `@Mutation("name")`, `@Subscription("name")` decorators (TypeScript AST, string-literal first argument).
4. Find integration-tested roots by scanning `services/api/test/integration/**/*.ts` and `services/api/test/journeys/**/*.ts` for calls `op("type.name")`.
5. Find E2E-exercised roots by scanning `e2e/**/*.ts` for `@op:type.name` in test titles or `op("type.name")` annotations.
6. Write `docs/OPERATION_COVERAGE.json`: `{ total, inSchema, implemented, integrationTested, e2e, perLane: {L1: {...}}, operations: [{ type, name, lane, inSchema, implemented, integrationTested, e2e }] }`.
7. Flags: `--lane L3` (restrict), `--require-schema` (fail if any root is missing from the schema), `--require-implemented`, `--require-tests`, `--require-e2e`, `--check` (fail if the committed JSON differs).
8. Exit 1 with a list of offending operations when a `--require-*` flag fails.

- [ ] **Step 1: Write the failing test**

```js
// tools/check-operations.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverage } from "./check-operations.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ops-"));
  for (const dir of ["contracts", "docs", "services/api/src/m", "services/api/test/integration/m", "e2e"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "contracts/a.graphql"), "type Query { a: Int b: Int } type Mutation { c: Int }");
  writeFileSync(
    join(root, "docs/OPERATION_LANES.json"),
    JSON.stringify({ operations: [
      { type: "query", name: "a", lane: "L1" },
      { type: "query", name: "b", lane: "L1" },
      { type: "mutation", name: "c", lane: "L2" },
      { type: "mutation", name: "d", lane: "L2" },
    ] }),
  );
  writeFileSync(join(root, "services/api/src/m/r.ts"), '@Query("a") a() {}\n@Mutation("c") c() {}');
  writeFileSync(join(root, "services/api/test/integration/m/a.integration.spec.ts"), 'describe(op("query.a"), () => {})');
  writeFileSync(join(root, "e2e/a.spec.ts"), 'test("admin sees a @op:query.a", () => {})');
  return root;
}

test("classifies schema, implementation, tests and e2e per operation", () => {
  const report = coverage(fixture());
  const byName = Object.fromEntries(report.operations.map((o) => [o.name, o]));
  assert.deepEqual(
    { ...byName.a, type: undefined, lane: undefined },
    { type: undefined, lane: undefined, name: "a", inSchema: true, implemented: true, integrationTested: true, e2e: true },
  );
  assert.equal(byName.b.implemented, false);
  assert.equal(byName.d.inSchema, false);
  assert.equal(report.perLane.L2.inSchema, 1);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tools/check-operations.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `tools/check-operations.mjs` exporting `coverage(root)` and a CLI entry as described above (use `typescript` for decorator and call scanning, `graphql` for the schema).

- [ ] **Step 4: Run tests**

Run: `node --test tools/check-operations.test.mjs && node tools/check-operations.mjs`
Expected: test PASS; CLI writes `docs/OPERATION_COVERAGE.json` showing 1 implemented root (`metricsGeneral`) once W0-A merges.

- [ ] **Step 5: Commit**

```bash
git add tools/check-operations.mjs tools/check-operations.test.mjs package.json docs/OPERATION_COVERAGE.json
git commit -m "feat(tools): add per-operation coverage gate"
```

### Task B5: Error-message gate and inventory freshness

**Files:**
- Create: `tools/check-error-messages.mjs` + `tools/check-error-messages.test.mjs`
- Modify: `package.json`

`check-error-messages.mjs` scans `services/api/src/**/*.ts` for `appError("CODE", "message")` and `new GraphQLError("message"` calls with string-literal messages and fails if a non-auth code's message contains any of `unauthorized`, `unauthenticated`, `jwt expired`, `invalid token`, `forbidden` (case-insensitive), or if `new GraphQLError` is used outside `src/kernel/` (lanes must use `appError`).

Add scripts:

```json
"check:errors": "node tools/check-error-messages.mjs",
"check:inventory": "node tools/inventory-operations.mjs docs/.inventory.tmp.json && node -e \"const a=require('fs').readFileSync('docs/.inventory.tmp.json','utf8'),b=require('fs').readFileSync('docs/ENATEGA_OPERATION_INVENTORY.json','utf8');require('fs').unlinkSync('docs/.inventory.tmp.json');if(a!==b){console.error('Stale inventory');process.exit(1)}\"",
"test:tools": "node --test tools/**/*.test.mjs"
```

- [ ] **Step 1: Write the failing test** for the message rule with three fixtures: an allowed auth message (`appError("INVALID_TOKEN", "Invalid token")`), a forbidden business message (`appError("BAD_USER_INPUT", "You are unauthorized")`) and a raw `new GraphQLError` in `src/modules/x.ts`.
- [ ] **Step 2: Run it**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test tools/check-error-messages.test.mjs && pnpm check:errors && pnpm check:inventory`; expect PASS.
- [ ] **Step 5: Commit** `feat(tools): gate error wording and inventory freshness`.

### Task B6: One verification entry point

**Files:**
- Create: `tools/verify.mjs`
- Modify: `package.json` (`"verify": "node tools/verify.mjs"`, `"verify:gate": "node tools/verify.mjs --record"`)

`verify.mjs` runs, in order, stopping at the first failure: `lint`, `format:check`, `typecheck`, `build`, `test`, `test:tools`, `check:inventory`, `check:errors`, `check:enatega-ui-source`, `check:enatega`, `check:operations`, `codegen:check`, then (if `--integration`) `test:integration`, (if `--coverage`) `coverage`, (if `--e2e`) `e2e`. With `--record <gate>` it appends `{ gate, commit, timestamp, steps: [{ name, ok, durationMs, summary }] }` to `docs/GATES.json`, where `summary` is the last 20 lines of each step's output.

- [ ] Write a test that runs `verify.mjs --dry-run` and asserts the printed step list and order.
- [ ] Implement, run, commit `feat(tools): add single verification entry point and gate log`.

---

## Agent W0-C — test, coverage and E2E harness

Owns: `services/api/test/support/**`, `services/api/vitest*.config.ts`, `e2e/**`, `infra/**`, and the recorded frontend edit in Task C7.

### Task C1: Database and Redis stack for integration tests

**Files:**
- Create: `services/api/test/support/stack.ts`
- Test: `services/api/test/integration/support/stack.integration.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/support/stack.integration.spec.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack?.stop());

it("starts PostGIS and Redis with every migration applied", async () => {
  const { rows } = await stack.pool.query("SELECT extname FROM pg_extension WHERE extname = 'postgis'");
  expect(rows).toHaveLength(1);
  const migrations = await stack.pool.query('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
  expect(migrations.rows[0].n).toBeGreaterThanOrEqual(5);
  expect(await stack.redis.ping()).toBe("PONG");
});
it("truncates all application tables between tests without dropping migrations", async () => {
  await stack.reset();
  const { rows } = await stack.pool.query('SELECT count(*)::int AS n FROM "_prisma_migrations"');
  expect(rows[0].n).toBeGreaterThanOrEqual(5);
});
```

- [ ] **Step 2: Run it**, expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// services/api/test/support/stack.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import { Redis } from "ioredis";

const run = promisify(execFile);
const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
export type Stack = {
  databaseUrl: string;
  redisUrl: string;
  pool: Pool;
  redis: Redis;
  reset(): Promise<void>;
  stop(): Promise<void>;
};

// One container pair per test file; migrations are applied with the real
// `prisma migrate deploy` so tests exercise exactly what production runs.
export async function startStack(): Promise<Stack> {
  const db: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withPlatform("linux/amd64")
    .start();
  const cache: StartedTestContainer = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  const databaseUrl = db.getConnectionUri();
  const redisUrl = `redis://${cache.getHost()}:${cache.getMappedPort(6379)}`;
  await run(process.execPath, [fileURLToPath(import.meta.resolve("prisma/build/index.js")), "migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  pool.on("error", () => {});
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  redis.on("error", () => {});
  return {
    databaseUrl,
    redisUrl,
    pool,
    redis,
    async reset() {
      const { rows } = await pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')",
      );
      if (rows.length)
        await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
      await redis.flushdb();
    },
    async stop() {
      redis.disconnect();
      await pool.end();
      await cache.stop();
      await db.stop();
    },
  };
}
```

- [ ] **Step 4: Run it**, expect PASS (requires Docker image pulls; master §10).
- [ ] **Step 5: Commit** `test(harness): add PostGIS and Redis stack with real migrations`.

### Task C2: API, GraphQL and WebSocket clients for tests

**Files:**
- Create: `services/api/test/support/app.ts`
- Create: `services/api/test/support/gql.ts`
- Create: `services/api/test/support/ws.ts`
- Create: `services/api/test/support/op.ts`
- Create: `services/api/test/support/documents.ts`
- Test: `services/api/test/integration/support/clients.integration.spec.ts`

```ts
// services/api/test/support/op.ts
// Tags a describe block with the root operation it exercises. Read by tools/check-operations.mjs.
export const op = (name: `${"query" | "mutation" | "subscription"}.${string}`) => `[op:${name}]`;
```

```ts
// services/api/test/support/documents.ts
// Exact app documents, loaded from vendor/enatega-ui by tools/lib/documents.mjs.
import { loadDocument } from "../../../../tools/lib/documents.mjs";
export type App =
  | "enatega-multivendor-admin"
  | "enatega-multivendor-web"
  | "enatega-multivendor-app"
  | "enatega-multivendor-store"
  | "enatega-multivendor-rider"
  | "enatega-singlevendor-admin";
const cache = new Map<string, string>();
export function doc(app: App, file: string, exportName: string): string {
  const key = `${app}:${file}:${exportName}`;
  if (!cache.has(key)) cache.set(key, loadDocument(app, file, exportName));
  return cache.get(key)!;
}
```

```ts
// services/api/test/support/gql.ts
import request from "supertest";
import type { Server } from "node:http";

export type GqlResult<T = Record<string, unknown>> = {
  status: number;
  data: T | null;
  errors: { message: string; extensions: { code: string } }[];
};
// Behaves like an Enatega client: public-access handshake first, then bop-auth,
// nonce and (optionally) a user token on every request.
export class GqlClient {
  private publicToken: string | null = null;
  constructor(
    private readonly server: Server,
    private readonly nonce = `test-${Math.random().toString(16).slice(2)}`,
    public userToken: string | null = null,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}
  async metricsGeneral(nonce = this.nonce) {
    const response = await request(this.server)
      .post("/graphql")
      .set("nonce", nonce)
      .send({ query: "mutation MetricsGeneral { metricsGeneral { excellence topgun experience skydiver rider haha hehe huhu yoyo turu } }" });
    return response.body.data.metricsGeneral as { experience: string; hehe: string };
  }
  async raw(body: object, headers: Record<string, string>) {
    const response = await request(this.server).post("/graphql").set(headers).send(body);
    return { status: response.status, body: response.body };
  }
  withUser(token: string | null) {
    return new GqlClient(this.server, this.nonce, token, this.extraHeaders);
  }
  async query<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>): Promise<GqlResult<T>> {
    this.publicToken ??= (await this.metricsGeneral()).experience;
    const headers: Record<string, string> = {
      nonce: this.nonce,
      "bop-auth": `Bearer ${this.publicToken}`,
      authorization: this.userToken ? `Bearer ${this.userToken}` : "",
      ...this.extraHeaders,
    };
    const response = await request(this.server).post("/graphql").set(headers).send({ query, variables });
    return { status: response.status, data: response.body.data ?? null, errors: response.body.errors ?? [] };
  }
}
```

```ts
// services/api/test/support/ws.ts
import WebSocket from "ws";

// Minimal legacy subscriptions-transport-ws client: the protocol every Enatega app uses.
export async function legacySubscribe(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  connectionParams: Record<string, unknown> = { authorization: "" },
) {
  const socket = new WebSocket(url, "graphql-ws");
  const events: { type: string; id?: string; payload?: unknown }[] = [];
  const waiters: (() => void)[] = [];
  socket.on("message", (data) => {
    events.push(JSON.parse(String(data)));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("open", () => socket.send(JSON.stringify({ type: "connection_init", payload: connectionParams })));
    socket.on("error", reject);
    const check = () => (events.some((e) => e.type === "connection_ack") ? resolve() : waiters.push(check));
    waiters.push(check);
  });
  socket.send(JSON.stringify({ type: "start", id: "1", payload: { query, variables } }));
  return {
    // Resolves with the next `data` payload for this subscription, or rejects after timeoutMs.
    async next(timeoutMs = 3000) {
      const seen = events.filter((e) => e.id === "1").length;
      return new Promise<{ data?: Record<string, unknown>; errors?: unknown[] }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("No subscription event")), timeoutMs);
        const check = () => {
          const event = events.filter((e) => e.id === "1")[seen];
          if (!event) return waiters.push(check);
          clearTimeout(timer);
          if (event.type === "data") resolve(event.payload as never);
          else reject(Object.assign(new Error(event.type), { payload: event.payload }));
        };
        check();
      });
    },
    close() {
      socket.send(JSON.stringify({ type: "stop", id: "1" }));
      socket.close();
    },
  };
}
```

```ts
// services/api/test/support/app.ts
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config.js";
import { GqlClient } from "./gql.js";
import type { Stack } from "./stack.js";

export type Api = { app: INestApplication; http: GqlClient; wsUrl: string; close(): Promise<void> };
export async function startApi(stack: Stack, env: Record<string, string> = {}): Promise<Api> {
  const app = await createApp(
    readConfig({
      APP_ENV: "test",
      DATABASE_URL: stack.databaseUrl,
      REDIS_URL: stack.redisUrl,
      PASSWORD_AUTH_ENABLED: "true",
      ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64url"),
      REFRESH_TOKEN_PEPPER: Buffer.alloc(32, 2).toString("base64url"),
      ...env,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const server = app.getHttpServer() as Server;
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    app,
    http: new GqlClient(server),
    wsUrl: `ws://127.0.0.1:${port}/graphql`,
    close: () => app.close(),
  };
}
```

- [ ] **Step 1:** Write `clients.integration.spec.ts` asserting: `metricsGeneral` returns an ISO `hehe`; `GqlClient.query("{ _kernel }")` returns `NOT_IMPLEMENTED`; `doc("enatega-multivendor-admin", "lib/api/graphql/mutations/metrics/index.ts", "METRICS_GENERAL")` executes through `raw` with only a `nonce` header and returns 200.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Add the files above.
- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit `test(harness): add Enatega-like HTTP and legacy WebSocket clients`.

### Task C3: Coverage

**Files:**
- Modify: `services/api/package.json` — add devDependency `"@vitest/coverage-v8": "4.1.11"` and script `"coverage": "vitest run --config vitest.coverage.config.ts"`
- Create: `services/api/vitest.coverage.config.ts`
- Modify: root `package.json` — `"coverage": "pnpm --filter @fairbite/api coverage"`

```ts
// services/api/vitest.coverage.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    testTimeout: 60000,
    hookTimeout: 180000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/main.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        "src/kernel/**": { lines: 90, branches: 85, functions: 90, statements: 90 },
        "src/modules/**": { lines: 90, branches: 85, functions: 90, statements: 90 },
      },
    },
  },
});
```

- [ ] Install offline if possible (`pnpm install --offline`); otherwise record the registry blocker and leave the script in place.
- [ ] Run `pnpm coverage`; expect thresholds met for `src/kernel/**` (lanes add `src/modules/**` in Wave 2).
- [ ] Add `coverage/` to `services/api/.gitignore`.
- [ ] Commit `test(harness): enforce coverage thresholds for kernel and modules`.

### Task C4: Local stack

**Files:**
- Create: `infra/docker-compose.dev.yml`
- Modify: `tools/local-stack.py` (remove the dead app launch branches; keep api/worker)
- Modify: `package.json` (`"stack:up": "docker compose -f infra/docker-compose.dev.yml up -d --wait"`, `"stack:down": "docker compose -f infra/docker-compose.dev.yml down"`)

```yaml
# infra/docker-compose.dev.yml — local development only; never production.
name: fairbite-dev
services:
  postgres:
    image: postgis/postgis:17-3.5
    platform: linux/amd64
    environment:
      POSTGRES_USER: fairbite
      POSTGRES_PASSWORD: fairbite-dev-only
      POSTGRES_DB: fairbite
    ports: ["127.0.0.1:5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fairbite"]
      interval: 2s
      retries: 30
  redis:
    image: redis:7-alpine
    ports: ["127.0.0.1:6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      retries: 30
```

- [ ] Run `pnpm stack:up`, then `DATABASE_URL=postgresql://fairbite:fairbite-dev-only@127.0.0.1:5432/fairbite pnpm --filter @fairbite/api db:migrate`; expect all migrations applied.
- [ ] Commit `chore(infra): add local PostGIS and Redis stack`.

### Task C5: Playwright harness running the real admin and customer web apps

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `e2e/fixtures.ts`, `e2e/README.md`
- Modify: root `package.json` (`"e2e": "playwright test -c e2e/playwright.config.ts"`, `"e2e:smoke": "playwright test -c e2e/playwright.config.ts --grep @smoke"`, `"e2e:install-apps": "node e2e/install-apps.mjs"`)
- Create: `e2e/install-apps.mjs`

Facts (reference/01 §8): the Next apps use npm and their own lockfiles; `npm run dev` adds `--inspect`, so the harness runs `npx next dev` directly; the web app registers a service worker; ADMIN/WEB/APP load Microsoft Clarity and the web service worker initialises the upstream Firebase project.

`e2e/install-apps.mjs`: for `enatega-multivendor-admin` and `enatega-multivendor-web`, run `npm ci --no-audit --no-fund` in `vendor/enatega-ui/<app>` when `node_modules/.package-lock.json` is missing or older than `package-lock.json`. Never modifies tracked files (B1 makes the manifest ignore `node_modules`).

`e2e/global-setup.ts`:

1. Start Postgres and Redis with Testcontainers (reuse `services/api/test/support/stack.ts`), or use `E2E_DATABASE_URL`/`E2E_REDIS_URL` when set.
2. Run migrations, then `e2e/seed.ts` (Wave 1 adds the seed; in Wave 0 it inserts one active configuration version, as `configuration.integration.spec.ts` does).
3. Write the URLs to `e2e/.state.json` (gitignored) for the config's `webServer.env`.

`e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

const state = existsSync("e2e/.state.json") ? JSON.parse(readFileSync("e2e/.state.json", "utf8")) : {};
const api = "http://localhost:4100/";
const ws = "ws://localhost:4100/";
const appEnv = {
  NEXT_PUBLIC_SERVER_URL: api,
  NEXT_PUBLIC_WS_SERVER_URL: ws,
  NEXT_PUBLIC_VENDOR_MODE: "MULTI",
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: "",
};
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["json", { outputFile: "test-results/e2e.json" }]],
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // Upstream service workers initialise Enatega's Firebase project; never let them run.
    serviceWorkers: "block",
  },
  projects: [
    { name: "admin", testMatch: /admin\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3000" } },
    { name: "web", testMatch: /web\/.*\.spec\.ts/, use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3001" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @fairbite/api build && node services/api/dist/main.js",
      url: "http://localhost:4100/health/live",
      reuseExistingServer: !process.env.CI,
      env: {
        APP_ENV: "development",
        PORT: "4100",
        HOST: "127.0.0.1",
        DATABASE_URL: state.databaseUrl ?? "",
        REDIS_URL: state.redisUrl ?? "",
        CORS_ORIGINS: "http://localhost:3000,http://localhost:3001",
        PUBLIC_ACCESS_SECRET: Buffer.alloc(32, 11).toString("base64url"),
        PASSWORD_AUTH_ENABLED: "true",
        ACCESS_TOKEN_SECRET: Buffer.alloc(32, 12).toString("base64url"),
        REFRESH_TOKEN_PEPPER: Buffer.alloc(32, 13).toString("base64url"),
      },
    },
    {
      command: "npx next dev -p 3000",
      cwd: "vendor/enatega-ui/enatega-multivendor-admin",
      url: "http://localhost:3000",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: appEnv,
    },
    {
      command: "npx next dev --webpack -p 3001",
      cwd: "vendor/enatega-ui/enatega-multivendor-web",
      url: "http://localhost:3001",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: appEnv,
    },
  ],
});
```

`e2e/fixtures.ts` extends Playwright `test` with:

- `page` that aborts requests to `**/clarity.ms/**`, `**/*.clarity.ms/**`, `**/cdn.jsdelivr.net/npm/@emailjs/**`, `**/*.enatega.com/**`, `**/*.railway.app/**`, `**/*.netlify.app/**` and fails the test if any request to those hosts was attempted (`expect(blocked).toEqual([])` in teardown). This proves no upstream production backend is contacted.
- `graphqlLog`: records every request to `localhost:4100/graphql` with operation name, HTTP status and error codes, attached to the test report.
- `op(name)`: adds `@op:<name>` to the test title annotation for `check-operations`.

- [ ] Write `e2e/specs/admin/smoke.spec.ts`:

```ts
import { test, expect } from "../../fixtures.js";

test("@smoke admin login page loads against our API and completes the handshake @op:mutation.metricsGeneral", async ({ page, graphqlLog }) => {
  await page.goto("/authentication/login");
  await expect(page.locator("form")).toBeVisible();
  await expect.poll(() => graphqlLog.find((e) => e.operation === "MetricsGeneral")?.status).toBe(200);
});
```

- [ ] Write `e2e/specs/web/smoke.spec.ts` asserting the home page renders, `MetricsGeneral` returns 200, and the `configuration` request was sent to `localhost:4100` (its result is `NOT_IMPLEMENTED` or a configuration until L2 lands; the test asserts the request, not the data).
- [ ] Run `pnpm e2e:install-apps && pnpm e2e:smoke`. If the web app's requests to `http://localhost:4100` are blocked by its CSP (reference/01 §6.1), the browser console shows `Refused to connect`; do Task C7, then re-run.
- [ ] Commit `test(e2e): run the real Enatega admin and web apps against the API`.

### Task C6: Contract-level replays for the mobile apps

Expo apps cannot run under Playwright (reference/01 §8). Until the native gate (Wave 4), their behaviour is proven by replaying their exact documents through `GqlClient` and `legacySubscribe` with each app's headers.

**Files:**
- Create: `services/api/test/support/mobile.ts`

```ts
// services/api/test/support/mobile.ts
import type { Server } from "node:http";
import { GqlClient } from "./gql.js";

// Headers each mobile app sends (reference/01 §1.4–§1.6).
export const mobileHeaders = {
  app: { "x-platform": "android", "accept-language": "en-US", "user-agent": "EnategaApp/android" },
  store: { "x-platform": "android", "accept-language": "en", "user-agent": "Enatega-Store-App/android" },
  rider: { "x-platform": "android", "accept-language": "en", "user-agent": "Enatega-Rider-App/android" },
} as const;
export function mobileClient(server: Server, app: keyof typeof mobileHeaders) {
  return new GqlClient(server, `${app}-device-${Date.now().toString(36)}-0123456789abcdef`, null, mobileHeaders[app]);
}
```

- [ ] Write a test that the rider's `BackgroundPublicToken` document mints a token and the store client's JWT decodes with `atob` (once L1 issues tokens; until then assert the handshake only).
- [ ] Commit `test(harness): add mobile document replay clients`.

### Task C7: Recorded frontend configuration edits (only when proven necessary)

Each edit is allowed by AGENTS.md as configuration/transport. For each one: confirm the need (failing check), make the minimal edit, add an `allowedModifications` entry to the root `SOURCE_PROVENANCE.json` with `{ path, change, reason, wave }`, run `node tools/manifest-enatega-ui.mjs` to regenerate `vendor/enatega-ui/SOURCE_MANIFEST.json`, then run `pnpm check:enatega-ui-source`.

| # | File | Edit | Prove first | Wave |
|---|---|---|---|---|
| E1 | `vendor/enatega-ui/enatega-multivendor-web/next.config.mjs` | Add the origins of `NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_WS_SERVER_URL` to `connect-src`, and omit `upgrade-insecure-requests` when `NODE_ENV !== "production"` | `pnpm e2e:smoke` web project shows `Refused to connect` in the console | 0 |
| E2 | `vendor/enatega-ui/enatega-multivendor-app/environment.config.js:8-11,23-26,38-41` | Read `GRAPHQL_URL`, `WS_GRAPHQL_URL`, `SERVER_URL`, `SERVER_REST_URL` from `process.env.EXPO_PUBLIC_*`; throw at startup if missing; set `SERVER_URL` to the REST base (fixes the `graphqlpaypal` concatenation, reference/01 §5.2 P7) | literals point at `aws-server-v2.enatega.com` | 4 (native gate) |
| E3 | `vendor/enatega-ui/enatega-multivendor-store/environment.ts:10-11` | Same env reads | literals point at upstream | 4 |
| E4 | `vendor/enatega-ui/enatega-multivendor-rider/lib/utils/service/sentry.ts:7-16` | Initialise Sentry only when `configuration.riderAppSentryUrl` is set | hard-coded upstream DSN | 4 |
| E5 | Clarity in `enatega-multivendor-admin/app/layout.tsx`, `enatega-singlevendor-admin/app/layout.tsx`, `enatega-multivendor-web/app/layout.tsx`, `enatega-multivendor-app/App.js` | Render/initialise Clarity only when `NEXT_PUBLIC_CLARITY_PROJECT_ID` / `EXPO_PUBLIC_CLARITY_PROJECT_ID` is set, using that id | hard-coded upstream project ids | 4 |
| E6 | Firebase service workers (`enatega-multivendor-admin/public/firebase-messaging-sw.js`, `enatega-singlevendor-admin/public/firebase-messaging-sw.js`, `enatega-multivendor-web/public/serviceWorker.js`, `public/sw.js`) | Replace the hard-coded upstream config with `importScripts('/firebase-config.js')` served by the app from its own env; do nothing when absent | upstream Firebase project ids | 4 |
| E7 | `enatega-multivendor-app/app.config.js:236-239` | Expo `updates.url` and `extra.eas.projectId` from env; updates disabled when absent | upstream OTA project | 4 |

In Wave 0 only E1 is done (if proven). E2–E7 are done by L10 in Wave 4 Task R4 before any native or release build. Playwright blocks service workers and the listed hosts, so E5/E6 do not affect E2E.

- [ ] For E1: prove, edit, record, regenerate the manifest, run `pnpm check:enatega-ui-source` and `pnpm e2e:smoke`, commit `chore(L10): allow the web CSP to reach the configured API (recorded)`.

### Task C8: W0-C handoff

- [ ] Run `pnpm test:integration && pnpm coverage && pnpm e2e:smoke`.
- [ ] Report commands, results, files, blockers.

---

## Lead — integrate Wave 0 and pass G0

- [ ] Merge W0-A, then W0-B, then W0-C into `enatega-ui-backend`; resolve only mechanical conflicts.
- [ ] Run `pnpm verify --integration --coverage --e2e --record G0`.
- [ ] Request independent review (L11 QA, L13 security) of `kernel/**`, `tools/**`, `test/support/**`, `e2e/**`. Address findings.
- [ ] Commit `docs/GATES.json` with the G0 entry.
