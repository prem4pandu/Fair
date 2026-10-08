#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import prettier from "prettier";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "docs/IMPLEMENTATION_STATUS.html");
const load = (file) =>
  JSON.parse(readFileSync(resolve(root, "docs", file), "utf8"));
const compatibility = load("ENATEGA_COMPATIBILITY_REPORT.json");
const lanes = load("OPERATION_LANES.json");
const evidence = load("OPERATION_TEST_EVIDENCE.json");
const operations = evidence.operations ?? evidence;
const verified = Array.isArray(operations)
  ? operations.filter(({ status }) => status === "VERIFIED").length
  : 0;
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const badge = (state) =>
  `<span class="badge ${state.toLowerCase().replace(" ", "-")}">${state}</span>`;
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
const laneRows = Object.entries(lanes.perLane)
  .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
  .map(([lane, count]) => {
    const blocked = lane === "L12";
    const note = blocked
      ? "Gated until Wave 5; schema presence is not runtime implementation."
      : lane === "L0"
        ? "Kernel checkpoints exist; formal G0 evidence and approval remain open."
        : "SDL is present; behavior and required E2E evidence are incomplete.";
    return `<tr><th scope="row">${lane}</th><td>${laneNames[lane]}</td><td>${count}</td><td>${badge(blocked ? "BLOCKED" : "IN PROGRESS")}</td><td>${note}</td></tr>`;
  })
  .join("");
