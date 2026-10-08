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

export type CatalogCategory = {
  __typename?: "CatalogCategory";
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
};

export type CatalogItem = {
  __typename?: "CatalogItem";
  available: Scalars["Boolean"]["output"];
  category: CatalogCategory;
  description: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
  outletId: Scalars["ID"]["output"];
  priceMinor: Scalars["Int"]["output"];
};

export type CatalogItemPage = {
  __typename?: "CatalogItemPage";
  endCursor?: Maybe<Scalars["ID"]["output"]>;
  hasNextPage: Scalars["Boolean"]["output"];
  nodes: Array<CatalogItem>;
};

export type CatalogOutlet = {
  __typename?: "CatalogOutlet";
  currency: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  merchantName: Scalars["String"]["output"];
  name: Scalars["String"]["output"];
};

export type CatalogOutletPage = {
  __typename?: "CatalogOutletPage";
  endCursor?: Maybe<Scalars["ID"]["output"]>;
  hasNextPage: Scalars["Boolean"]["output"];
  nodes: Array<CatalogOutlet>;
};

export type CustomerAddress = {
  __typename?: "CustomerAddress";
  deliveryAddress: Scalars["String"]["output"];
  details: Scalars["String"]["output"];
  id: Scalars["ID"]["output"];
  label: Scalars["String"]["output"];
  latitude: Scalars["Float"]["output"];
  longitude: Scalars["Float"]["output"];
  selected: Scalars["Boolean"]["output"];
};

export type CustomerAddressAcknowledgement = {
  __typename?: "CustomerAddressAcknowledgement";
  accepted: Scalars["Boolean"]["output"];
};

export type CustomerAddressInput = {
  deliveryAddress: Scalars["String"]["input"];
  details: Scalars["String"]["input"];
  label: Scalars["String"]["input"];
  latitude: Scalars["Float"]["input"];
  longitude: Scalars["Float"]["input"];
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
  createCustomerAddress: CustomerAddress;
  deleteCustomerAddress: CustomerAddressAcknowledgement;
  loginPassword: SessionPayload;
  logoutAllSessions: MutationAcknowledgement;
  logoutSession: MutationAcknowledgement;
  refreshSession: SessionPayload;
  registerCustomer: SessionPayload;
  selectCustomerAddress: CustomerAddress;
  updateCustomerAddress: CustomerAddress;
};

export type MutationCreateCustomerAddressArgs = {
  input: CustomerAddressInput;
};

export type MutationDeleteCustomerAddressArgs = {
  id: Scalars["ID"]["input"];
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

export type MutationSelectCustomerAddressArgs = {
  id: Scalars["ID"]["input"];
};

export type MutationUpdateCustomerAddressArgs = {
  id: Scalars["ID"]["input"];
  input: CustomerAddressInput;
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
  catalogItems: CatalogItemPage;
  catalogOutlet?: Maybe<CatalogOutlet>;
  catalogOutlets: CatalogOutletPage;
  customerAddresses: Array<CustomerAddress>;
  me: IdentityUser;
  serviceInfo: ServiceInfo;
};

export type QueryCatalogItemsArgs = {
  after?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
  outletId: Scalars["ID"]["input"];
};

export type QueryCatalogOutletArgs = {
  id: Scalars["ID"]["input"];
};

export type QueryCatalogOutletsArgs = {
  after?: InputMaybe<Scalars["ID"]["input"]>;
  limit?: InputMaybe<Scalars["Int"]["input"]>;
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
