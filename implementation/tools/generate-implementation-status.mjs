#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import prettier from "prettier";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/IMPLEMENTATION_STATUS.html");
const json = (name) => JSON.parse(readFileSync(resolve(root, "docs", name), "utf8"));
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const compatibility = json("ENATEGA_COMPATIBILITY_REPORT.json");
const lanes = json("OPERATION_LANES.json");
const evidence = json("OPERATION_TEST_EVIDENCE.json");
const ops = evidence.operations ?? evidence;
const verified = Array.isArray(ops) ? ops.filter((item) => item.status === "VERIFIED").length : 0;
const git = execFileSync("git", ["log", "-8", "--pretty=format:%h%x09%s"], { cwd: root, encoding: "utf8" }).trim().split("\n").map((line) => line.split("\t"));
const laneNames = {L0:"Transport foundation",L1:"Identity",L2:"Platform configuration",L3:"Vendors and catalog",L4:"Customers and support",L5:"Orders",L6:"Dispatch and realtime",L7:"Finance",L8:"Notifications",L9:"Analytics",L12:"Single-vendor mode"};
const laneState = (lane) => lane === "L0" ? ["IN PROGRESS","Kernel and transports implemented; formal G0 evidence and approval remain open."] : lane === "L12" ? ["BLOCKED","Explicitly gated until Wave 5; schema presence is not runtime implementation."] : ["IN PROGRESS","SDL is present; operation-level behavior and required E2E evidence are incomplete."];
const badge = (status) => `<span class="badge ${status.toLowerCase().replace(" ", "-")}">${status}</span>`;
const rows = Object.entries(lanes.perLane).sort(([a],[b]) => Number(a.slice(1))-Number(b.slice(1))).map(([lane,count]) => { const [state,note]=laneState(lane); return `<tr><th scope="row">${lane}</th><td>${esc(laneNames[lane] ?? lane)}</td><td>${count}</td><td>${badge(state)}</td><td>${esc(note)}</td></tr>`; }).join("");
const commits = git.map(([hash,subject]) => `<li><code>${esc(hash)}</code> ${esc(subject)}</li>`).join("");
const appRows = [
  ["Admin web","Enatega multivendor admin","GraphQL + WebSocket","IN PROGRESS"],
  ["Customer web","Enatega multivendor web","GraphQL + public handshake","IN PROGRESS"],
  ["Customer mobile","Enatega app","GraphQL + WebSocket","IN PROGRESS"],
  ["Store mobile","Enatega store","GraphQL + WebSocket","IN PROGRESS"],
  ["Rider mobile","Enatega rider","GraphQL + WebSocket","IN PROGRESS"],
].map(([app,source,transport,state])=>`<tr><th scope="row">${app}</th><td>${source}</td><td>${transport}</td><td>${badge(state)}</td></tr>`).join("");
const rawHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FairBite implementation status</title>
<style>:root{color-scheme:dark;--bg:#09110f;--panel:#111d19;--line:#294038;--text:#edf7f2;--muted:#a8beb4;--green:#65d6a6;--amber:#ffc966;--red:#ff8a85;--blue:#79bfff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px 20px 80px}header{padding:28px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(135deg,#162b24,#0d1714)}h1{margin:.1em 0;font-size:clamp(2rem,5vw,4.2rem);line-height:1}h2{margin-top:42px}h3{margin-bottom:6px}.eyebrow{color:var(--green);font-weight:700;text-transform:uppercase;letter-spacing:.12em}.lead{max-width:75ch;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:22px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}.value{font-size:1.8rem;font-weight:800}.label,.note{color:var(--muted)}.badge{display:inline-block;border-radius:999px;padding:.18rem .62rem;font-size:.78rem;font-weight:800;white-space:nowrap}.complete{color:var(--green);background:#163c30}.in-progress{color:var(--amber);background:#40351b}.blocked{color:var(--red);background:#472525}table{width:100%;border-collapse:collapse;background:var(--panel)}caption{text-align:left;color:var(--muted);padding:0 0 10px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:12px}thead th{color:var(--green)}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px}code{color:var(--blue)}a{color:var(--blue)}details{border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:10px 0;background:var(--panel)}summary{cursor:pointer;font-weight:700}.callout{border-left:4px solid var(--amber);padding:12px 18px;background:#241f13}.blocked-list li{margin:.5em 0}@media(max-width:650px){main{padding:18px 12px 60px}header{padding:20px}th,td{padding:9px;font-size:.9rem}}:focus-visible{outline:3px solid var(--blue);outline-offset:3px}</style></head>
<body><main><header><div class="eyebrow">Evidence-based project report</div><h1>FairBite implementation status</h1><p class="lead">The original pinned Enatega presentation is the product UI. FairBite owns the backend and integration layer. This report distinguishes schema compatibility from implemented behavior and release readiness.</p><p>${badge("IN PROGRESS")} No release gate is recorded as passed.</p></header>
<section aria-labelledby="snapshot"><h2 id="snapshot">Current snapshot</h2><div class="grid">
<article class="card"><div class="value">${compatibility.summary.validDocuments}/${compatibility.summary.documents}</div><div class="label">static GraphQL documents valid</div></article>
<article class="card"><div class="value">${lanes.total}</div><div class="label">inventoried root operations</div></article>
<article class="card"><div class="value">${verified}/${Array.isArray(ops)?ops.length:lanes.total}</div><div class="label">operations marked verified by evidence registry</div></article>
<article class="card"><div class="value">0</div><div class="label">formal gates recorded passed</div></article></div>
<div class="callout"><strong>Compatibility result:</strong> ${esc(compatibility.staticCompatibility)} means the client documents validate against SDL. It does not prove resolver behavior, authorization, runtime reachability, URLs, subscriptions, UI parity, or end-to-end journeys.</div></section>
<section aria-labelledby="phases"><h2 id="phases">Phase status</h2><div class="table-wrap"><table><caption>Status requires implementation, checks, and independent approval.</caption><thead><tr><th>Wave</th><th>Scope</th><th>Status</th><th>Evidence gap</th></tr></thead><tbody>
<tr><th scope="row">0</th><td>Kernel, transport, tooling, test harness</td><td>${badge("IN PROGRESS")}</td><td>Implemented checkpoints exist; G0 aggregate evidence and independent approval are not recorded.</td></tr>
<tr><th scope="row">1</th><td>Contract and data model</td><td>${badge("IN PROGRESS")}</td><td>Static contract passes; upgrade migration, operation behavior, and formal G1 record remain open.</td></tr>
<tr><th scope="row">2</th><td>L1–L9 domain implementation</td><td>${badge("IN PROGRESS")}</td><td>SDL presence is ahead of resolver and per-operation integration/E2E evidence.</td></tr>
<tr><th scope="row">3</th><td>Journeys and application E2E</td><td>${badge("BLOCKED")}</td><td>Depends on domain operations and complete journey evidence.</td></tr>
<tr><th scope="row">4</th><td>Hardening and release</td><td>${badge("BLOCKED")}</td><td>Providers, native devices, security, dependency, load, restore, and approval gates remain.</td></tr>
<tr><th scope="row">5</th><td>Single-vendor L12</td><td>${badge("BLOCKED")}</td><td>Separate gated product mode; 70 roots are not approved for runtime use.</td></tr>
</tbody></table></div></section>
<section aria-labelledby="lanes"><h2 id="lanes">Backend lane matrix</h2><div class="table-wrap"><table><caption>Counts come from <code>OPERATION_LANES.json</code>.</caption><thead><tr><th>Lane</th><th>Module</th><th>Roots</th><th>Status</th><th>Current assessment</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section aria-labelledby="ui"><h2 id="ui">Enatega UI alignment</h2><p>The tracked UI baseline is <code>vendor/enatega-ui</code>. Product screens, navigation, assets, and interactions must remain Enatega’s. Backend work must match its GraphQL, REST, WebSocket, and public-access contracts.</p><div class="table-wrap"><table><thead><tr><th>Application</th><th>UI source</th><th>Backend path</th><th>Status</th></tr></thead><tbody>${appRows}</tbody></table></div></section>
<section aria-labelledby="market"><h2 id="market">Market, fleet, payment, and economic rules</h2><div class="grid">
<article class="card"><h3>Launch selection</h3><p>Malaysia, MYR, own fleet first.</p>${badge("IN PROGRESS")}</article>
<article class="card"><h3>Configuration model</h3><p>Country, currency precision, fleets, payment methods, and rules have validation/storage groundwork.</p>${badge("IN PROGRESS")}</article>
<article class="card"><h3>Payments</h3><p>Provider-independent contract work exists; real card/wallet provider readiness requires configured sandbox credentials and verified webhooks.</p>${badge("BLOCKED")}</article>
<article class="card"><h3>Fleet routing</h3><p>Own-fleet-first is selected. Full dispatch behavior, tracking, reconciliation, and provider adapters remain open.</p>${badge("IN PROGRESS")}</article></div></section>
<section aria-labelledby="checks"><h2 id="checks">Recorded verification</h2><details open><summary>Current machine-readable evidence</summary><ul><li>Static Enatega compatibility: <strong>${esc(compatibility.staticCompatibility)}</strong>; ${compatibility.summary.validDocuments} valid documents, ${compatibility.summary.unresolvedDocuments} unresolved, ${compatibility.summary.missingRoots.length} missing roots.</li><li>Operation evidence registry: ${verified} operations marked VERIFIED; unverified entries remain release blockers.</li><li>Repository history contains kernel, transport, outbox, identity adapter, and generated-contract checkpoints.</li><li>No <code>docs/GATES.json</code> approval record exists, so G0–G5 remain open.</li></ul></details>
<p class="note">Historical JSON reports describe earlier replacement-shell checks and are superseded where they conflict with the current Enatega-only boundary. This page does not reuse those results as proof of current end-to-end acceptance.</p></section>
<section aria-labelledby="blockers"><h2 id="blockers">Open blockers</h2><ul class="blocked-list"><li>Complete behavioral implementation and tagged integration evidence for all multivendor roots.</li><li>Real-stack customer, store, rider, and admin journeys using the original Enatega applications.</li><li>Stripe/payment credentials and webhook verification; Twilio/SMTP/FCM/Expo push; Google Maps; object storage.</li><li>Android emulator and physical-device runs plus Apple developer access for native release gates.</li><li>Independent QA, security review, load/resilience/restore evidence, dependency audit closure, and release approval.</li></ul></section>
<section aria-labelledby="history"><h2 id="history">Latest committed checkpoints</h2><ol>${commits}</ol></section>
<footer><p class="note">Generated deterministically by <code>node tools/generate-implementation-status.mjs</code> from repository evidence and Git history. Run with <code>--check</code> to detect drift.</p></footer></main></body></html>
`;
const html = await prettier.format(rawHtml, { parser: "html" });

if (process.argv.includes("--stdout")) {
  process.stdout.write(html);
} else if (process.argv.includes("--check")) {
  const actual = readFileSync(output, "utf8");
  if (actual !== html) { console.error("docs/IMPLEMENTATION_STATUS.html is stale"); process.exit(1); }
  console.log("Implementation status HTML is current");
} else {
  writeFileSync(output, html);
  console.log(`Wrote ${output}`);
}
