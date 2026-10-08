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
const snapshot = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1).max(2147483647),
  document: publicConfigurationDocument,
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
    return {
      _id: id,
      version,
      ...document,
      // The corresponding capabilities are not implemented in this packet.
      deliveryRate: null,
      costType: null,
      twilioEnabled: false,
      checkoutAvailable: false,
      enableCustomerDemoMode: false,
      customerDemoZoneId: null,
    };
  }
}
