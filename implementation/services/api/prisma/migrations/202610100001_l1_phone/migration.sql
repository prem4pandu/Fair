-- L1 identity: additive phone column.
--
-- Preserve/backfill/cutover policy: ADDITIVE EXTENSION only. Every existing row
-- keeps its identifier and every existing column value; `phone` starts NULL for
-- all of them. The unique index permits any number of NULLs (Postgres treats
-- NULLs as distinct), so an account without a phone never blocks another, while
-- a registered normalized phone remains reserved for its owner.
--
-- Rollback: DROP INDEX "IdentityUser_phone_key"; ALTER TABLE "IdentityUser" DROP COLUMN "phone";
-- No data is destroyed by the rollback because the column is additive and was
-- never read by the pre-migration application.
ALTER TABLE "IdentityUser" ADD COLUMN "phone" VARCHAR(20);

CREATE UNIQUE INDEX "IdentityUser_phone_key" ON "IdentityUser"("phone");
