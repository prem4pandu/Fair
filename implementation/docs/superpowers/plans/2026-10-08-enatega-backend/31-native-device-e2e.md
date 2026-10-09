# Native device E2E — W19

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** Prove the three pinned mobile applications work on real signed builds on real devices — permissions,
background location, push delivery and taps, deep links, offline and reconnect, and the full customer, store and
rider journeys — so G4 can record native evidence that no simulator, Expo export or browser run can substitute.

**Architecture:** Maestro flows (decision D-N1) run against signed development/internal builds of the pinned apps,
pointed at a reachable Fair stack. The flows live outside the vendor tree in `e2e/native/`; the apps themselves are
built from the unmodified pinned source plus the recorded integration edits from `30-frontend-integration.md`.

**Tech stack:** Maestro, EAS Build (or local Xcode/Gradle builds), Expo development/internal distribution builds,
physical Android and iOS devices, the Fair API reachable from the device network.

---

## 1. Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

W19 makes **no** edit inside `vendor/enatega-ui/`. A flow that cannot be expressed against the pinned UI is a
finding for the owning frontend workstream, never a reason to add a test hook, an accessibility id or a label to
the app. If a selector is unavailable, select by visible text or position and record the fragility.

---

## 2. Hard preconditions

**This workstream cannot start, and must not be marked `N/A`, until all of these exist.** Missing infrastructure is
a blocker (`ROADMAP.md` §5.5).

| Precondition                                                                      | Verify with                               | Status source     |
| --------------------------------------------------------------------------------- | ----------------------------------------- | ----------------- |
| At least one physical Android device, developer mode on, authorised               | `adb devices` lists it                    | owner             |
| At least one physical iOS device registered to the signing account                | `xcrun devicectl list devices`            | owner             |
| Full Xcode (not CommandLineTools)                                                 | `xcode-select -p` ends in `Xcode.app`     | owner             |
| Apple Developer and Google Play accounts owned by FairBite                        | signing identity present                  | owner             |
| FairBite-owned EAS projects and `updates.url` (the pinned profiles are Enatega's) | `eas.json` points at FairBite project ids | owner, via W14a/b |
| Push credentials: APNs key/Firebase native binding files                          | a test push reaches the device            | owner             |
| The Fair stack reachable from the device network (not `localhost`)                | the device loads `/health`                | W1                |

Record each as satisfied or blocked in `docs/GATES.json` with the command and output. A simulator, an Expo Go
session or an `expo export` satisfies none of them.

---

## 3. Build matrix

| App                         | Platform | Build type                      | Owner of the build config |
| --------------------------- | -------- | ------------------------------- | ------------------------- |
| `enatega-multivendor-app`   | Android  | signed internal distribution    | W14a                      |
| `enatega-multivendor-app`   | iOS      | signed development distribution | W14a                      |
| `enatega-multivendor-store` | Android  | signed internal distribution    | W14b                      |
| `enatega-multivendor-store` | iOS      | signed development distribution | W14b                      |
| `enatega-multivendor-rider` | Android  | signed internal distribution    | W14b                      |
| `enatega-multivendor-rider` | iOS      | signed development distribution | W14b                      |

Every build is produced from the pinned source with only recorded edits, and its artifact hash is recorded with the
run. A run whose build cannot be tied to a commit is not evidence.

---

## 4. Tasks

### Task 1: Harness and device inventory

- [ ] **Step 1: Write the failing check** `e2e/native/preflight.sh`: asserts a connected Android device, a
      connected iOS device, full Xcode, Maestro on PATH, and a reachable API base URL from the device network.
- [ ] **Step 2: Run it.** Today it fails on every line — record that output verbatim as the current blocker
      evidence.
- [ ] **Step 3: Implement** the script and `e2e/native/README.md` describing how a run is reproduced: device
      model, OS version, build artifact hash, API URL, Maestro version.
- [ ] **Step 4: Run it** once the owner supplies devices; record the passing output.
- [ ] **Step 5: Commit** `test(w19): native preflight`.

### Task 2: Permission and launch flows (all three apps)

- [ ] **Step 1: Write the failing flows** `e2e/native/<app>/01-launch-permissions.yaml`: cold launch, the pinned
      permission prompts in the pinned order, deny-then-recover, and the handshake completing before login.
- [ ] **Step 2: Run** against the signed build; record failures.
- [ ] **Step 3: Fix** only outside the vendor tree; UI findings go to W14a/W14b.
- [ ] **Step 4: Run** and record the artifact (video plus device log).
- [ ] **Step 5: Commit.**

### Task 3: Customer journey on device (`enatega-multivendor-app`)

- [ ] **Step 1: Write the failing flow** `02-customer-order.yaml`: sign in, browse, select address, build a cart,
      place a COD order, watch the status change arrive over the subscription, open tracking, chat with the rider,
      receive and tap the push notification, review the delivered order.
- [ ] **Step 2: Run** it; record failures.
- [ ] **Step 3: Fix** outside the vendor tree; file UI findings.
- [ ] **Step 4: Run** and record video, device log and the matching API request log.
- [ ] **Step 5: Commit.**

### Task 4: Store journey on device (`enatega-multivendor-store`)

- [ ] **Step 1: Write the failing flow** `03-store-fulfilment.yaml`: sign in, receive the new-order subscription
      (including the ring and mute behaviour), accept, prepare, hand over, and the negative case of declining.
- [ ] **Step 2–5:** as Task 3.

### Task 5: Rider journey on device (`enatega-multivendor-rider`)

- [ ] **Step 1: Write the failing flow** `04-rider-delivery.yaml`: sign in, go available, receive a zone-broadcast
      offer, self-assign, **background the app and prove location still posts** through the native background
      task, pick up, deliver, and the negative case of a second rider losing the race for the same order.
- [ ] **Step 2–5:** as Task 3. Background location is the flow most likely to pass in the foreground and fail in
      reality: the assertion must come from server-side location rows while the app is backgrounded, not from a
      screen.

### Task 6: Push, deep links, offline and reconnect

- [ ] **Step 1: Write the failing flows** `05-push-and-links.yaml` and `06-offline-reconnect.yaml`: push delivery
      and tap routing for each payload shape the apps parse (`type: order`, `REVIEW_ORDER`, `chat`); each deep
      link in `docs/ENATEGA_URL_CONTRACT.json`; airplane-mode during an active order, then reconnect, proving the
      subscription recovers and no duplicate action is submitted.
- [ ] **Step 2–5:** as Task 3.

### Task 7: Record the gate

- [ ] **Step 1:** Record every run in `docs/GATES.json` with device model, OS version, build hash, commit, Maestro
      version and artifact paths under `docs/artifacts/w19/`.
- [ ] **Step 2:** Request W23 and W24 review. No self-approval.
- [ ] **Step 3:** Any flow that cannot run stays recorded as **blocked**, never `N/A`.

---

## 5. Gate checklist (G4, native portion)

- [ ] All six builds are signed, installed and tied to a commit.
- [ ] Permission, customer, store, rider, push/deep-link and offline flows pass on at least one physical device per
      platform.
- [ ] Background location proven from server-side evidence while the app is backgrounded.
- [ ] Every artifact is inspectable and tied to a build hash.
- [ ] No Expo export, simulator run or browser run is cited as native evidence.
- [ ] W23 and W24 approvals recorded.

---

## 6. Open blockers

Devices, full Xcode, Apple/Google accounts, FairBite-owned EAS projects and `updates.url`, push credentials, and a
device-reachable deployment of the stack. Every one of these is an owner input; until they arrive W19 produces the
harness and the recorded blocker evidence, and nothing else.
