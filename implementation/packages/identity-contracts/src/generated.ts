export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
};

export type CustomerRegistrationInput = {
  displayName: Scalars["String"]["input"];
  email: Scalars["String"]["input"];
  password: Scalars["String"]["input"];
};

export type EmailVerificationStatus = "UNVERIFIED" | "VERIFIED";

export type IdentityRole = "ADMIN" | "CUSTOMER" | "MERCHANT_STAFF" | "RIDER";

export type IdentityUser = {
  __typename?: "IdentityUser";
  displayName: Scalars["String"]["output"];
  email: Scalars["String"]["output"];
  emailVerificationStatus: EmailVerificationStatus;
  id: Scalars["ID"]["output"];
  roles: Array<IdentityRole>;
};

export type LoginApplication = "ADMIN" | "CUSTOMER" | "MERCHANT" | "RIDER";

export type Mutation = {
  __typename?: "Mutation";
  loginPassword: SessionPayload;
  logoutAllSessions: MutationAcknowledgement;
  logoutSession: MutationAcknowledgement;
  refreshSession: SessionPayload;
  registerCustomer: SessionPayload;
};

export type MutationLoginPasswordArgs = {
  input: PasswordLoginInput;
};

export type MutationLogoutAllSessionsArgs = {
  application: LoginApplication;
};

export type MutationLogoutSessionArgs = {
  input: SessionLogoutInput;
};

export type MutationRefreshSessionArgs = {
  input: SessionRefreshInput;
};

export type MutationRegisterCustomerArgs = {
  input: CustomerRegistrationInput;
};

export type MutationAcknowledgement = {
  __typename?: "MutationAcknowledgement";
  accepted: Scalars["Boolean"]["output"];
};

export type PasswordLoginInput = {
  application: LoginApplication;
  email: Scalars["String"]["input"];
  password: Scalars["String"]["input"];
};

export type Query = {
  __typename?: "Query";
  me: IdentityUser;
  serviceInfo: ServiceInfo;
};

export type QueryMeArgs = {
  application: LoginApplication;
};

export type ServiceInfo = {
  __typename?: "ServiceInfo";
  name: Scalars["String"]["output"];
  status: Scalars["String"]["output"];
};

export type SessionLogoutInput = {
  refreshToken: Scalars["String"]["input"];
};

export type SessionPayload = {
  __typename?: "SessionPayload";
  accessToken: Scalars["String"]["output"];
  accessTokenExpiresInSeconds: Scalars["Int"]["output"];
  application: LoginApplication;
  refreshToken: Scalars["String"]["output"];
  refreshTokenExpiresInSeconds: Scalars["Int"]["output"];
  user: IdentityUser;
};

export type SessionRefreshInput = {
  application: LoginApplication;
  refreshToken: Scalars["String"]["input"];
};
