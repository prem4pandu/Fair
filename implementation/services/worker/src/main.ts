import { readConfig } from "./config.js";
import { startWorker } from "./worker.js";
try {
  const config = readConfig(process.env);
  const runtime = await startWorker(config.REDIS_URL, config.DATABASE_URL);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await runtime.close();
    } catch {
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  console.info(JSON.stringify({ event: "foundation_worker_started" }));
} catch {
  console.error(JSON.stringify({ event: "foundation_worker_start_failed" }));
  process.exitCode = 1;
}
