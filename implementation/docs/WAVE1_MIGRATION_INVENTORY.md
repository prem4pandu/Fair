# Wave 1 migration inventory and preservation contract

Scope: the checked-in migrations 001–005, followed by every later migration present at test time. This inventory records the current repository, not completion of G1. No production database was accessed.

## Ownership and actions

| Existing objects                                                                                                              | Owner                 | Action                                | Column mapping and null/default transition                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FoundationMigration                                                                                                           | Lead / base           | Preserve in place                     | Every column maps to itself; existing `id` and `appliedAt` unchanged.                                                                                                                                                  |
| IdentityUser, IdentityCredential, IdentityApplicationGrant, IdentitySessionFamily, IdentityRefreshSession, IdentityAuditEvent | L1 identity           | Preserve in place                     | Every column maps to itself, including UUIDv4 identifiers, credential hashes, grants, revoked families, consumed refresh rows and audit history; no null/default transition.                                           |
| CatalogMerchant, CatalogOutlet, CatalogCategory, CatalogItem                                                                  | L3 vendors/catalog    | Preserve in place                     | Every column maps to itself, including owner bindings, publication flags, description and integer `priceMinor`; no null/default transition.                                                                            |
| CustomerAddress                                                                                                               | L4 customers          | Preserve in place                     | Every column maps to itself, including ownership, coordinates, details and selected address; no null/default transition.                                                                                               |
| RuntimeConfigurationVersion, RuntimeConfigurationPointer                                                                      | L2 platform           | Additive extension of validation only | `id`, `version`, `document`, `createdAt` and pointer `versionId` map to themselves. Legacy documents do not acquire new keys. New delivery/payment/policy keys are optional; original defaults and nullability remain. |
| PostGIS extension and spatial_ref_sys                                                                                         | Lead / infrastructure | Preserve in place                     | No application ownership or data rewrite.                                                                                                                                                                              |

No enums are created by 001–005: status, roles, application, audit action and outcome use checked text. All exact columns, PostgreSQL types, defaults, primary/unique/partial indexes, checks, foreign keys, functions and triggers are enumerated in the authoritative DDL appendix below. Implicit indexes are created by each PRIMARY KEY and UNIQUE clause shown there. There are no explicit SQL database ROLE/OWNER/GRANT statements in this baseline. SQL ownership therefore follows the migration executor; application ownership is enforced by `userId`, `merchantId`, `outletId` and composite family/category foreign keys. Do not infer PostgreSQL row-level security from these bindings.

## Later migrations and cutover

- `202610090000_base_outbox` adds DomainEvent, EventInbox and DevOutbox; existing objects are untouched.
- `202610090100_l2_runtime_configuration` replaces the public-key allowlist constraint with a superset and adds optional section shape checks. It does not update any existing document. An existing pointer prevents bootstrap; fresh installations receive one initial snapshot/pointer. The upgrade fixture selects SGD explicitly to catch an accidental MYR bootstrap overwrite.
- `202610090150_L5_init` adds order enums, sequence, tables, indexes, append-only history and transition function; no old column is renamed or replaced. Cross-lane order ownership references do not yet gain foreign keys in this migration. Those remain a later implementation/review item.

The populated upgrade test exposed a bootstrap defect in `202610090100_l2_runtime_configuration`: an ungrouped `MAX` aggregate emits a row even when its `WHERE` removes every input. The guard now uses `HAVING NOT EXISTS` to suppress that output when a pointer exists. This corrects the checked-in historical migration for pending upgrades from 005 and fresh installations. Databases that already recorded this migration retain the original checksum; these tests do not prove repair or drift reconciliation of those databases. Never rewrite `_prisma_migrations` checksums automatically. Previously deployed installations need a separate reviewed deployment/drift procedure.

There is no name/storage cutover or backfill in the current later migrations, so no copy or rename rollback rehearsal applies. For validation rollback, first query for documents containing `deliveryFleets`, `paymentMethods` or `rules`; if any exist, stop. Immutable snapshots must not be edited/deleted to force downgrade. Restore the reviewed pre-upgrade database backup or roll forward. If none exist, in a transaction drop the three added shape checks and restore the original `configuration_public_keys` definition from migration 005. Added outbox/order tables must remain until dependent code and retained data have a reviewed retirement policy; application rollback is safer than destructive schema reversal.

## Executable preservation evidence

`services/api/test/integration/schema/migration-005.fixture.sql` is a deterministic, populated baseline with stable UUIDv4 ids, both active and suspended users, enabled and revoked families, unused and consumed refresh sessions, inactive admin grant, credentials, audit history, merchant/outlet/category/item relationships, selected/unselected addresses and two immutable configuration versions. The selected version is not changed during upgrade.

