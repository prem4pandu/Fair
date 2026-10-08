import { describe, expect, it } from "vitest";
import { PublicAccessTokens } from "../../../src/kernel/public-access/token.js";
import { gateDecision } from "../../../src/kernel/public-access/gate.js";

const secret = Buffer.alloc(32, 9).toString("base64url");
const at = (iso: string) => ({ now: () => new Date(iso) });

describe("public-access tokens", () => {
  it("mints a token bound to the nonce with an ISO expiry", async () => {
    const tokens = new PublicAccessTokens(
      secret,
      900,
      at("2026-10-08T00:00:00Z"),
    );
    const minted = await tokens.mint("device-1");
    expect(minted.hehe).toBe("2026-10-08T00:15:00.000Z");
    expect(await tokens.verify(minted.experience, "device-1")).toEqual({
      ok: true,
    });
  });

  it("re-minting for the same nonce leaves earlier tokens valid", async () => {
    const tokens = new PublicAccessTokens(
      secret,
      900,
      at("2026-10-08T00:00:00Z"),
    );
    const first = await tokens.mint("n");
    await tokens.mint("n");
    expect(await tokens.verify(first.experience, "n")).toEqual({ ok: true });
  });

  it("reports each failure with the exact client-recognised reason", async () => {
    const early = new PublicAccessTokens(
      secret,
      900,
      at("2026-10-08T00:00:00Z"),
    );
    const late = new PublicAccessTokens(
      secret,
      900,
      at("2026-10-08T01:00:00Z"),
    );
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
    const tokens = new PublicAccessTokens(
      secret,
      900,
      at("2026-10-08T00:00:00Z"),
    );
    const nonce = "-iPhone14,2 17.0-lq3k-0123456789abcdef0123456789abcdef";
    expect(
      await tokens.verify((await tokens.mint(nonce)).experience, nonce),
    ).toEqual({ ok: true });
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
      expect(await gateDecision({ query }, { nonce: "n" }, ok)).toEqual({
        pass: true,
      });
  });

  it("selects the operation that Apollo will execute", async () => {
    const query = `
      mutation Mint { metricsGeneral { experience } }
      query Configuration { configuration { _id } }
    `;
    expect(
      await gateDecision({ query, operationName: "Mint" }, { nonce: "n" }, ok),
    ).toEqual({ pass: true });
    expect(
      await gateDecision(
        { query, operationName: "Configuration" },
        { nonce: "n" },
        ok,
      ),
    ).toEqual({ pass: false, message: "Unauthorized: token missing" });
  });

  it("requires a nonce for metricsGeneral", async () => {
    expect(
      await gateDecision(
        { query: "mutation { metricsGeneral { experience } }" },
        {},
        ok,
      ),
    ).toEqual({ pass: false, message: "Unauthorized: nonce header missing" });
  });

  it("requires bop-auth and nonce for every other operation", async () => {
    expect(
      await gateDecision(
        { query: "{ configuration { _id } }" },
        { nonce: "n" },
        ok,
      ),
    ).toEqual({ pass: false, message: "Unauthorized: token missing" });
    expect(
      await gateDecision(
        { query: "{ configuration { _id } }" },
        { "bop-auth": "Bearer t" },
        ok,
      ),
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
      await gateDecision(
        { query: "{ a }" },
        { "bop-auth": "", nonce: "n" },
        ok,
      ),
    ).toEqual({ pass: false, message: "Unauthorized: token missing" });
  });

  it("does not exempt mixed documents that include another root", async () => {
    expect(
      await gateDecision(
        { query: "mutation { metricsGeneral { hehe } other }" },
        { nonce: "n" },
        ok,
      ),
    ).toEqual({ pass: false, message: "Unauthorized: token missing" });
  });

  it("leaves unparsable bodies to Apollo", async () => {
    expect(await gateDecision({ query: "{{{" }, {}, ok)).toEqual({
      pass: true,
    });
  });
});
