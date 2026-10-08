#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import prettier from "prettier";
import { loadOperationState } from "./lib/operation-state.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "docs/IMPLEMENTATION_STATUS.html");
const jsonTarget = resolve(root, "docs/IMPLEMENTATION_STATUS.json");
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const badge = (state) =>
  `<span class="badge ${state.toLowerCase().replace(" ", "-")}">${state}</span>`;

// Operation facts come from the shared state module so this report and the
// traceability matrix can never disagree about the same numbers.
const { compatibility, fullCompatibility, lanes, laneSummary, totals } =
  loadOperationState({
    implementation: root,
  });
const verified = totals.evidenced;
const fullInvalidDocuments = fullCompatibility.apps.reduce(
  (count, app) =>
    count +
    app.documents.filter((document) => document.status === "INVALID").length,
  0,
);
// Gate results come from the recorded registry, never from hand-maintained
// numbers: a report may only claim what a recorded command actually proved.
const gatesFile = resolve(root, "docs/GATES.json");
const registry = existsSync(gatesFile)
  ? JSON.parse(readFileSync(gatesFile, "utf8"))
  : null;
const gateRuns = Object.values(registry?.gates ?? {})
  .map((entry) => ({ id: entry.gate, ...(entry.latest ?? {}) }))
  .filter((entry) => entry.finishedAt);
const passedGates = gateRuns.filter((entry) => entry.passed).length;
const latestRun = [...gateRuns].sort((a, b) =>
  String(b.finishedAt).localeCompare(String(a.finishedAt)),
)[0];
const gateSummary = gateRuns.length
  ? `Latest recorded gate run: <code>${escape(latestRun.id)}</code> ` +
    `${latestRun.passed ? "PASSED" : "FAILED"} at ${escape(latestRun.finishedAt)} ` +
    `on commit <code>${escape(String(latestRun.commit ?? "unknown").slice(0, 12))}</code> ` +
    `(${latestRun.commands.filter((command) => command.exitCode === 0).length}/${latestRun.commands.length} commands exit 0). ` +
    `Independent gate approvals remain pending. Full command output: <code>docs/GATES.json</code>.`
  : "No gate run is recorded yet; run <code>node tools/record-gate.mjs --gate GP0</code> and commit <code>docs/GATES.json</code>.";
const laneNames = {
  L0: "Transport foundation",
  L1: "Identity",
  L2: "Platform configuration",
  L3: "Vendors and catalog",
  L4: "Customers and support",
  L5: "Orders",
  L6: "Dispatch and realtime",
  L7: "Finance",
  L8: "Notifications",
  L9: "Analytics",
  L12: "Single-vendor mode",
};
const laneRows = laneSummary
  .map((lane) => {
    const blocked = lane.lane === "L12";
    const note = blocked
      ? "Gated until Wave 5; schema presence is not runtime implementation."
      : lane.lane === "L0"
        ? "Kernel checkpoints exist; formal G0 evidence and approval remain open."
        : "SDL is present; behavior and required E2E evidence are incomplete.";
    return `<tr><th scope="row">${lane.lane}</th><td>${laneNames[lane.lane]}</td><td>${lane.count}</td><td>${lane.done} with resolvers</td><td>${badge(blocked ? "BLOCKED" : "IN PROGRESS")}</td><td>${note}</td></tr>`;
  })
  .join("");
const phase = (wave, scope, state, gap) =>
  `<tr><th scope="row">${wave}</th><td>${scope}</td><td>${badge(state)}</td><td>${gap}</td></tr>`;