`upgrade.integration.spec.ts` creates a separate database, executes baseline SQL, registers each baseline migration through Prisma migrate resolve, restores the fixture, then runs Prisma migrate deploy over every later checked-in migration. Every baseline table is snapshotted as sorted full-row JSON before/after; equality validates identifiers, row counts, nulls, timestamps, hashes, document values and relationships. Applied migration names must match the complete sorted directory inventory. Failed constraint probes cover snapshot immutability, refresh retention, family ownership immutability, selected-address uniqueness, nonnegative catalog prices, catalog foreign keys and the new delivery section shape check. The API is started against the upgraded database and reads the selected configuration and historical restaurant through HTTP GraphQL. A second isolated database verifies a fresh full migration deployment, one configuration pointer and empty order data.

Useful manual validation queries:

```sql
SELECT count(*) FROM "IdentityUser";
SELECT id, "userId", "revokedAt" FROM "IdentitySessionFamily" ORDER BY id;
SELECT id, "familyId", "userId", "consumedAt" FROM "IdentityRefreshSession" ORDER BY id;
SELECT id, "outletId", "categoryId", "priceMinor" FROM "CatalogItem" ORDER BY id;
SELECT "userId", count(*) FROM "CustomerAddress" WHERE selected GROUP BY "userId" HAVING count(*) > 1;
SELECT p.id, p."versionId", v.version, v.document FROM "RuntimeConfigurationPointer" p JOIN "RuntimeConfigurationVersion" v ON v.id=p."versionId";
SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name;
```

## Identifier and session deployment contract

Existing UUIDv4 ids and references remain unchanged indefinitely. `kernel/ids.ts:newId()` generates UUIDv7; `parseId()` and PostgreSQL UUID columns accept both formats. The upgrade test inserts a UUIDv7 user alongside preserved UUIDv4 rows and tests both parsers. This does not prove that every write path uses newId: existing identity write paths still use randomUUID and need a separately reviewed transition. Do not claim global UUIDv7 cutover complete.

No migration changes access/refresh token formats or revokes existing sessions. Existing refresh hashes, consumed chronology and family revocation data remain byte-for-byte equal. Active sessions remain subject to existing expiry, account status and application grant checks. Authenticated address/session API reads and a valid legacy-token refresh rehearsal are still required to fully close P1; this packet verifies their persisted rows and constraints, not token continuity. No bounded compatibility window or mass revocation is introduced by these migrations.

Independent review, drift validation and the full acceptance gate remain required; this document is not approval or a gate record.

## Exact baseline object inventory

The following is the complete checked-in DDL, retained verbatim to avoid omitting any column, anonymous constraint, index or trigger. Source migration names establish creation order.

