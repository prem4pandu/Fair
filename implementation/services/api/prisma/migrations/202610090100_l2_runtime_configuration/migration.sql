-- Expand immutable runtime configuration snapshots with provider-independent
-- delivery, payment and economic policy sections. Existing snapshots remain
-- valid and immutable; activation still occurs only through pointer id 1.
ALTER TABLE "RuntimeConfigurationVersion"
  DROP CONSTRAINT configuration_public_keys;

ALTER TABLE "RuntimeConfigurationVersion"
  ADD CONSTRAINT configuration_public_keys CHECK (
    document - ARRAY[
      'countryCode','currency','currencySymbol','currencyMinorUnits','skipEmailVerification','skipMobileVerification',
      'webClientID','webAmplitudeApiKey','appAmplitudeApiKey','googleMapLibraries','googleColor','webSentryUrl',
      'customerAppSentryUrl','restaurantAppSentryUrl','riderAppSentryUrl','publishableKey','clientId','firebaseKey',
      'authDomain','projectId','storageBucket','msgSenderId','appId','measurementId','vapidKey','termsAndConditions','privacyPolicy',
      'deliveryFleets','paymentMethods','rules'
    ]::text[] = '{}'::jsonb
  ),
  ADD CONSTRAINT configuration_delivery_fleets CHECK (
    NOT (document ? 'deliveryFleets') OR jsonb_typeof(document->'deliveryFleets') = 'array'
  ),
  ADD CONSTRAINT configuration_payment_methods CHECK (
    NOT (document ? 'paymentMethods') OR jsonb_typeof(document->'paymentMethods') = 'array'
  ),
  ADD CONSTRAINT configuration_rules CHECK (
    NOT (document ? 'rules') OR jsonb_typeof(document->'rules') = 'object'
  );

-- Bootstrap only a new installation. An installation with an active snapshot
-- retains its selected country, currency, fleet, payment and policy settings.
WITH initial_snapshot AS (
  INSERT INTO "RuntimeConfigurationVersion" (id, version, document)
  SELECT
    gen_random_uuid(),
    COALESCE(MAX(version), 0) + 1,
    jsonb_build_object(
      'countryCode', 'MY',
      'currency', 'MYR',
      'currencySymbol', 'RM',
      'currencyMinorUnits', 2,
      'skipEmailVerification', false,
      'skipMobileVerification', false,
      'deliveryFleets', jsonb_build_array(jsonb_build_object(
        'id', 'own-fleet-my',
        'kind', 'OWN_FLEET',
        'enabled', true,
        'provider', null,
        'capability', 'LIVE_VERIFIED'
      )),
      'paymentMethods', jsonb_build_array(jsonb_build_object(
        'id', 'cash',
        'kind', 'CASH',
        'enabled', true,
        'provider', null,
        'capability', 'LIVE_VERIFIED'
      )),
      'rules', jsonb_build_object(
        'deliveryFeeMinor', 0,
        'serviceFeeMinor', 0,
        'taxBasisPoints', 0,
        'coreFoodCommissionBasisPoints', 0,
        'refundsEnabled', false,
        'refundWindowMinutes', 0
      )
    )
  FROM "RuntimeConfigurationVersion"
  WHERE NOT EXISTS (SELECT 1 FROM "RuntimeConfigurationPointer" WHERE id = 1)
  RETURNING id
)
INSERT INTO "RuntimeConfigurationPointer" (id, "versionId")
SELECT 1, id FROM initial_snapshot;