const raw = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FairBite implementation status</title><style>
:root{color-scheme:dark;--bg:#09110f;--panel:#111d19;--line:#294038;--text:#edf7f2;--muted:#a8beb4;--green:#65d6a6;--amber:#ffc966;--red:#ff8a85;--blue:#79bfff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px 20px 80px}header,.card,details{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}header{padding:28px;background:linear-gradient(135deg,#162b24,#0d1714)}h1{font-size:clamp(2rem,5vw,4.2rem);line-height:1}.eyebrow{color:var(--green);font-weight:800;text-transform:uppercase;letter-spacing:.12em}.lead,.note,caption{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:22px 0}.value{font-size:1.8rem;font-weight:800}.badge{display:inline-block;border-radius:99px;padding:.18rem .62rem;font-size:.78rem;font-weight:800}.in-progress{color:var(--amber);background:#40351b}.blocked{color:var(--red);background:#472525}.complete{color:var(--green);background:#163c30}.table{overflow:auto;border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:12px}thead th,.eyebrow{color:var(--green)}caption{text-align:left;padding:8px}code,a{color:var(--blue)}.callout{border-left:4px solid var(--amber);padding:14px;background:#241f13}:focus-visible{outline:3px solid var(--blue)}@media(max-width:650px){main{padding:18px 12px}th,td{padding:9px;font-size:.9rem}}
</style></head><body><main><header><div class="eyebrow">Evidence-based project report</div><h1>FairBite implementation status</h1><p class="lead">The original pinned Enatega presentation is the product UI. FairBite owns its backend and integration layer.</p><p>${badge("IN PROGRESS")} No release gate is recorded as passed.</p></header>
<section><h2>Current snapshot</h2><div class="grid"><article class="card"><div class="value">${compatibility.summary.validDocuments}/${compatibility.summary.documents}</div><div>scoped multivendor documents valid</div></article><article class="card"><div class="value">${lanes.total}</div><div>inventoried root operations</div></article><article class="card"><div class="value">${verified}/${lanes.total}</div><div>operations marked verified</div></article><article class="card"><div class="value">${passedGates}</div><div>complete gate command runs passed</div></article></div><p class="callout"><strong>Scoped multivendor compatibility ${compatibility.staticCompatibility}</strong> does not prove resolver behavior, authorization, runtime reachability, subscriptions, UI parity, or E2E journeys.</p><p class="callout"><strong>Full six-app compatibility ${fullCompatibility.staticCompatibility}</strong>: ${fullCompatibility.summary.validDocuments}/${fullCompatibility.summary.documents} documents valid, ${fullInvalidDocuments} invalid, ${fullCompatibility.summary.unresolvedDocuments} unresolved. The scoped PASS does not satisfy the W2 full-mode gate.</p><p class="note">${gateSummary} Test counts and per-command exits are recorded there rather than restated here.</p></section>
<section><h2>Phase status</h2><div class="table"><table><caption>Status requires implementation, checks, and independent approval.</caption><thead><tr><th>Wave</th><th>Scope</th><th>Status</th><th>Evidence gap</th></tr></thead><tbody>${phase("0", "Foundation", "IN PROGRESS", "Aggregate G0 evidence and approval are open.")}${phase("1", "Contract and data model", "IN PROGRESS", "Forward migrations exist; formal G1 evidence and approval remain open.")}${phase("2", "L1–L9 domains", "IN PROGRESS", "Identity, configuration, catalog, addresses, and order-domain slices exist; most operation behavior and per-operation tests remain incomplete.")}${phase("3", "Journeys and application E2E", "BLOCKED", "Depends on completed domain operations.")}${phase("4", "Hardening and release", "BLOCKED", "Providers, devices, security, load, restore, and approvals remain.")}${phase("5", "Single-vendor L12", "BLOCKED", "Separate gated product mode.")}</tbody></table></div></section>
<section><h2>Backend lane matrix</h2><div class="table"><table><caption>Counts from OPERATION_LANES.json.</caption><thead><tr><th>Lane</th><th>Module</th><th>Roots</th><th>Implemented</th><th>Status</th><th>Assessment</th></tr></thead><tbody>${laneRows}</tbody></table></div></section>
<section><h2>Enatega UI/backend alignment</h2><p>The complete pinned UI is <code>vendor/enatega-ui</code>. Screens, navigation, assets, and interactions remain Enatega’s; the backend must match its GraphQL, REST, WebSocket, and public-access contracts.</p><div class="grid"><article class="card"><h3>Admin web</h3><p>Original Enatega admin.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Customer web/mobile</h3><p>Original Enatega clients.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Store and rider</h3><p>Original Enatega mobile clients.</p>${badge("IN PROGRESS")}</article></div></section>
<section><h2>Configurable launch model</h2><div class="grid"><article class="card"><h3>Initial market</h3><p>Malaysia, MYR, own fleet first. These are selections, not hard-coded product limits.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Configuration</h3><p>Country, currency precision, fleets, payments, fees, taxes, and refund rules require server-owned configuration.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Providers</h3><p>Real payment, maps, media, email, SMS, and push readiness depends on sandbox credentials and verified adapters.</p>${badge("BLOCKED")}</article></div></section>
<section><h2>Evidence and blockers</h2><details open><summary>Current evidence</summary><ul><li>${compatibility.summary.validDocuments} valid static documents; ${compatibility.summary.unresolvedDocuments} unresolved; ${compatibility.summary.missingRoots.length} missing roots.</li><li>${verified} operations marked VERIFIED in the operation evidence registry.</li><li>${escape(gateSummary.replaceAll("<code>", "").replaceAll("</code>", ""))}</li></ul></details><ul><li>Behavioral implementation and tagged integration evidence for all multivendor roots.</li><li>Real-stack customer, store, rider, and admin journeys using original Enatega apps.</li><li>Provider credentials; native device runs; QA, security, load, restore, dependency, and release approvals.</li></ul><p class="note">Historical replacement-shell results are not proof of current Enatega E2E acceptance.</p></section>
<footer><p class="note">Generated by <code>node tools/generate-implementation-status.mjs</code>. Use <code>--check</code> to detect drift.</p></footer></main></body></html>`;
const html = await prettier.format(raw, { parser: "html" });

// Machine-readable twin of the HTML, built from the same values so the two can
// never disagree. Every number here is derived from a repository artifact or a
// recorded gate run; nothing is hand-maintained.
const status = {
  schemaVersion: 1,
  generatedBy: "tools/generate-implementation-status.mjs",
  authority: "docs/MASTER_END_TO_END_PLAN.md",
  overall: "IN_PROGRESS",
  // Release approval is an owner decision and is never derived from code.
  release: "NOT_APPROVED",
  operations: {
    total: totals.operations,
    withRealResolvers: totals.implemented,
    withRecordedEvidence: totals.evidenced,
    withoutSdlDeclaration: totals.withoutSdl,
    byKind: {
      query: totals.query,
      mutation: totals.mutation,
      subscription: totals.subscription,
    },
  },
  staticCompatibility: {
    status: compatibility.staticCompatibility,
    documents: compatibility.summary.documents,
    validDocuments: compatibility.summary.validDocuments,
    unresolvedDocuments: compatibility.summary.unresolvedDocuments,
    missingRoots: compatibility.summary.missingRoots.length,
  },
  fullStaticCompatibility: {
    status: fullCompatibility.staticCompatibility,
    apps: fullCompatibility.summary.apps,
    documents: fullCompatibility.summary.documents,
    validDocuments: fullCompatibility.summary.validDocuments,
    invalidDocuments: fullInvalidDocuments,
    unresolvedDocuments: fullCompatibility.summary.unresolvedDocuments,
    missingRoots: fullCompatibility.summary.missingRoots.length,
  },
  lanes: Object.fromEntries(
    laneSummary.map((lane) => [
      lane.lane,
      { name: lane.name, roots: lane.count, withRealResolvers: lane.done },
    ]),
  ),
  gates: gateRuns
    .map((run) => ({
      id: run.id,
      passed: Boolean(run.passed),
      finishedAt: run.finishedAt ?? null,
      commit: run.commit ?? null,
      approvals: run.approvals ?? [],
      commands: (run.commands ?? []).map(({ command, exitCode }) => ({
        command,
        exitCode,
      })),
    }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  recordedGateRuns: gateRuns.length,
  approvedGates: 0,
  notes: [
    "A resolving schema is not implementation: NOT_IMPLEMENTED roots are counted as unimplemented.",
    "No gate is approved until an independent reviewer is recorded in docs/GATES.json.",
    "Static compatibility does not prove resolver behavior, authorization, runtime reachability or UI parity.",
  ],
};
const json = `${JSON.stringify(status, null, 2)}\n`;

const staleness = [];
if (readFileSync(target, "utf8") !== html) staleness.push("HTML");
if (!existsSync(jsonTarget) || readFileSync(jsonTarget, "utf8") !== json)
  staleness.push("JSON");

if (process.argv.includes("--stdout")) process.stdout.write(html);
else if (process.argv.includes("--check")) {
  if (staleness.length) {
    console.error(
      `implementation status is stale (${staleness.join(", ")}); regenerate with node tools/generate-implementation-status.mjs`,
    );
    process.exit(1);
  }
  console.log("Implementation status HTML and JSON are current");
} else {
  writeFileSync(target, html);
  writeFileSync(jsonTarget, json);
  console.log(`Wrote ${target} and ${jsonTarget}`);
}
