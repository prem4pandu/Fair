import { describe, it, expect } from "vitest";
import { processProbe } from "../src/worker.js";
import { readConfig } from "../src/config.js";
describe("foundation worker boundaries", () => {
  it("accepts only explicit synthetic probes", () => {
    expect(
      processProbe({
        name: "probe",
        data: { probeId: "b061bf76-7a6d-41ae-89c6-f032fe814b8b" },
      }),
    ).toEqual({
      probeId: "b061bf76-7a6d-41ae-89c6-f032fe814b8b",
      status: "ok",
    });
  });
  it("rejects business jobs and extra data", () => {
    expect(() => processProbe({ name: "capture-payment", data: {} })).toThrow();
    expect(() =>
      processProbe({
        name: "probe",
        data: {
          probeId: "b061bf76-7a6d-41ae-89c6-f032fe814b8b",
          card: "secret",
        },
      }),
    ).toThrow();
  });
  it("rejects hostless URLs and driver query overrides", () => {
    for (const REDIS_URL of ["rediss:///", "redis://localhost?tls=false"])
      expect(() =>
        readConfig({ DATABASE_URL: "postgres://localhost/db", REDIS_URL }),
      ).toThrow();
  });
  it("fails closed without config and forbids plaintext production", () => {
    expect(() => readConfig({})).toThrow();
    expect(() =>
      readConfig({
        APP_ENV: "production",
        DATABASE_URL: "postgres://localhost/db",
        REDIS_URL: "redis://localhost",
      }),
    ).toThrow();
  });
});
