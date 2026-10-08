import {
  identityOperations,
  identityUserSchema,
  sessionPayloadSchema,
  refreshTokenSchema,
  passwordLoginSchema,
  registrationSchema,
  type IdentityUser,
  type SessionPayload,
  type LoginApplication,
} from "@fairbite/identity-contracts";
import { apiUrl, type ConnectionRequest } from "./connection";
export interface TokenStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
const requiredRole = {
  CUSTOMER: "CUSTOMER",
  MERCHANT: "MERCHANT_STAFF",
  RIDER: "RIDER",
  ADMIN: "ADMIN",
} as const;
export class NativeIdentityClient {
  user: IdentityUser | null = null;
  private access: string | null = null;
  private accessUntil = 0;
  private generation = 0;
  private active = new Set<AbortController>();
  private serial: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<IdentityUser> | null = null;
  private readonly endpoint: string;
  private readonly key: string;
  constructor(
    raw: string | undefined,
    private readonly application: LoginApplication,
    private readonly store: TokenStore,
    private readonly request: ConnectionRequest,
    private readonly now = Date.now,
  ) {
    this.endpoint = apiUrl(raw);
    if (this.endpoint.length > 512) throw new Error("Backend URL is too long.");
    this.key = `fairbite.refresh.${application}.${Array.from(new TextEncoder().encode(this.endpoint), (n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work, work);
    this.serial = result.catch(() => undefined);
    return result;
  }
  private async readStored() {
    try {
      return await this.store.getItemAsync(this.key);
    } catch {
      throw new Error("Identity secure storage is unavailable.");
    }
  }
  private async writeStored(value: string) {
    try {
      await this.store.setItemAsync(this.key, value);
    } catch {
      throw new Error("Identity secure storage is unavailable.");
    }
  }
  private async deleteStored() {
    try {
      await this.store.deleteItemAsync(this.key);
    } catch {
      throw new Error("Identity secure storage could not be cleared.");
    }
  }
  private current(generation: number) {
    if (generation !== this.generation)
      throw new Error("Session operation was cancelled.");
  }
  private async operation(
    query: string,
    variables: unknown,
    generation: number,
    access?: string,
  ): Promise<Record<string, unknown>> {
    this.current(generation);
    const abort = new AbortController();
    this.active.add(abort);
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await this.request(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          ...(access ? { authorization: `Bearer ${access}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal: abort.signal,
      });
      if (
        !response.ok ||
        response.redirected ||
        (response.url && response.url !== this.endpoint)
      )
        throw new Error("Identity service is unavailable.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Identity response is invalid.");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            throw new Error("Identity response is invalid.");
          }
          parts.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      this.current(generation);
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        "errors" in value ||
        !("data" in value) ||
        !value.data ||
        typeof value.data !== "object" ||
        Array.isArray(value.data)
      )
        throw new Error(
          "Identity request was rejected. Check your details or try again.",
        );
      return value.data as Record<string, unknown>;
    } catch (error) {
      this.current(generation);
      if (error instanceof Error && /^Identity /.test(error.message))
        throw error;
      throw new Error("Identity service is unavailable. Please try again.");
    } finally {
      clearTimeout(timeout);
      this.active.delete(abort);
    }
  }
  private validateUser(value: unknown): IdentityUser {
    const parsed = identityUserSchema.safeParse(value);
    if (
      !parsed.success ||
      !parsed.data.roles.includes(requiredRole[this.application])
    )
      throw new Error("Identity account cannot access this application.");
    return parsed.data;
  }
  private async accept(
    value: unknown,
    generation: number,
    hardExpiry?: number,
  ): Promise<IdentityUser> {
    const parsed = sessionPayloadSchema.safeParse(value);
    if (!parsed.success) throw new Error("Identity response is invalid.");
    const session: SessionPayload = parsed.data;
    if (session.application !== this.application)
      throw new Error("Identity session belongs to another application.");
    const user = this.validateUser(session.user);
    const expiresAt = Math.min(
      hardExpiry ?? Infinity,
      this.now() + session.refreshTokenExpiresInSeconds * 1000,
    );
    if (expiresAt <= this.now())
      throw new Error("Identity session has expired.");
    this.current(generation);
    try {
      await this.writeStored(
        JSON.stringify({
          token: session.refreshToken,
          expiresAt,
          userId: user.id,
        }),
      );
    } catch (error) {
      if (generation === this.generation) await this.deleteStored();
      throw error;
    }
    this.current(generation);
    this.access = session.accessToken;
    this.accessUntil = this.now() + session.accessTokenExpiresInSeconds * 1000;
    this.user = user;
    return user;
  }
  login(email: string, password: string): Promise<IdentityUser> {
    const generation = this.generation;
    return this.queue(async () => {
      this.current(generation);
      if (this.user)
        throw new Error(
          "Identity session must be signed out before signing in.",
        );
      if (
        !passwordLoginSchema.safeParse({
          email,
          password,
          application: this.application,
        }).success
      )
        throw new Error("Identity email or password is invalid.");
      const data = await this.operation(
        identityOperations.loginPassword,
        { input: { email, password, application: this.application } },
        generation,
      );
      return this.accept(data.loginPassword, generation);
    });
  }
  register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<IdentityUser> {
    const generation = this.generation;
    return this.queue(async () => {
      if (this.application !== "CUSTOMER")
        throw new Error(
          "Identity registration is unavailable in this application.",
        );
      if (this.user)
        throw new Error(
          "Identity session must be signed out before registering.",
        );
      if (
        !registrationSchema.safeParse({ email, password, displayName }).success
      )
        throw new Error("Identity registration details are invalid.");
      const data = await this.operation(
        identityOperations.registerCustomer,
        { input: { email, password, displayName } },
        generation,
      );
      return this.accept(data.registerCustomer, generation);
    });
  }
  bootstrap(): Promise<IdentityUser | null> {
    return this.refresh()
      .then(() => this.account())
      .catch((error) => {
        if (
          error instanceof Error &&
          error.message === "Identity session is absent."
        )
          return null;
        throw error;
      });
  }
  refresh(): Promise<IdentityUser> {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    const result = this.queue(async () => {
      this.current(generation);
      this.access = null;
      this.user = null;
      this.accessUntil = 0;
      let record: { token: string; expiresAt: number; userId: string };
      const raw = await this.readStored();
      this.current(generation);
      if (!raw) throw new Error("Identity session is absent.");
      try {
        const value: unknown = JSON.parse(raw);
        if (
          !value ||
          typeof value !== "object" ||
          !("token" in value) ||
          !("expiresAt" in value) ||
          !("userId" in value) ||
          typeof value.userId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            value.userId,
          ) ||
          !refreshTokenSchema.safeParse(value.token).success ||
          typeof value.expiresAt !== "number" ||
          !Number.isSafeInteger(value.expiresAt) ||
          value.expiresAt <= this.now()
        )
          throw new Error();
        record = {
          token: value.token as string,
          expiresAt: value.expiresAt,
          userId: value.userId,
        };
      } catch {
        await this.deleteStored();
        throw new Error("Identity session has expired or is invalid.");
      }
      try {
        const data = await this.operation(
          identityOperations.refreshSession,
          {
            input: {
              refreshToken: record.token,
              application: this.application,
            },
          },
          generation,
        );
        const next = sessionPayloadSchema.safeParse(data.refreshSession);
        if (!next.success || next.data.user.id !== record.userId)
          throw new Error("Identity refresh account is invalid.");
        return await this.accept(next.data, generation, record.expiresAt);
      } catch (error) {
        this.access = null;
        this.user = null;
        this.accessUntil = 0;
        if (generation === this.generation) await this.deleteStored();
        throw error;
      }
    });
    this.refreshing = result;
    void result
      .finally(() => {
        if (this.refreshing === result) this.refreshing = null;
      })
      .catch(() => undefined);
    return result;
  }
  account(): Promise<IdentityUser> {
    const generation = this.generation;
    return this.queue(async () => {
      this.current(generation);
      if (!this.access || this.accessUntil <= this.now()) {
        this.user = null;
        throw new Error("Identity access has expired. Refresh your session.");
      }
      try {
        const data = await this.operation(
          identityOperations.me,
          { application: this.application },
          generation,
          this.access,
        );
        const user = this.validateUser(data.me);
        if (!this.user || user.id !== this.user.id)
          throw new Error("Identity account response is invalid.");
        this.user = user;
        return user;
      } catch (error) {
        this.access = null;
        this.user = null;
        this.accessUntil = 0;
        throw error;
      }
    });
  }
  invalidate() {
    this.generation++;
    this.access = null;
    this.user = null;
    this.accessUntil = 0;
    for (const abort of this.active) abort.abort();
    this.active.clear();
  }
  logout(): Promise<void> {
    this.invalidate();
    const generation = this.generation;
    return this.queue(async () => {
      let raw: string | null = null;
      let readError: unknown;
      try {
        raw = await this.readStored();
      } catch (error) {
        readError = error;
      }
      let deleteError: unknown;
      try {
        await this.deleteStored();
      } catch (error) {
        deleteError = error;
      }
      if (readError) throw readError;
      if (!raw) {
        if (deleteError) throw deleteError;
        return;
      }
      let token: unknown;
      try {
        token = JSON.parse(raw).token;
      } catch {
        if (deleteError) throw deleteError;
        return;
      }
      if (!refreshTokenSchema.safeParse(token).success) {
        if (deleteError) throw deleteError;
        return;
      }
      const data = await this.operation(
        identityOperations.logoutSession,
        { input: { refreshToken: token } },
        generation,
      );
      if (
        !data.logoutSession ||
        typeof data.logoutSession !== "object" ||
        !("accepted" in data.logoutSession) ||
        data.logoutSession.accepted !== true
      )
        throw new Error("Identity logout revocation could not be confirmed.");
      if (deleteError) throw deleteError;
    });
  }
}
