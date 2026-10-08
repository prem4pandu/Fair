import { expect, test } from "@playwright/test";

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

test("unknown checkout document fails schema validation without order data", async ({
  request,
}) => {
  const response = await request.post("/graphql", {
    data: { query: "mutation { placeOrder { _id } }" },
  });
  const body = await response.json();
  expect(body.data).toBeUndefined();
  expect(body.errors.length).toBeGreaterThan(0);
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
