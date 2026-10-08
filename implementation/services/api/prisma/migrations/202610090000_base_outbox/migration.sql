CREATE TABLE "DomainEvent" (
  "id" UUID PRIMARY KEY,
  "type" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedBy" VARCHAR(100),
  "claimExpiresAt" TIMESTAMPTZ(3),
  "processedAt" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(500),
  "deadLetteredAt" TIMESTAMPTZ(3)
);

CREATE INDEX "DomainEvent_processedAt_availableAt_claimExpiresAt_createdAt_idx"
  ON "DomainEvent"("processedAt", "availableAt", "claimExpiresAt", "createdAt");

CREATE TABLE "EventInbox" (
  "consumer" VARCHAR(100) NOT NULL,
  "eventId" UUID NOT NULL,
  "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventInbox_pkey" PRIMARY KEY ("consumer", "eventId")
);

CREATE INDEX "EventInbox_eventId_idx" ON "EventInbox"("eventId");

CREATE TABLE "DevOutbox" (
  "id" UUID PRIMARY KEY,
  "channel" VARCHAR(16) NOT NULL,
  "recipient" VARCHAR(254) NOT NULL,
  "subject" VARCHAR(200),
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DevOutbox_recipient_createdAt_idx"
  ON "DevOutbox"("recipient", "createdAt");
