-- Deterministic historical UUIDv4 rows, authored against migrations 001–005 only.
UPDATE "FoundationMigration" SET "appliedAt"='2026-10-01T00:00:00Z';
INSERT INTO "IdentityUser" (id,email,"displayName",status,"emailVerified",roles,"createdAt") VALUES
('11111111-1111-4111-8111-111111111111','active@example.test','Active Customer','ACTIVE',true,ARRAY['CUSTOMER'],'2026-10-01T00:00:00Z'),
('22222222-2222-4222-8222-222222222222','inactive@example.test','Suspended Admin','SUSPENDED',false,ARRAY['ADMIN'],'2026-10-01T00:00:00Z');
INSERT INTO "IdentityCredential" VALUES ('11111111-1111-4111-8111-111111111111','$argon2id$fixture-not-a-login-secret');
INSERT INTO "IdentityApplicationGrant" VALUES ('22222222-2222-4222-8222-222222222222','ADMIN',false);
INSERT INTO "IdentitySessionFamily" VALUES
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','CUSTOMER','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z',NULL),
('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','ADMIN','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z','2026-10-02T00:00:00Z');
INSERT INTO "IdentityRefreshSession" VALUES
('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',repeat('a',64),'2026-10-01T01:00:00Z',NULL),
('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',repeat('b',64),'2026-10-01T01:00:00Z','2026-10-02T00:00:00Z');
INSERT INTO "IdentityAuditEvent" VALUES ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','LOGIN','SUCCESS','2026-10-01T01:00:00Z');
INSERT INTO "CatalogMerchant" VALUES ('88888888-8888-4888-8888-888888888888','Historical Merchant',true);
INSERT INTO "CatalogOutlet" VALUES ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888','Historical Outlet','SGD',true);
INSERT INTO "CatalogCategory" VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999','Historical Category',true);
INSERT INTO "CatalogItem" VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','99999999-9999-4999-8999-999999999999','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Historical Food','Preserve description',1299,true,true);
INSERT INTO "CustomerAddress" VALUES
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','Home','10 Historical Road','Floor 2',103.8,1.3,true),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','Office','20 Historical Road','',103.9,1.4,false);
INSERT INTO "RuntimeConfigurationVersion" (id,version,document,"createdAt") VALUES
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',1,'{"countryCode":"SG","currency":"SGD","currencySymbol":"S$","currencyMinorUnits":2,"skipEmailVerification":false,"skipMobileVerification":false}','2026-10-01T00:00:00Z'),
('ffffffff-ffff-4fff-8fff-ffffffffffff',2,'{"countryCode":"SG","currency":"SGD","currencySymbol":"S$","currencyMinorUnits":2,"skipEmailVerification":false,"skipMobileVerification":true}','2026-10-02T00:00:00Z');
INSERT INTO "RuntimeConfigurationPointer" VALUES (1,'ffffffff-ffff-4fff-8fff-ffffffffffff');
