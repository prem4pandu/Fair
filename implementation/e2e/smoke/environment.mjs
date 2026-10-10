/**
 * T-026A — explicit, deterministic child-process environments for the G0 smoke
 * harness (`pnpm e2e:smoke`, ROADMAP.md §7 → ROADMAP.json gates.G0).
 *
 * The harness spawns three children: the API build (`pnpm --filter @fairbite/api
 * build`), `prisma migrate deploy`, and the built API process itself. Before
 * this module existed the build child received `env: process.env` verbatim and
 * the other two received `{ ...process.env, ... }`, so whatever a developer had
 * exported in their shell (or sourced from a local `.env`) reached the run:
 * real `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_PEPPER`/`PUBLIC_ACCESS_SECRET`
 * values, a real `DATABASE_URL`/`REDIS_URL`, provider keys. The smoke result was
 * then a function of the developer's machine — the W24 residual "deterministic
 * smoke secrets".
 *
 * The rules enforced here:
 *
 *   1. `buildChildEnvironment` starts from a fixed allowlist of process
 *      plumbing — PATH/HOME/tmp/locale/toolchain caches. It never copies
 *      `process.env` as a whole and never copies anything that looks like
 *      secret material or a code-injection/credential vector.
 *   2. Every configuration and secret value a child needs is an explicit
 *      override. `smokeSecrets()` derives those values deterministically, so two
 *      runs in different shells produce the same API configuration, and
 *      `fingerprintDeterministicSecrets()` proves it (see A2 below).
 *   3. `assertNoInheritedSecrets` re-checks each constructed environment at run
 *      time and fails the run rather than letting a future edit silently reopen
 *      a vector.
 *
 * A1 — code-injection and credential vectors (review finding, commit 5353c9f).
 * The choice made here is both of the review's first two options, with the third
 * kept as a backstop, because the two vectors have different root causes:
 *
 *   - The Node flag and module-resolution names (`NODE_OPTIONS`, `NODE_PATH`,
 *     `NODE_EXTRA_CA_CERTS`) are NOT in the passthrough set. `NODE_OPTIONS` could
 *     execute attacker-chosen code inside every child
 *     (`--require`/`--import`/`--eval`/`--loader`), `NODE_PATH` can redirect
 *     module resolution, and `NODE_EXTRA_CA_CERTS` can replace the trust store.
 *     The harness controls its own children and needs none of them.
 *   - The container-runtime transport names (`DOCKER_HOST`, `DOCKER_CONTEXT`,
 *     `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`) are NOT in the passthrough set
 *     either: `DOCKER_HOST` can be `tcp://user:password@host` (credential-
 *     bearing) and `DOCKER_CERT_PATH` points at client credentials. No child the
 *     harness spawns talks to Docker — the harness starts its containers
 *     in-process — so the transport is dropped rather than sanitised.
 *   - `assertNoInheritedSecrets` additionally rejects, at run time, any value
 *     that still carries URL userinfo or Node injection flags, and any blocked
 *     name if a future edit puts it back on the passthrough list. Re-adding one
 *     cannot silently reopen the vector: the run fails naming the variable.
 *
 * `PATH` remains inherited, and is the one unavoidable vector: a child process
 * cannot be executed without a lookup path, and the toolchain (`node`, the
 * corepack/pnpm shim, `prisma`, `tsc`) is only findable through it. Executable
 * shadowing through a poisoned `PATH` is therefore not something value
 * inspection can catch; it is stated here so that boundary is explicit.
 *
 * A2 — what the fingerprint covers (review finding, commit 5353c9f).
 * `fingerprintDeterministicSecrets` hashes ONLY the three values
 * `smokeSecrets()` derives (`PUBLIC_ACCESS_SECRET`, `ACCESS_TOKEN_SECRET`,
 * `REFRESH_TOKEN_PEPPER`), with an explicit `<absent>` marker per name. It is
 * run-stable by construction and does not include the per-run ephemeral
 * testcontainers endpoints. Those are recorded separately, under a name that
 * says so, by `describeEphemeralContainerPlumbing` → `DATABASE_URL`/`REDIS_URL`
 * with URL credentials redacted.
 */
import { createHash } from "node:crypto";

/**
 * Names that may pass from the ambient environment into a child unchanged.
 * Everything else is dropped; configuration and secrets must be explicit
 * overrides. The list is intentionally small and reviewable, and holds only
 * values that cannot inject code or carry credentials (see the A1 note above).
 */
