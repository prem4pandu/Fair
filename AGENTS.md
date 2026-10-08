# Fresh-build engineering boundaries

Use multiple Codex agents; local AI is disabled by the owner decision in the source session.
Lead owns root tooling, packages, contracts, docs and integration. Backend owns services;
web owns three web apps; mobile owns three mobile apps. Independent QA/security/review
follow implementation and may not self-approve. Never overwrite another lane's files.
Read installed Next.js documentation before web edits. Preserve all license notices.
Use integer minor units, server-owned prices, zero core-plan food commission, immutable
balanced journals, centrally validated transitions, provider-independent delivery routing,
server tenant ownership and no raw card data or provider secrets in clients.
No phase is complete until all acceptance checks, actual unit/integration/E2E checks,
lint/typecheck/build and independent reviews pass. Missing provider/device/infra inputs
remain blockers. Expo exports and browser smoke checks cannot satisfy native gates.
No mock success, fabricated policy or production fallback to upstream endpoints.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.

<!-- END:turborepo-agent-rules -->
