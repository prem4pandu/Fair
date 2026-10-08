import { describe, expect, it, vi } from "vitest";
import { NativeIdentityClient, type TokenStore } from "./identity-client";
import type { ConnectionRequest } from "./connection";
const id = "123e4567-e89b-42d3-a456-426614174000";
const refresh = "123e4567-e89b-42d3-a456-426614174001." + "A".repeat(43);
const user = {
  id,
  email: "test@example.com",
  displayName: "Test",
  roles: ["CUSTOMER"],
  emailVerificationStatus: "UNVERIFIED",
};
const payload = {
  application: "CUSTOMER",
  user,
  accessToken: "eyJ.a.b",
  refreshToken: refresh,
  accessTokenExpiresInSeconds: 300,
  refreshTokenExpiresInSeconds: 2592000,
};
class Store implements TokenStore {
  values = new Map<string, string>();
  async getItemAsync(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string) {
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string) {
    this.values.delete(key);
  }
}
function response(field: string, value: unknown) {
  return new Response(JSON.stringify({ data: { [field]: value } }));
}
function setup(
  application: "CUSTOMER" | "MERCHANT" | "RIDER" = "CUSTOMER",
  store = new Store(),
) {
  const request = vi.fn<ConnectionRequest>();
  const client = new NativeIdentityClient(
    "https://own.example/graphql",
    application,
    store,
    request,
  );
  return { client, request, store };
}
describe("native identity session safety", () => {
  it("clears an ambiguously persisted credential when secure storage write rejects", async () => {
    class PartialStore extends Store {
      async setItemAsync(key: string, value: string) {
        await super.setItemAsync(key, value);
        throw new Error("partial write");
      }
    }
    const store = new PartialStore();
    const { client, request } = setup("CUSTOMER", store);
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await expect(
      client.login("test@example.com", "long password 123"),
    ).rejects.toThrow("secure storage");
    expect(client.user).toBeNull();
    expect(store.values.size).toBe(0);
  });
  it("bootstrap rotates refresh then validates account with the memory access token", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    const restored = new NativeIdentityClient(
      "https://own.example/graphql",
      "CUSTOMER",
      store,
      request,
    );
    request
      .mockResolvedValueOnce(response("refreshSession", payload))
      .mockResolvedValueOnce(response("me", user));
    expect(await restored.bootstrap()).toEqual(user);
    expect(request.mock.calls[2][1].headers).toMatchObject({
      authorization: `Bearer ${payload.accessToken}`,
    });
  });
  it("refuses hard-expired family without sending the refresh secret", async () => {
    let now = 1000;
    const store = new Store();
    const request = vi.fn<ConnectionRequest>().mockResolvedValueOnce(
      response("loginPassword", {
        ...payload,
        refreshTokenExpiresInSeconds: 1,
      }),
    );
    const client = new NativeIdentityClient(
      "https://own.example/graphql",
      "CUSTOMER",
      store,
      request,
      () => now,
    );
    await client.login("test@example.com", "long password 123");
    now = 2001;
    await expect(client.refresh()).rejects.toThrow("expired");
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.values.size).toBe(0);
  });
  it("does not accept account role loss or account identity changes", async () => {
    for (const value of [
      { ...user, roles: ["RIDER"] },
      { ...user, id: "123e4567-e89b-42d3-a456-426614174099" },
    ]) {
      const { client, request } = setup();
      request.mockResolvedValueOnce(response("loginPassword", payload));
      await client.login("test@example.com", "long password 123");
      request.mockResolvedValueOnce(response("me", value));
      await expect(client.account()).rejects.toThrow();
      expect(client.user).toBeNull();
    }
  });
  it("suppresses late refresh after logout and revokes the original family", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    let release!: (r: Response) => void;
    request
      .mockImplementationOnce(
        async () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(response("logoutSession", { accepted: true }));
    const refreshing = client.refresh();
    const assertion = expect(refreshing).rejects.toThrow("cancelled");
    for (let i = 0; i < 8 && !release; i++) await Promise.resolve();
    const logout = client.logout();
    release(response("refreshSession", payload));
    await assertion;
    await logout;
    expect(request.mock.calls.at(-1)?.[1].body).toContain("logoutSession");
    expect(client.user).toBeNull();
    expect(store.values.size).toBe(0);
  });

  it("uses fixed application, memory access and endpoint/application secure namespace", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    const call = JSON.parse(request.mock.calls[0][1].body as string);
    expect(call.variables.input.application).toBe("CUSTOMER");
    const [[key, value]] = [...store.values];
    expect(key).toContain("fairbite.refresh.CUSTOMER.");
    expect(value).not.toContain(payload.accessToken);
    expect(value).not.toContain("long password");
    const different = new NativeIdentityClient(
      "https://other.example/graphql",
      "CUSTOMER",
      store,
      request,
    );
    expect(await different.bootstrap()).toBeNull();
    const merchant = new NativeIdentityClient(
      "https://own.example/graphql",
      "MERCHANT",
      store,
      request,
    );
    expect(await merchant.bootstrap()).toBeNull();
  });
  it("rejects wrong-app roles, malformed payload, GraphQL error and unsafe configuration", async () => {
    expect(
      () =>
        new NativeIdentityClient(
          "http://remote.example/graphql",
          "CUSTOMER",
          new Store(),
          vi.fn(),
        ),
    ).toThrow();
    for (const value of [
      { ...payload, application: "ADMIN" },
      { ...payload, user: { ...user, roles: ["RIDER"] } },
      { ...payload, accessToken: "garbage" },
      { ...payload, extra: "unapproved" },
    ]) {
      const { client, request, store } = setup();
      request.mockResolvedValueOnce(response("loginPassword", value));
      await expect(
        client.login("test@example.com", "long password 123"),
      ).rejects.toThrow();
      expect(store.values.size).toBe(0);
    }
    const { client, request } = setup();
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: "private detail" }] })),
    );
    await expect(
      client.login("test@example.com", "long password 123"),
    ).rejects.toThrow("Identity request was rejected");
  });
  it("allows registration only for customers and never marks email verified itself", async () => {
    const { client, request } = setup("MERCHANT");
    await expect(
      client.register("test@example.com", "long password 123", "Test"),
    ).rejects.toThrow("unavailable");
    expect(request).not.toHaveBeenCalled();
    const customer = setup();
    customer.request.mockResolvedValueOnce(
      response("registerCustomer", payload),
    );
    expect(
      (
        await customer.client.register(
          "test@example.com",
          "long password 123",
          "Test",
        )
      ).emailVerificationStatus,
    ).toBe("UNVERIFIED");
  });
  it("single-flights refresh and preserves original hard family expiry", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    const before = JSON.parse([...store.values.values()][0]).expiresAt;
    request.mockResolvedValueOnce(response("refreshSession", payload));
    const one = client.refresh();
    const two = client.refresh();
    expect(one).toBe(two);
    await Promise.all([one, two]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse([...store.values.values()][0]).expiresAt).toBe(before);
  });
  it("logout suppresses late login completion and clears any partially persisted credentials", async () => {
    const { client, request, store } = setup();
    let release!: (value: Response) => void;
    request
      .mockImplementationOnce(
        async () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(response("logoutSession", { accepted: true }));
    const login = client.login("test@example.com", "long password 123");
    const rejected = expect(login).rejects.toThrow("cancelled");
    await Promise.resolve();
    await Promise.resolve();
    const logout = client.logout();
    release(response("loginPassword", payload));
    await rejected;
    await logout;
    expect(client.user).toBeNull();
    expect(store.values.size).toBe(0);
  });
  it("clears local tokens if refresh/account fails and does not restore wrong refreshed account", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    request.mockResolvedValueOnce(
      response("refreshSession", {
        ...payload,
        user: { ...user, id: "123e4567-e89b-42d3-a456-426614174099" },
      }),
    );
    await expect(client.refresh()).rejects.toThrow("account is invalid");
    expect(client.user).toBeNull();
    expect(store.values.size).toBe(0);
  });
  it("fails closed on corrupt storage and storage failure", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    store.values.set([...store.values.keys()][0], "{broken");
    await expect(client.refresh()).rejects.toThrow("invalid");
    expect(store.values.size).toBe(0);
    const broken: TokenStore = {
      getItemAsync: async () => null,
      setItemAsync: async () => {
        throw new Error("write failure");
      },
      deleteItemAsync: async () => {},
    };
    const failed = setup("CUSTOMER", broken as Store);
    failed.request.mockResolvedValueOnce(response("loginPassword", payload));
    await expect(
      failed.client.login("test@example.com", "long password 123"),
    ).rejects.toThrow();
    expect(failed.client.user).toBeNull();
  });
  it("clears local session despite server logout outage without claiming revocation", async () => {
    const { client, request, store } = setup();
    request.mockResolvedValueOnce(response("loginPassword", payload));
    await client.login("test@example.com", "long password 123");
    request.mockRejectedValueOnce(new Error("private outage"));
    await expect(client.logout()).rejects.toThrow("unavailable");
    expect(client.user).toBeNull();
    expect(store.values.size).toBe(0);
  });
  it("attempts remote revocation when secure storage deletion fails", async () => {
    class DeleteFailStore extends Store {
      async deleteItemAsync() {
        throw new Error("delete failure");
      }
    }
    const { client, request } = setup("CUSTOMER", new DeleteFailStore());
    request
      .mockResolvedValueOnce(response("loginPassword", payload))
      .mockResolvedValueOnce(response("logoutSession", { accepted: true }));
    await client.login("test@example.com", "long password 123");
    await expect(client.logout()).rejects.toThrow("secure storage");
    expect(request.mock.calls.at(-1)?.[1].body).toContain("logoutSession");
    expect(client.user).toBeNull();
  });
});
