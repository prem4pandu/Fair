import { z } from "zod";
export const applicationSchema = z.enum([
  "CUSTOMER",
  "MERCHANT",
  "RIDER",
  "ADMIN",
]);
export type LoginApplication = z.infer<typeof applicationSchema>;
export const identityRoleSchema = z.enum([
  "CUSTOMER",
  "MERCHANT_STAFF",
  "RIDER",
  "ADMIN",
]);
export const applicationRole = {
  CUSTOMER: "CUSTOMER",
  MERCHANT: "MERCHANT_STAFF",
  RIDER: "RIDER",
  ADMIN: "ADMIN",
} as const;
export const emailSchema = z
  .string()
  .max(512)
  .transform((v) => v.trim().normalize("NFKC").toLowerCase())
  .pipe(z.email().max(254));
export const passwordSchema = z.string().min(12).max(128);
export const registrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();
export const passwordLoginSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    application: applicationSchema,
  })
  .strict();
export const accessTokenSchema = z
  .string()
  .max(3000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const refreshTokenSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,
  );
export const logoutInputSchema = z
  .object({ refreshToken: refreshTokenSchema })
  .strict();
export const refreshInputSchema = z
  .object({ refreshToken: refreshTokenSchema, application: applicationSchema })
  .strict();
export const identityUserSchema = z
  .object({
    id: z.uuid().refine((v) => v === v.toLowerCase()),
    email: z.email().max(254),
    displayName: z.string().min(1).max(100),
    roles: z
      .array(identityRoleSchema)
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    emailVerificationStatus: z.enum(["UNVERIFIED", "VERIFIED"]),
  })
  .strict();
export const sessionPayloadSchema = z
  .object({
    application: applicationSchema,
    accessToken: accessTokenSchema,
    refreshToken: refreshTokenSchema,
    accessTokenExpiresInSeconds: z.number().int().min(1).max(300),
    refreshTokenExpiresInSeconds: z.number().int().min(1).max(2592000),
    user: identityUserSchema,
  })
  .strict();
export type IdentityUser = z.infer<typeof identityUserSchema>;
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;
export const identityErrorCodeSchema = z.enum([
  "BAD_USER_INPUT",
  "AUTHENTICATION_FAILED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "AUTH_DISABLED",
  "ACCOUNT_EXISTS",
]);
export const userFields = "id email displayName roles emailVerificationStatus";
export const sessionFields = `application accessToken refreshToken accessTokenExpiresInSeconds refreshTokenExpiresInSeconds user { ${userFields} }`;
export const identityOperations = {
  registerCustomer: `mutation RegisterCustomer($input:CustomerRegistrationInput!){registerCustomer(input:$input){${sessionFields}}}`,
  loginPassword: `mutation LoginPassword($input:PasswordLoginInput!){loginPassword(input:$input){${sessionFields}}}`,
  refreshSession: `mutation RefreshSession($input:SessionRefreshInput!){refreshSession(input:$input){${sessionFields}}}`,
  logoutSession:
    "mutation LogoutSession($input:SessionLogoutInput!){logoutSession(input:$input){accepted}}",
  logoutAllSessions:
    "mutation LogoutAllSessions($application:LoginApplication!){logoutAllSessions(application:$application){accepted}}",
  me: `query Me($application:LoginApplication!){me(application:$application){${userFields}}}`,
} as const;

export type {
  Query as GeneratedIdentityQuery,
  Mutation as GeneratedIdentityMutation,
} from "./generated.js";
