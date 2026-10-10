-- L1 identity: extend the append-only audit action vocabulary with the account
-- lifecycle actions this lane records.
--
-- Preserve/backfill/cutover policy: ADDITIVE EXTENSION to a reviewed security
-- control, same shape as 202610100002_l1_audit_actions. No allowed action is
-- removed and no existing row is touched.
--
-- Rollback: restore the previous CHECK without 'DEACTIVATE', valid only while
-- no DEACTIVATE row exists.
ALTER TABLE "IdentityAuditEvent" DROP CONSTRAINT "IdentityAuditEvent_action_check";

ALTER TABLE "IdentityAuditEvent" ADD CONSTRAINT "IdentityAuditEvent_action_check"
  CHECK ("action" IN ('REGISTER','LOGIN','REFRESH','REFRESH_REPLAY','LOGOUT','LOGOUT_ALL','PASSWORD_CHANGED','DEACTIVATE'));
