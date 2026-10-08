// Shared operation state for the generated status artifacts.
//
// One source of truth for "which root operations exist, which have a real
// resolver, where they are declared, and what evidence is recorded". Both
// tools/generate-operation-traceability.mjs and
// tools/generate-implementation-status.mjs consume this, so the two generated
// documents can never disagree about the same facts.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LANE_NAMES = {
  L0: "Platform kernel",
  L1: "Identity & sessions",
  L2: "Platform configuration",
  L3: "Vendors, catalog & discovery",
  L4: "Customers, addresses & support",
  L5: "Orders, pricing & lifecycle",
  L6: "Dispatch, riders & tracking",
  L7: "Finance & payments",
  L8: "Notifications & messaging",
  L9: "Analytics",
  L12: "Single-vendor (gated)",
};

export const LANE_PLANS = {
  L0: "01-wave0-foundation.md",
  L1: "10-lane-L1-identity.md",
  L2: "11-lane-L2-configuration.md",
  L3: "12-lane-L3-catalog.md",
  L4: "13-lane-L4-discovery.md",
  L5: "14-lane-L5-orders.PARTIAL.md",
  L6: "15-lane-L6-dispatch.PARTIAL.md",
  L7: "16-lane-L7-finance.PARTIAL.md",
  L8: "17-lane-L8-notifications.PARTIAL.md",
  L9: "18-lane-L9-analytics.md",
  L12: "22-wave5-single-vendor.PARTIAL.md",
};

export const defaultImplementation = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function walk(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === "node_modules" || entry.name === "generated"
          ? []
          : walk(path, extensions);
      return entry.isFile() && extensions.includes(entry.name.split(".").pop())
        ? [path]
        : [];
    });
}

/**
 * Root fields that have a real resolver. Everything else is filled by
 * kernel/not-implemented.ts and fails with NOT_IMPLEMENTED.
 */
export function implementedRoots({
  implementation = defaultImplementation,
} = {}) {
  const found = new Set();
  const pattern = /@(Query|Mutation|Subscription)\(\s*"([A-Za-z0-9_]+)"\s*\)/g;
  for (const path of walk(resolve(implementation, "services/api/src"), [
    "ts",
  ])) {
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(pattern))
      found.add(`${match[1].toLowerCase()}.${match[2]}`);
  }
  return found;
}

/**
 * Which SDL file declares each root field. L12 and kernel files are included:
 * this records where a root is declared, not whether the multivendor runtime
 * serves it.
 */
export function sdlHomes({ implementation = defaultImplementation } = {}) {
  const contracts = resolve(implementation, "contracts/enatega");
  const homes = new Map();
  for (const file of readdirSync(contracts).sort()) {
    if (!file.endsWith(".graphql")) continue;
    const text = readFileSync(resolve(contracts, file), "utf8");
    const block =
      /(?:^|\n)(?:extend\s+)?type\s+(Query|Mutation|Subscription)\s*\{([\s\S]*?)\n\}/g;
    for (const match of text.matchAll(block)) {
      const kind = match[1].toLowerCase();
      for (const line of match[2].split("\n")) {
        const field = /^ {2}([A-Za-z0-9_]+)\s*[(:]/.exec(line);
        if (field) homes.set(`${kind}.${field[1]}`, file);
      }
    }
  }
  return homes;
}

/** Recorded per-operation evidence status from docs/OPERATION_TEST_EVIDENCE.json. */
export function evidenceIndex({ implementation = defaultImplementation } = {}) {
  const records =
    JSON.parse(
      readFileSync(
        resolve(implementation, "docs/OPERATION_TEST_EVIDENCE.json"),
        "utf8",
      ),
    ).records ?? [];
  const index = new Map();
  for (const record of records)
    index.set(
      `${String(record.type).toLowerCase()}.${record.name}`,
      record.status ?? "UNVERIFIED",
    );
  return index;
}

/** Full operation state used by the generated artifacts. */
export function loadOperationState({
  implementation = defaultImplementation,
} = {}) {
  const load = (name) =>
    JSON.parse(readFileSync(resolve(implementation, "docs", name), "utf8"));
  const lanes = load("OPERATION_LANES.json");
  const compatibility = load("ENATEGA_COMPATIBILITY_REPORT.json");
  const implemented = implementedRoots({ implementation });
  const homes = sdlHomes({ implementation });
  const evidence = evidenceIndex({ implementation });

  const rows = lanes.operations
    .map((operation) => {
      const key = `${String(operation.type).toLowerCase()}.${operation.name}`;
      return {
        key,
        lane: operation.lane,
        wave: operation.wave,
        kind: String(operation.type).toLowerCase(),
        name: operation.name,
        apps: (operation.multivendorApps ?? []).join(", ") || "—",
        resolver: implemented.has(key) ? "IMPLEMENTED" : "NOT_IMPLEMENTED",
        sdl: homes.get(key) ?? "MISSING",
        evidence: evidence.get(key) ?? "UNRECORDED",
      };
    })
    .sort(
      (a, b) =>
        Number(a.lane.slice(1)) - Number(b.lane.slice(1)) ||
        a.kind.localeCompare(b.kind, "en") ||
        a.name.localeCompare(b.name, "en"),
    );

  const laneSummary = Object.entries(LANE_NAMES)
    .map(([lane, name]) => {
      const laneRows = rows.filter((row) => row.lane === lane);
      const done = laneRows.filter(
        (row) => row.resolver === "IMPLEMENTED",
      ).length;
      return {
        lane,
        name,
        count: laneRows.length,
        done,
        missing: laneRows.length - done,
      };
    })
    .sort((a, b) => Number(a.lane.slice(1)) - Number(b.lane.slice(1)));

  // Counts come from the operations array; the lanes file's own perLane map is
  // cross-checked so a stale or hand-edited file is reported, not propagated.
  const laneDrift = laneSummary.filter(
    (lane) => lanes.perLane?.[lane.lane] !== lane.count,
  );

  const totals = {
    operations: rows.length,
    implemented: rows.filter((row) => row.resolver === "IMPLEMENTED").length,
    evidenced: rows.filter((row) => row.evidence === "VERIFIED").length,
    withoutSdl: rows.filter((row) => row.sdl === "MISSING").length,
    query: rows.filter((row) => row.kind === "query").length,
    mutation: rows.filter((row) => row.kind === "mutation").length,
    subscription: rows.filter((row) => row.kind === "subscription").length,
  };

  return { lanes, compatibility, rows, laneSummary, laneDrift, totals };
}
