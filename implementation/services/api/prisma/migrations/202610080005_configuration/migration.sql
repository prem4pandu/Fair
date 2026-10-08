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
