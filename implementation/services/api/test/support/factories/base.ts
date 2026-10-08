import type { Pool, PoolClient } from "pg";
import { newId } from "../../../src/kernel/ids.js";

type SqlClient = Pick<Pool | PoolClient, "query">;

export type FoundationMigrationRow = {
  id: string;
  appliedAt: Date;
};

export type DomainEventRow = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  availableAt: Date;
  claimedBy: string | null;
  claimExpiresAt: Date | null;
  processedAt: Date | null;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: Date | null;
};

export type EventInboxRow = {
  consumer: string;
  eventId: string;
  processedAt: Date;
};

export type DevOutboxRow = {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  createdAt: Date;
};

let sequence = 0;

const uniqueLabel = (prefix: string): string => `${prefix}-${++sequence}`;

export function baseFactories(client: SqlClient) {
  return {
    async foundationMigration(
      overrides: Partial<FoundationMigrationRow> = {},
    ): Promise<FoundationMigrationRow> {
      const values = {
        id: uniqueLabel("test-migration"),
        appliedAt: new Date(),
        ...overrides,
      };
      const result = await client.query<FoundationMigrationRow>(
        'INSERT INTO "FoundationMigration" ("id", "appliedAt") VALUES ($1, $2) RETURNING *',
        [values.id, values.appliedAt],
      );
      return result.rows[0]!;
    },

    async domainEvent(
      overrides: Partial<DomainEventRow> = {},
    ): Promise<DomainEventRow> {
      const now = new Date();
      const values: DomainEventRow = {
        id: newId(),
        type: "test.created",
        payload: { source: "factory" },
        createdAt: now,
        availableAt: now,
        claimedBy: null,
        claimExpiresAt: null,
        processedAt: null,
        attempts: 0,
        lastError: null,
        deadLetteredAt: null,
        ...overrides,
      };
      const result = await client.query<DomainEventRow>(
        `INSERT INTO "DomainEvent" (
          "id", "type", "payload", "createdAt", "availableAt", "claimedBy",
          "claimExpiresAt", "processedAt", "attempts", "lastError", "deadLetteredAt"
        ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          values.id,
          values.type,
          JSON.stringify(values.payload),
          values.createdAt,
          values.availableAt,
          values.claimedBy,
          values.claimExpiresAt,
          values.processedAt,
          values.attempts,
          values.lastError,
          values.deadLetteredAt,
        ],
      );
      return result.rows[0]!;
    },

    async eventInbox(
      overrides: Partial<EventInboxRow> = {},
    ): Promise<EventInboxRow> {
      const values = {
        consumer: uniqueLabel("test-consumer"),
        eventId: newId(),
        processedAt: new Date(),
        ...overrides,
      };
      const result = await client.query<EventInboxRow>(
        'INSERT INTO "EventInbox" ("consumer", "eventId", "processedAt") VALUES ($1, $2, $3) RETURNING *',
        [values.consumer, values.eventId, values.processedAt],
      );
      return result.rows[0]!;
    },

    async devOutbox(
      overrides: Partial<DevOutboxRow> = {},
    ): Promise<DevOutboxRow> {
      const values = {
        id: newId(),
        channel: "email",
        recipient: `${uniqueLabel("recipient")}@example.test`,
        subject: "Factory message",
        body: "Factory body",
        createdAt: new Date(),
        ...overrides,
      };
      const result = await client.query<DevOutboxRow>(
        `INSERT INTO "DevOutbox" (
          "id", "channel", "recipient", "subject", "body", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          values.id,
          values.channel,
          values.recipient,
          values.subject,
          values.body,
          values.createdAt,
        ],
      );
      return result.rows[0]!;
    },
  };
}

export type BaseFactories = ReturnType<typeof baseFactories>;
