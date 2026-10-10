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
 * then a function of the developer's machine, which is exactly the W24 residual
 * "deterministic smoke secrets".
 *
 * The rule enforced here:
 *
 *   1. `buildChildEnvironment` starts from a fixed allowlist of process
 *      plumbing — PATH/HOME/tmp/locale/Node/Docker transport. It never copies
 *      `process.env` as a whole and never copies anything that looks like
 *      secret material.
 *   2. Every configuration and secret value a child needs is an explicit
 *      override. `smokeSecrets()` derives those values deterministically, so
 *      two runs in different shells produce the same API configuration.
 *   3. `assertNoInheritedSecrets` re-checks each constructed environment at run
 *      time: a child may only see a secret-named variable when the harness put
 *      it there itself. A future edit that reintroduces inheritance fails the
 *      smoke run instead of silently making it non-reproducible.
 *
 * Ambient proxy and npm-registry configuration is deliberately NOT inherited: a
 * proxy URL or `npm_config_*` value can carry credentials, and the harness only
 * talks to 127.0.0.1 and the local Docker socket. An environment that needs a
 * proxy must pass it explicitly.
 */
import { createHash } from "node:crypto";

/**
 * Names that may pass from the ambient environment into a child unchanged.
 * Everything else is dropped; configuration and secrets must be explicit
 * overrides. This list is intentionally small and reviewable.
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
    // node runtime plumbing
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "NODE_PATH",
    // package-manager and toolchain caches
    "PNPM_HOME",
    "COREPACK_HOME",
    "COREPACK_ENABLE_DOWNLOAD_PROMPT",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    // container-runtime plumbing (how the host reaches the Docker daemon)
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ].sort(),
);

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

const SENSITIVE_PATTERN =
  /(SECRET|PASSWORD|PASSWD|PASSPHRASE|PEPPER|TOKEN|CREDENTIAL|PRIVATE_KEY|API_?KEY|_KEY$)/i;

/** True when an environment variable name denotes secret material. */
export function isSensitiveEnvironmentName(name) {
  return (
    SENSITIVE_ENVIRONMENT_NAMES.includes(name) || SENSITIVE_PATTERN.test(name)
  );
}

/**
 * The ambient variables that must never reach a child, sorted. The harness logs
 * this list on every run, so the poisoned-environment acceptance run shows
 * exactly which names were excluded.
 */
export function scanAmbientSecrets(ambient = process.env) {
  return Object.keys(ambient ?? {})
    .filter(isSensitiveEnvironmentName)
    .sort();
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
 * Fail closed if a constructed child environment still carries secret material
 * straight from the parent. `overrides` is the set of values the harness set
 * itself; a sensitive variable is a leak when its value is still the ambient
 * one and the harness did not place it there.
 */
export function assertNoInheritedSecrets(ambient, env, overrides = {}) {
  const leaks = Object.keys(env).filter(
    (name) =>
      isSensitiveEnvironmentName(name) &&
      ambient?.[name] !== undefined &&
      env[name] === ambient[name] &&
      overrides[name] !== env[name],
  );
  if (leaks.length > 0)
    throw new Error(
      `Child environment inherits ambient secret material: ${leaks.sort().join(", ")}`,
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
 * A short, stable digest of the deterministic secret configuration a child
 * received, so the artifact can show that the normal and poisoned runs
 * configured the API identically without printing a value twice.
 */
export function fingerprintSecrets(env) {
  const canonical = Object.entries(env)
    .filter(([name]) => isSensitiveEnvironmentName(name))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Names only, sorted — safe to record for a whole child environment. */
export function describeEnvironment(env) {
  return Object.keys(env).sort();
}
