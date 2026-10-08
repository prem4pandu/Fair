import { GraphQLError } from "graphql";
import type { Pool } from "pg";
import { z } from "zod";
import { countryCodes } from "./regions.js";
const currencyCodes = new Set(Intl.supportedValuesOf("currency"));

const optionalText = z.string().trim().min(1).max(2048).nullable().optional();
const publicUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  })
  .nullable()
  .optional();
// Sentry client DSNs use a public key as the username, never a password.
const sentryDsn = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^[a-f0-9]{32}$/i.test(url.username) &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[0-9]+$/.test(url.pathname)
    );
  })
  .nullable()
  .optional();
const stripePublicKey = z
  .string()
  .regex(/^pk_(test|live)_[A-Za-z0-9]{8,256}$/)
  .nullable()
  .optional();
const publicFields = {
  webClientID: optionalText,
  webAmplitudeApiKey: optionalText,
  appAmplitudeApiKey: optionalText,
  googleMapLibraries: optionalText,
  googleColor: optionalText,
  webSentryUrl: sentryDsn,
  customerAppSentryUrl: sentryDsn,
  restaurantAppSentryUrl: sentryDsn,
  riderAppSentryUrl: sentryDsn,
  publishableKey: stripePublicKey,
  clientId: optionalText,
  firebaseKey: optionalText,
  authDomain: optionalText,
  projectId: optionalText,
  storageBucket: optionalText,
  msgSenderId: optionalText,
  appId: optionalText,
  measurementId: optionalText,
  vapidKey: optionalText,
  termsAndConditions: publicUrl,
  privacyPolicy: publicUrl,
};
// This document contains public settings only. Unknown fields (including credentials)
// invalidate the entire snapshot; none are silently stripped or reflected.
export const publicConfigurationDocument = z
  .strictObject({
    countryCode: z.string().refine((value) => countryCodes.has(value)),
    currency: z.string().refine((value) => currencyCodes.has(value)),
    currencySymbol: z.string().trim().min(1).max(16),
    currencyMinorUnits: z.number().int().min(0).max(4),
    skipEmailVerification: z.boolean(),
    skipMobileVerification: z.boolean(),
    ...publicFields,
  })
  .refine(
    (value) =>
      currencyCodes.has(value.currency) &&
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: value.currency,
      }).resolvedOptions().maximumFractionDigits === value.currencyMinorUnits,
    "Currency precision must match the supported currency",
  );

const capabilityState = z.enum([
  "DISABLED",
  "CONFIGURED",
  "SANDBOX_VERIFIED",
  "LIVE_VERIFIED",
]);

const deliveryFleet = z
  .strictObject({
    id: z.string().trim().min(1).max(64),
    kind: z.enum(["OWN_FLEET", "EXTERNAL"]),
    enabled: z.boolean(),
    provider: z.string().trim().min(1).max(64).nullable(),
    capability: capabilityState,
  })
  .refine(
    (fleet) =>
      fleet.kind === "EXTERNAL"
        ? fleet.provider !== null
        : fleet.provider === null,
    "External fleets require a provider; own fleets cannot name one",
  );

const paymentMethod = z
  .strictObject({
    id: z.string().trim().min(1).max(64),
    kind: z.enum(["CASH", "CARD", "WALLET"]),
    enabled: z.boolean(),
    provider: z.string().trim().min(1).max(64).nullable(),
    capability: capabilityState,
  })
  .refine(
    (method) =>
      method.kind === "CASH"
        ? method.provider === null
        : method.provider !== null,
    "Card and wallet methods require a provider; cash cannot name one",
  );

const policyRules = z
  .strictObject({
    deliveryFeeMinor: z.number().int().min(0).max(2_147_483_647),
    serviceFeeMinor: z.number().int().min(0).max(2_147_483_647),
    taxBasisPoints: z.number().int().min(0).max(10_000),
    coreFoodCommissionBasisPoints: z.literal(0),
    refundsEnabled: z.boolean(),
    refundWindowMinutes: z.number().int().min(0).max(525_600),
  })
  .optional();

/**
 * Versioned runtime settings. Provider capability is recorded separately from
 * enablement so saving a provider name can never advertise working checkout or
 * delivery. Secrets are references owned by provider modules and are not part
 * of this public configuration document.
 */
export const runtimeConfigurationDocument =
  publicConfigurationDocument.safeExtend({
    deliveryFleets: z.array(deliveryFleet).max(32).optional(),
    paymentMethods: z.array(paymentMethod).max(32).optional(),
    rules: policyRules,
  });
const snapshot = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1).max(2147483647),
  document: runtimeConfigurationDocument,
});
const unavailable = (code: string) =>
  new GraphQLError("Configuration unavailable", {
    extensions: { code },
  });
export class ConfigurationService {
  constructor(private readonly pool: Pick<Pool, "query">) {}
  async read() {
    let rows: unknown[];
    try {
      rows = (
        await this.pool.query(
          'SELECT v.id, v.version, v.document FROM "RuntimeConfigurationPointer" p JOIN "RuntimeConfigurationVersion" v ON v.id = p."versionId" WHERE p.id = 1',
        )
      ).rows;
    } catch {
      throw unavailable("SERVICE_UNAVAILABLE");
    }
    if (rows.length !== 1) throw unavailable("CONFIGURATION_UNAVAILABLE");
    const parsed = snapshot.safeParse(rows[0]);
    if (!parsed.success) throw unavailable("CONFIGURATION_UNAVAILABLE");
    const { id, version, document } = parsed.data;
    const { deliveryFleets, paymentMethods, rules, ...publicDocument } =
      document;
    void deliveryFleets;
    const verifiedPayment = paymentMethods?.some(
      (method) =>
        method.enabled &&
        (method.capability === "SANDBOX_VERIFIED" ||
          method.capability === "LIVE_VERIFIED"),
    );
    const deliveryFeeMinor = rules?.deliveryFeeMinor;
    return {
      _id: id,
      version,
      ...publicDocument,
      // Provider-specific public flags remain disabled until their modules
      // independently verify the configured capability.
      deliveryRate:
        deliveryFeeMinor === undefined
          ? null
          : deliveryFeeMinor / 10 ** publicDocument.currencyMinorUnits,
      costType: deliveryFeeMinor === undefined ? null : "fixed",
      twilioEnabled: false,
      checkoutAvailable: verifiedPayment ?? false,
      enableCustomerDemoMode: false,
      customerDemoZoneId: null,
    };
  }
}
