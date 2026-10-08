import { createApp } from "./app.js";
import { readConfig } from "./config.js";
try {
  const config = readConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.PORT, config.HOST);
  console.info(JSON.stringify({ event: "api_started", port: config.PORT }));
} catch {
  console.error(JSON.stringify({ event: "api_start_failed" }));
  process.exitCode = 1;
}
