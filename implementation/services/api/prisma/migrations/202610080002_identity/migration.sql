CREATE TABLE "IdentityUser" (
 "id" UUID PRIMARY KEY, "email" VARCHAR(254) NOT NULL UNIQUE, "displayName" VARCHAR(100) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','SUSPENDED')),
 "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE, "roles" TEXT[] NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (length("email") BETWEEN 3 AND 254 AND "email" = lower("email") AND "email" = btrim("email")),
 CHECK (length(btrim("displayName")) BETWEEN 1 AND 100),
 CHECK (cardinality("roles") BETWEEN 1 AND 4 AND "roles" <@ ARRAY['CUSTOMER','MERCHANT_STAFF','RIDER','ADMIN']::text[])
);
CREATE TABLE "IdentityCredential" ("userId" UUID PRIMARY KEY REFERENCES "IdentityUser"("id") ON DELETE RESTRICT, "passwordHash" TEXT NOT NULL CHECK ("passwordHash" LIKE '$argon2id$%'));
CREATE TABLE "IdentityApplicationGrant" (
 "userId" UUID NOT NULL REFERENCES "IdentityUser"("id") ON DELETE RESTRICT,
 "application" TEXT NOT NULL CHECK ("application" IN ('MERCHANT','RIDER','ADMIN')),
 "active" BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY ("userId","application")
);
CREATE TABLE "IdentitySessionFamily" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "IdentityUser"("id") ON DELETE RESTRICT,
 "application" TEXT NOT NULL CHECK ("application" IN ('CUSTOMER','MERCHANT','RIDER','ADMIN')),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "revokedAt" TIMESTAMPTZ(3), UNIQUE ("id","userId"),
 CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '2592000 seconds'),
 CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);
CREATE INDEX "IdentitySessionFamily_userId_idx" ON "IdentitySessionFamily"("userId");
CREATE TABLE "IdentityRefreshSession" (
 "id" UUID PRIMARY KEY, "familyId" UUID NOT NULL, "userId" UUID NOT NULL,
 "tokenHash" CHAR(64) NOT NULL UNIQUE CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "consumedAt" TIMESTAMPTZ(3),
 FOREIGN KEY ("familyId","userId") REFERENCES "IdentitySessionFamily"("id","userId") ON DELETE RESTRICT,
 CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt")
);
CREATE INDEX "IdentityRefreshSession_familyId_idx" ON "IdentityRefreshSession"("familyId");
CREATE TABLE "IdentityAuditEvent" (
 "id" UUID PRIMARY KEY, "userId" UUID, "familyId" UUID,
 "action" VARCHAR(40) NOT NULL CHECK ("action" IN ('REGISTER','LOGIN','REFRESH','REFRESH_REPLAY','LOGOUT','LOGOUT_ALL')),
 "outcome" VARCHAR(10) NOT NULL CHECK ("outcome" IN ('SUCCESS','FAILURE')),
 "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION identity_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'identity audit is append only'; END; $$;
CREATE TRIGGER identity_audit_immutable BEFORE UPDATE OR DELETE ON "IdentityAuditEvent" FOR EACH ROW EXECUTE FUNCTION identity_audit_immutable();
CREATE FUNCTION identity_family_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."userId" <> OLD."userId" OR NEW."application" <> OLD."application" OR NEW."expiresAt" <> OLD."expiresAt" OR NEW."createdAt" <> OLD."createdAt" OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN RAISE EXCEPTION 'identity family binding is immutable'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER identity_family_immutable BEFORE UPDATE ON "IdentitySessionFamily" FOR EACH ROW EXECUTE FUNCTION identity_family_immutable();
CREATE FUNCTION identity_roles_unique(value text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT count(*) = count(DISTINCT role) FROM unnest(value) AS role $$;
ALTER TABLE "IdentityUser" ADD CONSTRAINT identity_roles_unique CHECK (identity_roles_unique("roles"));
CREATE FUNCTION identity_refresh_binding() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE family "IdentitySessionFamily"%ROWTYPE; BEGIN
 SELECT * INTO family FROM "IdentitySessionFamily" WHERE "id" = NEW."familyId" AND "userId" = NEW."userId";
 IF NOT FOUND OR NEW."createdAt" < family."createdAt" OR NEW."createdAt" >= family."expiresAt" THEN RAISE EXCEPTION 'invalid refresh session chronology'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."familyId" <> OLD."familyId" OR NEW."userId" <> OLD."userId" OR NEW."tokenHash" <> OLD."tokenHash" OR NEW."createdAt" <> OLD."createdAt" OR (OLD."consumedAt" IS NOT NULL AND NEW."consumedAt" IS DISTINCT FROM OLD."consumedAt")) THEN RAISE EXCEPTION 'refresh session binding is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER identity_refresh_binding BEFORE INSERT OR UPDATE ON "IdentityRefreshSession" FOR EACH ROW EXECUTE FUNCTION identity_refresh_binding();
CREATE TRIGGER identity_audit_no_truncate BEFORE TRUNCATE ON "IdentityAuditEvent" FOR EACH STATEMENT EXECUTE FUNCTION identity_audit_immutable();
-- Replay history must not be erased by ordinary writers; retention changes need a separate reviewed policy.
CREATE TRIGGER identity_refresh_no_delete BEFORE DELETE ON "IdentityRefreshSession" FOR EACH ROW EXECUTE FUNCTION identity_audit_immutable();
CREATE TRIGGER identity_refresh_no_truncate BEFORE TRUNCATE ON "IdentityRefreshSession" FOR EACH STATEMENT EXECUTE FUNCTION identity_audit_immutable();
CREATE TRIGGER identity_family_no_delete BEFORE DELETE ON "IdentitySessionFamily" FOR EACH ROW EXECUTE FUNCTION identity_audit_immutable();
CREATE TRIGGER identity_family_no_truncate BEFORE TRUNCATE ON "IdentitySessionFamily" FOR EACH STATEMENT EXECUTE FUNCTION identity_audit_immutable();
