import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import { createApp } from "../../src/app.js";
import { readConfig } from "../../src/config.js";
import { GqlClient } from "./gql.js";
import type { Stack } from "./stack.js";

export type Api = {
  app: INestApplication;
  http: GqlClient;
  wsUrl: string;
  close(): Promise<void>;
};

const testSecret = (byte: number) =>
  Buffer.alloc(32, byte).toString("base64url");

export async function startApi(
  stack: Stack,
  env: Record<string, string> = {},
): Promise<Api> {
  const app = await createApp(
    readConfig({
      APP_ENV: "test",
      DATABASE_URL: stack.databaseUrl,
      REDIS_URL: stack.redisUrl,
      PUBLIC_BASE_URL: "http://127.0.0.1:4100",
      PUBLIC_ACCESS_ENFORCED: "true",
      PUBLIC_ACCESS_SECRET: testSecret(7),
      PASSWORD_AUTH_ENABLED: "true",
      ACCESS_TOKEN_SECRET: testSecret(1),
      REFRESH_TOKEN_PEPPER: testSecret(2),
      ...env,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (!address || typeof address === "string") {
    await app.close();
    throw new Error("Test API did not bind a TCP port");
  }

  return {
    app,
    http: new GqlClient(server),
    wsUrl: `ws://127.0.0.1:${address.port}/graphql`,
    close: () => app.close(),
  };
}
