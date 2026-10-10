-- L1 identity: extend the append-only audit action vocabulary with the password
-- lifecycle actions this lane records.
--
-- Preserve/backfill/cutover policy: ADDITIVE EXTENSION to a reviewed security
-- control. No allowed action is removed and no existing row is touched, so the
-- immutability triggers and every historical audit record keep their meaning.
--
-- Rollback: restore the previous CHECK without 'PASSWORD_CHANGED'. That is only
-- valid while no PASSWORD_CHANGED row exists; otherwise the rollback must be
-- paired with a deliberate retention decision for those audit rows.
ALTER TABLE "IdentityAuditEvent" DROP CONSTRAINT "IdentityAuditEvent_action_check";

ALTER TABLE "IdentityAuditEvent" ADD CONSTRAINT "IdentityAuditEvent_action_check"
  CHECK ("action" IN ('REGISTER','LOGIN','REFRESH','REFRESH_REPLAY','LOGOUT','LOGOUT_ALL','PASSWORD_CHANGED'));
