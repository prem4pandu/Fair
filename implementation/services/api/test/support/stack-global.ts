import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";

const execFileAsync = promisify(execFile);
const apiDirectory = fileURLToPath(new URL("../..", import.meta.url));
const prismaExecutable = fileURLToPath(
  new URL("../../node_modules/.bin/prisma", import.meta.url),
);

export default async function setup(project: TestProject) {
  let postgres: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;
  let redis: StartedTestContainer | undefined;

  try {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer("postgis/postgis:17-3.5")
        .withPlatform("linux/amd64")
        .withStartupTimeout(120_000)
        .start(),
      new GenericContainer("redis:7-alpine")
        .withExposedPorts(6379)
        .withStartupTimeout(120_000)
        .start(),
    ]);

    const databaseUrl = postgres.getConnectionUri();
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    await execFileAsync(prismaExecutable, ["migrate", "deploy"], {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
    });

    project.provide("databaseUrl", databaseUrl);
    project.provide("redisUrl", redisUrl);
  } catch (error) {
    await Promise.allSettled([redis?.stop(), postgres?.stop()]);
    throw error;
  }

  return async () => {
    const results = await Promise.allSettled([redis?.stop(), postgres?.stop()]);
    const failures = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Failed to stop the integration stack",
      );
    }
  };
}
