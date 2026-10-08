import type { Pool, PoolClient } from "pg";
import { baseFactories } from "./base.js";

type SqlClient = Pick<Pool | PoolClient, "query">;

export function factories(client: SqlClient) {
  return {
    ...baseFactories(client),
  };
}

export type Factories = ReturnType<typeof factories>;

export * from "./base.js";