export const PASSTHROUGH_ENVIRONMENT_NAMES = Object.freeze(
  [
    // process plumbing
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TZ",
    "HOSTNAME",
    "CI",
    "NO_COLOR",
    "FORCE_COLOR",
    // package-manager and toolchain caches
    "PNPM_HOME",
    "COREPACK_HOME",
    "COREPACK_ENABLE_DOWNLOAD_PROMPT",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ].sort(),
);

/**
 * Ambient names the harness deliberately never inherits, with the reason. These
 * are reported by `scanAmbientHazards` even though they are not on the
 * passthrough list, so a run's log names every vector it excluded.
 */
export const BLOCKED_ENVIRONMENT_HAZARDS = Object.freeze({
  NODE_OPTIONS:
    "node flags can inject code into a child (--require/--import/--eval/--loader)",
  NODE_PATH: "node module-resolution path can redirect imports",
  NODE_EXTRA_CA_CERTS: "replaces the child's TLS trust store",
  DOCKER_HOST: "container transport URL can carry credentials (userinfo)",
  DOCKER_CONTEXT: "selects a container transport the harness does not control",
  DOCKER_TLS_VERIFY: "container transport TLS mode",
  DOCKER_CERT_PATH: "points at container client credentials",
});

/**
 * Names that are secret material even though they do not match the pattern
 * below. These are the harness's own connection strings; a run must never take
 * them from the ambient environment.
 *
 * The match is name-based and therefore deliberately conservative: it can
 * over-match a benign flag (for example `PASSWORD_AUTH_ENABLED`). Dropping such
 * a name from a child is harmless because every child that needs it receives an
 * explicit override, and the harness logs exactly which ambient names it
 * excluded so the exclusion is auditable rather than silent.
 */
export const SENSITIVE_ENVIRONMENT_NAMES = Object.freeze([
  "DATABASE_URL",
  "REDIS_URL",
]);

/** The values `smokeSecrets()` derives; the only input to the fingerprint. */
export const DETERMINISTIC_SECRET_NAMES = Object.freeze([
  "ACCESS_TOKEN_SECRET",
  "PUBLIC_ACCESS_SECRET",
  "REFRESH_TOKEN_PEPPER",
]);

/** Per-run testcontainers endpoints; recorded separately from the secrets. */
export const EPHEMERAL_PLUMBING_NAMES = Object.freeze([
  "DATABASE_URL",
  "REDIS_URL",
]);

const SENSITIVE_PATTERN =
  /(SECRET|PASSWORD|PASSWD|PASSPHRASE|PEPPER|TOKEN|CREDENTIAL|PRIVATE_KEY|API_?KEY|_KEY$)/i;

const NODE_INJECTION_PATTERN =
  /(^|\s)(--require|--import|--eval|--loader|--experimental-loader|--print|-r)(=|\s|$)/;

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** True when an environment variable name denotes secret material. */
export function isSensitiveEnvironmentName(name) {
  return (
    SENSITIVE_ENVIRONMENT_NAMES.includes(name) || SENSITIVE_PATTERN.test(name)
  );
}

/** True when a value would make Node execute or resolve attacker-chosen code. */
export function hasNodeInjectionFlags(value) {
  return typeof value === "string" && NODE_INJECTION_PATTERN.test(value);
}

/** The userinfo of a URL value, or null when there is none or it is not a URL. */
export function urlUserinfo(value) {
  if (typeof value !== "string" || !URL_SCHEME.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!url.username && !url.password) return null;
  return { username: url.username, password: url.password };
}

/** Replace URL credentials with a placeholder so a value can be recorded. */
export function redactCredentials(value) {
  if (typeof value !== "string") return value;
  const userinfo = urlUserinfo(value);
  if (!userinfo) return value;
  return value.replace(
    `${userinfo.username}:${userinfo.password}@`,
    "***:***@",
  );
}

/**
 * Why an ambient name/value pair must never reach a child, or null when it is
 * ordinary plumbing. Name-based for the blocked transports and flag variables,
 * value-based for credentials and injection flags anywhere.
 */
export function describeAmbientHazard(name, value) {
  if (BLOCKED_ENVIRONMENT_HAZARDS[name])
    return BLOCKED_ENVIRONMENT_HAZARDS[name];
  if (hasNodeInjectionFlags(value))
    return "value carries node code-injection flags (--require/--import/--eval/--loader)";
  if (urlUserinfo(value)) return "value carries URL credentials (userinfo)";
  return null;
}

