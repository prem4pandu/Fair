import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startApi, type Api } from "../../support/app.js";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startStack, type Stack } from "../../support/stack.js";

describe(op("mutation.metricsGeneral"), () => {
  let stack: Stack;
  let api: Api;

  beforeAll(async () => {
    stack = await startStack();
    api = await startApi(stack);
  });

  beforeEach(async () => {
    await stack.reset();
  });

  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  it("returns the Enatega public-access handshake", async () => {
    const metrics = await api.http.metricsGeneral();

    expect(metrics.experience).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(metrics.hehe))).toBe(false);
  });

  it("executes the pinned admin handshake document with only a nonce", async () => {
    const query = doc(
      "enatega-multivendor-admin",
      "lib/api/graphql/mutations/metrics/index.ts",
      "METRICS_GENERAL",
    );
    const result = await api.http.raw(
      { query },
      { nonce: "pinned-admin-handshake" },
    );

    expect(result.status).toBe(200);
    expect(result.body.errors).toBeUndefined();
    expect(result.body.data.metricsGeneral.experience).toEqual(
      expect.any(String),
    );
  });
});

describe(op("query._kernel"), () => {
  let stack: Stack;
  let api: Api;

  beforeAll(async () => {
    stack = await startStack();
    api = await startApi(stack);
  });

  beforeEach(async () => {
    await stack.reset();
  });

  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  it("surfaces the kernel placeholder as NOT_IMPLEMENTED", async () => {
    const result = await api.http.query("query Kernel { _kernel }");

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ _kernel: null });
    expect(result.errors).toEqual([
      expect.objectContaining({
        extensions: expect.objectContaining({ code: "NOT_IMPLEMENTED" }),
      }),
    ]);
  });
});
