-- L1 identity: server-generated, single-use verification challenges.
--
-- Preserve/backfill/cutover policy: ADDITIVE, a new table only. No existing
-- table, column or row is touched, so the populated migration-005 upgrade keeps
-- every preserved row byte-identical.
--
-- Only hashes are stored. The recipient is keyed by an HMAC so a database read
-- cannot enumerate email addresses or phone numbers, and the code is stored as a
-- per-challenge HMAC so a read cannot recover it either.
--
-- Rollback: DROP TABLE "IdentityVerificationChallenge"; no other table
-- references it. Open challenges are lost, which only means the user requests a
-- new code.
CREATE TABLE "IdentityVerificationChallenge" (
  "id" UUID PRIMARY KEY,
  "purpose" VARCHAR(20) NOT NULL CHECK ("purpose" IN ('VERIFY','RESET')),
  "channel" VARCHAR(10) NOT NULL CHECK ("channel" IN ('EMAIL','SMS')),
  "targetHash" CHAR(64) NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" BETWEEN 0 AND 10),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '3600 seconds'),
  CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt")
);

CREATE INDEX "IdentityVerificationChallenge_targetHash_purpose_createdAt_idx"
  ON "IdentityVerificationChallenge"("targetHash", "purpose", "createdAt");

-- A challenge's binding is immutable and its counters only move forward:
-- attempts may rise, consumedAt may be set once, and nothing else may change.
CREATE FUNCTION identity_challenge_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."purpose" <> OLD."purpose"
     OR NEW."channel" <> OLD."channel"
     OR NEW."targetHash" <> OLD."targetHash"
     OR NEW."codeHash" <> OLD."codeHash"
     OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."expiresAt" <> OLD."expiresAt"
     OR NEW."attempts" < OLD."attempts"
     OR (OLD."consumedAt" IS NOT NULL AND NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt")
  THEN RAISE EXCEPTION 'verification challenge binding is immutable';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER identity_challenge_immutable
  BEFORE UPDATE ON "IdentityVerificationChallenge"
  FOR EACH ROW EXECUTE FUNCTION identity_challenge_immutable();

-- Challenges must not be deleted or truncated: consumption is the only exit.
CREATE TRIGGER identity_challenge_no_delete
  BEFORE DELETE ON "IdentityVerificationChallenge"
  FOR EACH ROW EXECUTE FUNCTION identity_audit_immutable();

CREATE TRIGGER identity_challenge_no_truncate
  BEFORE TRUNCATE ON "IdentityVerificationChallenge"
  FOR EACH STATEMENT EXECUTE FUNCTION identity_audit_immutable();
