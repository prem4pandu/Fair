import type { Pool, PoolClient } from "pg";

export type TransactionClient = Pick<PoolClient, "query">;

export async function withUnitOfWork<T>(
  pool: Pick<Pool, "connect">,
  work: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Unit of work and rollback failed",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