### 202610080001_foundation

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE "FoundationMigration" ("id" TEXT PRIMARY KEY, "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO "FoundationMigration" ("id") VALUES ('fb01');
```

### 202610080002_identity

```sql
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
```

### 202610080003_catalog

```sql
CREATE TABLE "CatalogMerchant" (
 "id" UUID PRIMARY KEY,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "published" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE "CatalogOutlet" (
 "id" UUID PRIMARY KEY,
 "merchantId" UUID NOT NULL REFERENCES "CatalogMerchant"("id") ON DELETE RESTRICT,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "currency" VARCHAR(3) NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
 "published" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX "CatalogOutlet_merchantId_idx" ON "CatalogOutlet"("merchantId");
CREATE INDEX "CatalogOutlet_published_id_idx" ON "CatalogOutlet"("published","id");
CREATE TABLE "CatalogCategory" (
 "id" UUID PRIMARY KEY,
 "outletId" UUID NOT NULL REFERENCES "CatalogOutlet"("id") ON DELETE RESTRICT,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "published" BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE ("id","outletId")
);
CREATE INDEX "CatalogCategory_outletId_published_id_idx" ON "CatalogCategory"("outletId","published","id");
CREATE TABLE "CatalogItem" (
 "id" UUID PRIMARY KEY,
 "outletId" UUID NOT NULL REFERENCES "CatalogOutlet"("id") ON DELETE RESTRICT,
 "categoryId" UUID NOT NULL,
 "name" VARCHAR(100) NOT NULL CHECK (length("name") BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" ~ '[^[:space:]]' AND "name" !~ '^[[:space:]]|[[:space:]]$'),
 "description" VARCHAR(2000) NOT NULL DEFAULT '',
 "priceMinor" INTEGER NOT NULL CHECK ("priceMinor" >= 0),
 "available" BOOLEAN NOT NULL DEFAULT TRUE,
 "published" BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY ("categoryId","outletId") REFERENCES "CatalogCategory"("id","outletId") ON DELETE RESTRICT
);
CREATE INDEX "CatalogItem_outletId_published_id_idx" ON "CatalogItem"("outletId","published","id");
CREATE INDEX "CatalogItem_categoryId_outletId_idx" ON "CatalogItem"("categoryId","outletId");
```

### 202610080004_addresses

```sql
CREATE TABLE "CustomerAddress" (
 "id" UUID PRIMARY KEY,
 "userId" UUID NOT NULL REFERENCES "IdentityUser"("id") ON DELETE RESTRICT,
 "label" VARCHAR(100) NOT NULL CHECK (length("label") BETWEEN 1 AND 100 AND "label" = btrim("label") AND "label" !~ '^[[:space:]]|[[:space:]]$'),
 "deliveryAddress" VARCHAR(500) NOT NULL CHECK (length("deliveryAddress") BETWEEN 1 AND 500 AND "deliveryAddress" = btrim("deliveryAddress") AND "deliveryAddress" !~ '^[[:space:]]|[[:space:]]$'),
 "details" VARCHAR(1000) NOT NULL CHECK (length("details") <= 1000 AND "details" = btrim("details") AND "details" !~ '^[[:space:]]|[[:space:]]$'),
 "longitude" DOUBLE PRECISION NOT NULL CHECK ("longitude" BETWEEN -180 AND 180),
 "latitude" DOUBLE PRECISION NOT NULL CHECK ("latitude" BETWEEN -90 AND 90),
 "selected" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX "CustomerAddress_userId_id_idx" ON "CustomerAddress"("userId",id);
CREATE UNIQUE INDEX "CustomerAddress_one_selected_per_owner" ON "CustomerAddress"("userId") WHERE selected;
```

### 202610080005_configuration

```sql
-- Public read groundwork only. No configuration or activation is seeded.
CREATE TABLE "RuntimeConfigurationVersion" (
 id UUID PRIMARY KEY,
 version INTEGER NOT NULL UNIQUE CHECK (version > 0),
 document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 65536),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT configuration_country CHECK (document ? 'countryCode' AND jsonb_typeof(document->'countryCode') = 'string' AND document->>'countryCode' ~ '^[A-Z]{2}$'),
 CONSTRAINT configuration_currency CHECK (document ? 'currency' AND jsonb_typeof(document->'currency') = 'string' AND document->>'currency' ~ '^[A-Z]{3}$'),
 CONSTRAINT configuration_precision CHECK (document ? 'currencyMinorUnits' AND jsonb_typeof(document->'currencyMinorUnits') = 'number' AND document->>'currencyMinorUnits' ~ '^[0-4]$'),
 CONSTRAINT configuration_symbol CHECK (document ? 'currencySymbol' AND jsonb_typeof(document->'currencySymbol') = 'string' AND length(document->>'currencySymbol') BETWEEN 1 AND 16 AND document->>'currencySymbol' !~ '^[[:space:]]|[[:space:]]$'),
 CONSTRAINT configuration_verification CHECK (document ?& ARRAY['skipEmailVerification','skipMobileVerification'] AND jsonb_typeof(document->'skipEmailVerification') = 'boolean' AND jsonb_typeof(document->'skipMobileVerification') = 'boolean'),
 CONSTRAINT configuration_public_keys CHECK (document - ARRAY[
 'countryCode','currency','currencySymbol','currencyMinorUnits','skipEmailVerification','skipMobileVerification',
 'webClientID','webAmplitudeApiKey','appAmplitudeApiKey','googleMapLibraries','googleColor','webSentryUrl',
 'customerAppSentryUrl','restaurantAppSentryUrl','riderAppSentryUrl','publishableKey','clientId','firebaseKey',
 'authDomain','projectId','storageBucket','msgSenderId','appId','measurementId','vapidKey','termsAndConditions','privacyPolicy'
 ]::text[] = '{}'::jsonb)
);
CREATE TABLE "RuntimeConfigurationPointer" (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 "versionId" UUID NOT NULL UNIQUE REFERENCES "RuntimeConfigurationVersion"(id) ON DELETE RESTRICT
);
CREATE FUNCTION reject_configuration_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Configuration snapshots are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER configuration_snapshot_immutable BEFORE UPDATE OR DELETE ON "RuntimeConfigurationVersion"
FOR EACH ROW EXECUTE FUNCTION reject_configuration_snapshot_mutation();
CREATE TRIGGER configuration_snapshot_no_truncate BEFORE TRUNCATE ON "RuntimeConfigurationVersion"
FOR EACH STATEMENT EXECUTE FUNCTION reject_configuration_snapshot_mutation();
```
