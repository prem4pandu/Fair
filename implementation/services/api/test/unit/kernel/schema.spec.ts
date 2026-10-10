import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { loadTypeDefs } from "../../../src/kernel/schema.js";

describe("runtime GraphQL contract", () => {
  it("composes core and every multivendor lane without duplicate roots", () => {
    const schema = buildSchema(loadTypeDefs().join("\n"));
    const query = schema.getQueryType()?.getFields() ?? {};
    const mutation = schema.getMutationType()?.getFields() ?? {};
    const subscription = schema.getSubscriptionType()?.getFields() ?? {};

    expect(mutation.metricsGeneral).toBeDefined();
    expect(query.profile).toBeDefined();
    expect(query.configuration).toBeDefined();
    expect(query.restaurant).toBeDefined();
    expect(query.userFavourite).toBeDefined();
    expect(query.orders).toBeDefined();
    expect(subscription.subscriptionOrderTracking).toBeDefined();
    expect(query.earnings).toBeDefined();
    expect(query.notifications).toBeDefined();
    expect(query.getDashboardUsers).toBeDefined();
  });

  it("serves the L12 declarations for contract completeness while excluding superseded types", () => {
    const schema = buildSchema(loadTypeDefs().join("\n"));

    // L12 roots are declared so the complete pinned contract is served; their
    // behavior stays explicit NOT_IMPLEMENTED until Wave 5 activates it.
    expect(schema.getQueryType()?.getFields().getAllfoods).toBeDefined();
    expect(schema.getMutationType()?.getFields().giveUserCredits).toBeDefined();
    expect(
      schema.getSubscriptionType()?.getFields().subscriptionPaymentSuccess,
    ).toBeDefined();
    // kernel.graphql stays excluded (core.graphql supersedes it) and the old
    // configuration type is still replaced by the L2 response type.
    expect(schema.getType("L12DeferredContract")).toBeUndefined();
    expect(schema.getType("EnategaPublicConfiguration")).toBeUndefined();
    expect(
      schema.getQueryType()?.getFields().configuration.type.toString(),
    ).toBe("ConfigurationConfiguration");
  });

  it("temporarily retains implemented non-conflicting legacy roots", () => {
    const schema = buildSchema(loadTypeDefs().join("\n"));
    const query = schema.getQueryType()?.getFields() ?? {};
    const mutation = schema.getMutationType()?.getFields() ?? {};

    expect(query.serviceInfo).toBeDefined();
    expect(query.me).toBeDefined();
    expect(query.catalogOutlets).toBeDefined();
    expect(query.customerAddresses).toBeDefined();
    expect(mutation.loginPassword).toBeDefined();
    expect(mutation.createCustomerAddress).toBeDefined();
  });
});
