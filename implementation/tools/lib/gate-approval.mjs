// Shared approval arithmetic for recorded gate runs.
//
// A gate's *required* reviewer roles are declared in docs/ROADMAP.json; the
// roles actually signed off live in docs/GATES.json. Both status generators and
// tools/approve-gate.mjs read this module so they can never disagree about
// whether a gate is closed. The rule from docs/ROADMAP.md is that commands
// passing is only half of a gate: every required independent reviewer must be
// recorded too.

/** Reviewer roles a gate definition demands, e.g. ["lead","reviewer-QA"]. */
export const requiredRoles = (gate) => [...(gate?.approvals ?? [])];

/** Reviewer roles recorded against a run. */
export const recordedRoles = (run) => [...(run?.approvals ?? [])];

/**
 * Derive a run's approval state against its gate definition.
 *
 * `approved` is deliberately strict: a gate with three required reviewers is
 * not closed by one signature. A gate that declares no reviewers at all is
 * never approved either — that is a plan defect, not an open door.
 */
export function approvalState(gate, run, options = {}) {
  const required = requiredRoles(gate);
  const summary = recordedRoles(run);
  const records = [...(run?.approvalRecords ?? [])];
  const invalid = [];
  const recorder = identity(
    run?.recordedBy ?? options.commitAuthor?.(run?.commit) ?? "",
  );
  const seenRoles = new Set();
  const seenReviewers = new Set();
  const validRoles = [];
  for (const record of records) {
    const reviewer = identity(record?.reviewer);
    if (!required.includes(record?.role))
      invalid.push(`unexpected role ${record?.role ?? "<missing>"}`);
    if (!reviewer)
      invalid.push(`role ${record?.role ?? "<missing>"} has no reviewer`);
    if (seenRoles.has(record?.role))
      invalid.push(`duplicate role ${record.role}`);
    if (reviewer && seenReviewers.has(reviewer))
      invalid.push(`reviewer ${reviewer} holds multiple roles`);
    if (reviewer && recorder && reviewer === recorder)
      invalid.push(`reviewer ${reviewer} recorded or authored the run`);
    if (record?.runFinishedAt !== run?.finishedAt)
      invalid.push(`role ${record?.role ?? "<missing>"} targets another run`);
    if ((record?.commit ?? null) !== (run?.commit ?? null))
      invalid.push(
        `role ${record?.role ?? "<missing>"} targets another commit`,
      );
    const approvedAt =
      typeof record?.at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(record.at)
        ? Date.parse(record.at)
        : Number.NaN;
    const finishedAt = Date.parse(run?.finishedAt ?? "");
    if (!Number.isFinite(approvedAt))
      invalid.push(
        `role ${record?.role ?? "<missing>"} has an invalid approval timestamp`,
      );
    else if (!Number.isFinite(finishedAt) || approvedAt < finishedAt)
      invalid.push(
        `role ${record?.role ?? "<missing>"} predates the run completion`,
      );
    seenRoles.add(record?.role);
    if (reviewer) seenReviewers.add(reviewer);
    if (required.includes(record?.role) && reviewer)
      validRoles.push(record.role);
  }
  const recorded = required.filter((role) => validRoles.includes(role));
  if (
    summary.length !== recorded.length ||
    summary.some((role) => !recorded.includes(role))
  )
    invalid.push("approval summary disagrees with validated approval records");
  const missing = required.filter((role) => !recorded.includes(role));
  const unexpected = summary.filter((role) => !required.includes(role));
  return {
    required,
    recorded,
    missing,
    unexpected,
    invalid,
    passed: Boolean(run?.passed),
    approved:
      Boolean(run?.passed) &&
      required.length > 0 &&
      missing.length === 0 &&
      unexpected.length === 0 &&
      invalid.length === 0,
  };
}

/** The run a gate is judged by: its last complete (non-partial) run. */
export const judgedRun = (entry) => {
  const latest = entry?.latest ?? entry?.runs?.at(-1);
  if (!latest?.finishedAt) return null;
  return (
    entry?.runs
      ?.filter((candidate) => !candidate.partial)
      .findLast(
        (candidate) =>
          candidate.finishedAt === latest.finishedAt &&
          (candidate.commit ?? null) === (latest.commit ?? null),
      ) ?? latest
  );
};

/**
 * Normalized reviewer identity, for comparing people rather than spellings.
 *
 * `A N Other <an@example.com>` and `an@example.com` are the same reviewer, so
 * both collapse to the address. Without this, the no-self-approval and
 * role-independence rules are defeated by changing how you type your name.
 */
export const identity = (value) => {
  const text = String(value ?? "").trim();
  const email = text.match(/<([^>]+)>/)?.[1] ?? text;
  return email.trim().toLowerCase();
};

/** Shared release wording for the HTML and machine-readable status. */
export const releasePresentation = (approved) =>
  approved
    ? {
        badge: "COMPLETE",
        release: "APPROVED",
        text: "G5 is passed and closed by every required independent approval.",
      }
    : {
        badge: "IN PROGRESS",
        release: "NOT_APPROVED",
        text: "G5 is not closed by a passed run and every required independent approval.",
      };
