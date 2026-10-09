import { describe, expect, it, vi } from "vitest";
import { abortableDelay, runOutboxLoop } from "../src/outbox-runtime.js";

const database = { connect: vi.fn() };

describe("outbox runtime", () => {
  it("never overlaps dispatches and stops after an in-flight batch", async () => {
    const controller = new AbortController();
    let active = 0;
    let maximumActive = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const dispatch = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await blocked;
      active -= 1;
      controller.abort();
      return { claimed: 100, processed: 100, failed: 0 };
    });

    const running = runOutboxLoop({
      database,
      consumers: [],
      signal: controller.signal,
      dispatch,
    });
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
    release();
    await running;

    expect(maximumActive).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("backs off database failures and recovers without reporting success", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const error = new Error("database unavailable");
    const onError = vi.fn();
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ claimed: 0, processed: 0, failed: 0 });

    await runOutboxLoop({
      database,
      consumers: [],
      signal: controller.signal,
      idleDelayMs: 25,
      maximumBackoffMs: 100,
      dispatch,
      onError,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 3) controller.abort();
      },
    });

    expect(delays).toEqual([25, 50, 25]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(1, error);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("interrupts an idle wait promptly during shutdown", async () => {
    const controller = new AbortController();
    const waiting = abortableDelay(60_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
  });
});
