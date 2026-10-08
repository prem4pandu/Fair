import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
export const FOUNDATION_QUEUE = "foundation-probe";
const probe = z.strictObject({ probeId: z.string().uuid() });
export function processProbe(job: Pick<Job, "name" | "data">) {
  if (job.name !== "probe") throw new Error("Unsupported foundation job");
  const data = probe.parse(job.data);
  return { probeId: data.probeId, status: "ok" };
}
export async function startWorker(redisUrl: string) {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  connection.on("error", () => {});
  await connection.connect();
  const worker = new Worker(
    FOUNDATION_QUEUE,
    async (job) => processProbe(job),
    { connection, concurrency: 2 },
  );
  worker.on("error", () => {
    console.error(JSON.stringify({ event: "foundation_worker_error" }));
  });
  await worker.waitUntilReady();
  return {
    worker,
    close: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}
