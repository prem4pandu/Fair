import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { APPLICATION } from "./application";
import {
  authPost,
  authMe,
  boundedJson,
  endpoint,
  names,
  sameOrigin,
  webOrigin,
} from "./auth";
const id = "b061bf76-7a6d-41ae-89c6-f032fe814b8b";
const refresh = id + "." + "A".repeat(43);
const user = {
  id,
  email: "test@example.com",
  displayName: "Test",
  roles: [
    { CUSTOMER: "CUSTOMER", MERCHANT: "MERCHANT_STAFF", ADMIN: "ADMIN" }[
      APPLICATION as "CUSTOMER" | "MERCHANT" | "ADMIN"
    ],
  ],
  emailVerificationStatus: "UNVERIFIED",
};
const payload = {
  application: APPLICATION,
  accessToken: "abc.def.ghi",
  refreshToken: refresh,
  accessTokenExpiresInSeconds: 300,
  refreshTokenExpiresInSeconds: 2592000,
  user,
};
function request(body: unknown = {}, extra: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3100/api/auth/login", {
    method: "POST",
    headers: {
      host: "localhost:3100",
      origin: "http://localhost:3100",
      "content-type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("FAIRBITE_WEB_ORIGIN", "http://localhost:3100");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("web session boundary", () => {
  it("rejects wrong-app session payload even for dual-role users", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              loginPassword: {
                ...payload,
                application:
                  APPLICATION === "CUSTOMER" ? "MERCHANT" : "CUSTOMER",
                user: {
                  ...user,
                  roles: ["CUSTOMER", "MERCHANT_STAFF", "ADMIN"],
                },
              },
            },
          }),
        ),
      ),
    );
    const result = await authPost(
      request({ email: "test@example.com", password: "long-password-test" }),
      "login",
    );
    expect(result.status).toBe(403);
    expect(result.cookies.get(names().access)).toBeUndefined();
    expect(result.cookies.get(names().refresh)).toBeUndefined();
    expect(await result.text()).not.toContain(payload.accessToken);
  });
  it("sends fixed consumer application on refresh and account operations", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    const requestBackend = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { refreshSession: payload } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { me: user } })),
      );
    vi.stubGlobal("fetch", requestBackend);
    const refreshed = await authPost(
      request({}, { cookie: `${names().refresh}=${refresh}` }),
      "refresh",
    );
    expect(refreshed.status).toBe(200);
    const result = await authMe(
      new NextRequest("http://localhost:3100/api/auth/me", {
        headers: { cookie: `${names().access}=${payload.accessToken}` },
      }),
    );
    expect(result.status).toBe(200);
    expect(
      JSON.parse(requestBackend.mock.calls[0][1].body).variables.input
        .application,
    ).toBe(APPLICATION);
    expect(
      JSON.parse(requestBackend.mock.calls[1][1].body).variables.application,
    ).toBe(APPLICATION);
  });

  it("uses configured origin across proxy-normalized request URLs", () => {
    vi.stubEnv("FAIRBITE_WEB_ORIGIN", "https://app.example");
    expect(() =>
      sameOrigin(
        new Request("http://internal:3100/api/auth/login", {
          headers: {
            host: "app.example",
            origin: "https://app.example",
            "x-forwarded-host": "evil.example",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://evil.example/api/auth/login", {
          headers: {
            host: "evil.example",
            origin: "https://evil.example",
            "x-forwarded-host": "app.example",
          },
        }),
      ),
    ).toThrow();
  });
  it("fails closed without a canonical trusted origin", () => {
    for (const origin of [
      "",
      "bad",
      "https://u:p@app.example",
      "https://app.example/",
      "https://app.example/path",
      "https://app.example?x=1",
      "https://app.example#x",
      "http://remote.example",
    ]) {
      expect(() => webOrigin(origin)).toThrow();
    }
    vi.stubEnv("NODE_ENV", "production");
    expect(() => webOrigin("http://localhost:3100")).toThrow();
    expect(webOrigin("https://app.example").origin).toBe("https://app.example");
  });

  it("rejects inherited and unapproved upstream error codes", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    for (const code of [
      "toString",
      "__proto__",
      "constructor",
      "CSRF_REJECTED",
      "UNKNOWN",
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              errors: [{ message: "private sentinel", extensions: { code } }],
            }),
          ),
        ),
      );
      const result = await authPost(
        request({ email: "test@example.com", password: "long-password-test" }),
        "login",
      );
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({
        code: "SERVICE_UNAVAILABLE",
        message: "The identity service is unavailable.",
      });
    }
  });

  it("requires exact origin and host", () => {
    for (const extra of [
      { origin: "https://evil.example", host: "localhost:3100" },
      { host: "evil.example", origin: "http://localhost:3100" },
      { origin: "", host: "localhost:3100" },
    ])
      expect(() => sameOrigin(request({}, extra))).toThrow();
  });
  it("rejects missing, unsafe and credential-bearing endpoints", () => {
    for (const value of [
      "",
      "bad",
      "http://api.example/graphql",
      "https://u:p@example.com/graphql",
      "https://example.com/graphql?x=1",
      "https://example.com/graphql#x",
      "https://example.com/wrong",
    ])
      expect(() => endpoint(value)).toThrow();
  });
  it("bounds browser body bytes", async () => {
    await expect(
      boundedJson(new Response("x".repeat(16385)).body),
    ).rejects.toThrow();
  });
  it("rejects role injection before contacting backend", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const res = await authPost(
      request({
        email: "test@example.com",
        password: "long-password-test",
        application: "ADMIN",
      }),
      "login",
    );
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sets role-scoped HttpOnly cookies and never returns tokens", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { loginPassword: payload } })),
      );
    vi.stubGlobal("fetch", fetch);
    const res = await authPost(
      request({ email: "test@example.com", password: "long-password-test" }),
      "login",
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("accessToken");
    expect(body).not.toContain(refresh);
    expect(res.cookies.get(names().access)?.value).toBe(payload.accessToken);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const options = fetch.mock.calls[0][1];
    expect(JSON.parse(options.body).variables.input.application).toBe(
      APPLICATION,
    );
    expect(options.redirect).toBe("error");
  });
  it("rejects wrong role and excessive token expiry", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    for (const invalid of [
      {
        ...payload,
        user: {
          ...user,
          roles: [APPLICATION === "CUSTOMER" ? "ADMIN" : "CUSTOMER"],
        },
      },
      { ...payload, accessTokenExpiresInSeconds: 301 },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ data: { loginPassword: invalid } })),
          ),
      );
      const res = await authPost(
        request({ email: "test@example.com", password: "long-password-test" }),
        "login",
      );
      expect(res.status).toBe(
        invalid.accessTokenExpiresInSeconds === 301 ? 503 : 403,
      );
      expect(res.cookies.get(names().access)).toBeUndefined();
    }
  });
  it("sanitizes outage and upstream error messages", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [
              {
                message: "private sentinel",
                extensions: { code: "AUTHENTICATION_FAILED" },
              },
            ],
          }),
        ),
      ),
    );
    const res = await authPost(
      request({ email: "test@example.com", password: "long-password-test" }),
      "login",
    );
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("private sentinel");
  });
  it("clears browser cookies during logout outage and reports no revocation proof", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private sentinel")),
    );
    const res = await authPost(
      request({}, { cookie: `${names().refresh}=${refresh}` }),
      "logout",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await res.json()).serverRevoked).toBe(false);
  });
  it("does not publicly register privileged roles", async () => {
    if (APPLICATION === "CUSTOMER") return;
    const res = await authPost(
      request({
        email: "test@example.com",
        password: "long-password-test",
        displayName: "Test",
      }),
      "register",
    );
    expect(res.status).toBe(403);
  });
  it("requires access session for private me", async () => {
    const res = await authMe(
      new NextRequest("http://localhost:3100/api/auth/me"),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