/**
 * The ambient variables that must never reach a child, sorted. The harness logs
 * this list on every run, so a poisoned-environment acceptance run shows exactly
 * which names were excluded.
 */
export function scanAmbientSecrets(ambient = process.env) {
  return Object.keys(ambient ?? {})
    .filter(isSensitiveEnvironmentName)
    .sort();
}

/**
 * The ambient names that can inject code or carry credentials, sorted, each with
 * the reason it was excluded — whether or not the name is on the passthrough
 * list. Reported on every run so the exclusion is auditable.
 */
export function scanAmbientHazards(ambient = process.env) {
  return Object.keys(ambient ?? {})
    .map((name) => ({
      name,
      reason: describeAmbientHazard(name, ambient[name]),
    }))
    .filter((hazard) => hazard.reason)
    .sort((left, right) => (left.name < right.name ? -1 : 1));
}

/**
 * Build the complete environment for one child process.
 *
 * @param {Record<string, string | undefined>} ambient the parent environment
 * @param {Record<string, string | number | undefined>} overrides explicit
 *   values for this child; these are the only source of child configuration
 * @returns {Record<string, string>} sorted, deterministic environment
 */
export function buildChildEnvironment(ambient, overrides = {}) {
  const env = {};
  for (const name of PASSTHROUGH_ENVIRONMENT_NAMES) {
    const value = ambient?.[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    if (name.length === 0 || name.includes("=") || name.includes("\0"))
      throw new Error(`Invalid environment variable name: ${name}`);
    env[name] = String(value);
  }
  return Object.fromEntries(
    Object.entries(env).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

/**
 * Fail closed if a constructed child environment carries ambient material it
 * must not: a secret-looking value the harness did not set itself, a
 * credential-bearing value, a Node code-injection flag, or a blocked
 * transport/flag name. `overrides` is the set of values the harness set itself,
 * so a value the harness chose (for example a testcontainers connection string)
 * is not a leak.
 */
export function assertNoInheritedSecrets(ambient, env, overrides = {}) {
  const leaks = [];
  for (const [name, value] of Object.entries(env)) {
    const fromAmbient =
      ambient?.[name] !== undefined &&
      env[name] === ambient[name] &&
      overrides[name] !== env[name];
    if (!fromAmbient) continue;
    if (isSensitiveEnvironmentName(name)) leaks.push(`${name} (secret-named)`);
    else {
      const reason = describeAmbientHazard(name, value);
      if (reason) leaks.push(`${name} (${reason})`);
    }
  }
  if (leaks.length > 0)
    throw new Error(
      `Child environment inherits ambient material that must not reach a child: ${leaks.sort().join(", ")}`,
    );
  return env;
}

/**
 * The deterministic secret set every smoke child is configured with. Derived
 * from fixed bytes, canonical base64url, 32 bytes each, distinct from one
 * another — never read from the ambient environment.
 */
export function smokeSecrets() {
  const key = (fill) => Buffer.alloc(32, fill).toString("base64url");
  return {
    publicAccessSecret: key(7),
    accessTokenSecret: key(1),
    refreshPepper: key(2),
  };
}

/**
 * A short, stable digest of the deterministic secret material a child received
 * (exactly `DETERMINISTIC_SECRET_NAMES`), including an explicit `<absent>`
 * marker for every name the child did not receive. Run-stable: it does not
 * include per-run container endpoints, so two consecutive runs — and a normal
 * versus poisoned run — produce the same digest for the same configuration.
 * Per-run endpoints are recorded by `describeEphemeralContainerPlumbing`.
 */
export function fingerprintDeterministicSecrets(env) {
  const canonical = [...DETERMINISTIC_SECRET_NAMES]
    .sort()
    .map((name) => `${name}=${env?.[name] ?? "<absent>"}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * The per-run ephemeral endpoints a child received (testcontainers picks a new
 * host port on every run), with URL credentials redacted. Deliberately NOT part
 * of the secret fingerprint: these values are expected to differ between runs.
 */
export function describeEphemeralContainerPlumbing(env) {
  const plumbing = {};
  for (const name of EPHEMERAL_PLUMBING_NAMES)
    if (env?.[name] !== undefined)
      plumbing[name] = redactCredentials(env[name]);
  return plumbing;
}

/** Names only, sorted — safe to record for a whole child environment. */
export function describeEnvironment(env) {
  return Object.keys(env).sort();
}
