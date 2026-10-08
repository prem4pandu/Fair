import { expect, test } from "@playwright/test";

// Backend boundary evidence only: the API runs with deliberately unavailable
// dependencies. Original Enatega journeys have their own gates and are not
// exercised here.

test("browser can inspect API liveness while readiness fails on unavailable dependencies", async ({
  page,
  request,
}) => {
  const response = await page.goto("/health/live");
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toBeTruthy();
  expect((await request.get("/health/ready")).status()).toBe(503);
});

test("GraphQL reports unavailable infrastructure without fabricated readiness", async ({
  request,
}) => {
  const response = await request.post("/graphql", {
    data: { query: "{ serviceInfo { name status } }" },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).data.serviceInfo.status).toBe("unavailable");
});

test("an undeclared root is rejected by schema validation without data", async ({
  request,
}) => {
  const response = await request.post("/graphql", {
    data: { query: "mutation { undeclaredFairbiteRoot { _id } }" },
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.data).toBeUndefined();
  expect(body.errors.length).toBeGreaterThan(0);
  expect(body.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
  // The rejection must explain itself without echoing a stack trace to clients.
  expect(body.errors[0].message).not.toContain("at ");
});

test("a declared but unbuilt operation fails explicitly instead of returning data", async ({
  request,
}) => {
  // placeOrder is part of the pinned Enatega contract but has no resolver yet.
  // It must return an explicit NOT_IMPLEMENTED error, never fabricated success.
  const response = await request.post("/graphql", {
    data: { query: "mutation { placeOrder { _id } }" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data?.placeOrder ?? null).toBeNull();
  expect(body.errors.length).toBeGreaterThan(0);
  expect(body.errors[0].extensions.code).toBe("NOT_IMPLEMENTED");
  expect(body.errors[0].message).toContain("not available yet");
});

test("malformed requests and unauthorized origins remain bounded", async ({
  request,
}) => {
  const response = await request.post("/graphql", {
    headers: {
      "content-type": "application/json",
      Origin: "https://evil.example",
    },
    data: '{"query": sensitive-marker',
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  expect(await response.text()).not.toContain("sensitive-marker");
});