const commits = execFileSync("git", ["log", "-8", "--pretty=format:%h%x09%s"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .map((line) => {
    const [hash, subject] = line.split("\t");
    return `<li><code>${escape(hash)}</code> ${escape(subject)}</li>`;
  })
  .join("");
const phase = (wave, scope, state, gap) =>
  `<tr><th scope="row">${wave}</th><td>${scope}</td><td>${badge(state)}</td><td>${gap}</td></tr>`;
const raw = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FairBite implementation status</title><style>
:root{color-scheme:dark;--bg:#09110f;--panel:#111d19;--line:#294038;--text:#edf7f2;--muted:#a8beb4;--green:#65d6a6;--amber:#ffc966;--red:#ff8a85;--blue:#79bfff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px 20px 80px}header,.card,details{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}header{padding:28px;background:linear-gradient(135deg,#162b24,#0d1714)}h1{font-size:clamp(2rem,5vw,4.2rem);line-height:1}.eyebrow{color:var(--green);font-weight:800;text-transform:uppercase;letter-spacing:.12em}.lead,.note,caption{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:22px 0}.value{font-size:1.8rem;font-weight:800}.badge{display:inline-block;border-radius:99px;padding:.18rem .62rem;font-size:.78rem;font-weight:800}.in-progress{color:var(--amber);background:#40351b}.blocked{color:var(--red);background:#472525}.complete{color:var(--green);background:#163c30}.table{overflow:auto;border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:12px}thead th,.eyebrow{color:var(--green)}caption{text-align:left;padding:8px}code,a{color:var(--blue)}.callout{border-left:4px solid var(--amber);padding:14px;background:#241f13}:focus-visible{outline:3px solid var(--blue)}@media(max-width:650px){main{padding:18px 12px}th,td{padding:9px;font-size:.9rem}}
</style></head><body><main><header><div class="eyebrow">Evidence-based project report</div><h1>FairBite implementation status</h1><p class="lead">The original pinned Enatega presentation is the product UI. FairBite owns its backend and integration layer.</p><p>${badge("IN PROGRESS")} No release gate is recorded as passed.</p></header>
<section><h2>Current snapshot</h2><div class="grid"><article class="card"><div class="value">${compatibility.summary.validDocuments}/${compatibility.summary.documents}</div><div>static GraphQL documents valid</div></article><article class="card"><div class="value">${lanes.total}</div><div>inventoried root operations</div></article><article class="card"><div class="value">${verified}/${Array.isArray(operations) ? operations.length : lanes.total}</div><div>operations marked verified</div></article><article class="card"><div class="value">0</div><div>formal gates recorded passed</div></article></div><p class="callout"><strong>Static compatibility ${compatibility.staticCompatibility}</strong> does not prove resolver behavior, authorization, runtime reachability, subscriptions, UI parity, or E2E journeys.</p></section>
<section><h2>Phase status</h2><div class="table"><table><caption>Status requires implementation, checks, and independent approval.</caption><thead><tr><th>Wave</th><th>Scope</th><th>Status</th><th>Evidence gap</th></tr></thead><tbody>${phase("0", "Foundation", "IN PROGRESS", "Aggregate G0 evidence and approval are open.")}${phase("1", "Contract and data model", "IN PROGRESS", "Upgrade migration and formal G1 record remain open.")}${phase("2", "L1–L9 domains", "IN PROGRESS", "Operation behavior and per-operation tests remain incomplete.")}${phase("3", "Journeys and application E2E", "BLOCKED", "Depends on completed domain operations.")}${phase("4", "Hardening and release", "BLOCKED", "Providers, devices, security, load, restore, and approvals remain.")}${phase("5", "Single-vendor L12", "BLOCKED", "Separate gated product mode.")}</tbody></table></div></section>
<section><h2>Backend lane matrix</h2><div class="table"><table><caption>Counts from OPERATION_LANES.json.</caption><thead><tr><th>Lane</th><th>Module</th><th>Roots</th><th>Status</th><th>Assessment</th></tr></thead><tbody>${laneRows}</tbody></table></div></section>
<section><h2>Enatega UI/backend alignment</h2><p>The complete pinned UI is <code>vendor/enatega-ui</code>. Screens, navigation, assets, and interactions remain Enatega’s; the backend must match its GraphQL, REST, WebSocket, and public-access contracts.</p><div class="grid"><article class="card"><h3>Admin web</h3><p>Original Enatega admin.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Customer web/mobile</h3><p>Original Enatega clients.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Store and rider</h3><p>Original Enatega mobile clients.</p>${badge("IN PROGRESS")}</article></div></section>
<section><h2>Configurable launch model</h2><div class="grid"><article class="card"><h3>Initial market</h3><p>Malaysia, MYR, own fleet first. These are selections, not hard-coded product limits.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Configuration</h3><p>Country, currency precision, fleets, payments, fees, taxes, and refund rules require server-owned configuration.</p>${badge("IN PROGRESS")}</article><article class="card"><h3>Providers</h3><p>Real payment, maps, media, email, SMS, and push readiness depends on sandbox credentials and verified adapters.</p>${badge("BLOCKED")}</article></div></section>
<section><h2>Evidence and blockers</h2><details open><summary>Current evidence</summary><ul><li>${compatibility.summary.validDocuments} valid static documents; ${compatibility.summary.unresolvedDocuments} unresolved; ${compatibility.summary.missingRoots.length} missing roots.</li><li>${verified} operations marked VERIFIED in the operation evidence registry.</li><li>No <code>docs/GATES.json</code> exists, so G0–G5 remain open.</li></ul></details><ul><li>Behavioral implementation and tagged integration evidence for all multivendor roots.</li><li>Real-stack customer, store, rider, and admin journeys using original Enatega apps.</li><li>Provider credentials; native device runs; QA, security, load, restore, dependency, and release approvals.</li></ul><p class="note">Historical replacement-shell results are not proof of current Enatega E2E acceptance.</p></section>
<section><h2>Latest committed checkpoints</h2><ol>${commits}</ol></section><footer><p class="note">Generated by <code>node tools/generate-implementation-status.mjs</code>. Use <code>--check</code> to detect drift.</p></footer></main></body></html>`;
const html = await prettier.format(raw, { parser: "html" });
if (process.argv.includes("--stdout")) process.stdout.write(html);
else if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== html) {
    console.error("docs/IMPLEMENTATION_STATUS.html is stale");
    process.exit(1);
  }
  console.log("Implementation status HTML is current");
} else {
  writeFileSync(target, html);
  console.log(`Wrote ${target}`);
}
