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

  it("excludes the deferred single-vendor schema and old configuration type", () => {
    const schema = buildSchema(loadTypeDefs().join("\n"));

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
