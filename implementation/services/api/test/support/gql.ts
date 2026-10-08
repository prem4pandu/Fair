import type { Server } from "node:http";
import request from "supertest";

export type GqlError = {
  message: string;
  extensions: { code: string };
};

export type GqlResult<T = Record<string, unknown>> = {
  status: number;
  data: T | null;
  errors: GqlError[];
};

type MetricsGeneral = {
  experience: string;
  hehe: string;
};

export class GqlClient {
  private publicToken: string | null = null;

  constructor(
    private readonly server: Server,
    private readonly nonce = `test-${Math.random().toString(16).slice(2)}`,
    public userToken: string | null = null,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async metricsGeneral(nonce = this.nonce): Promise<MetricsGeneral> {
    const response = await request(this.server)
      .post("/graphql")
      .set("nonce", nonce)
      .send({
        query:
          "mutation MetricsGeneral { metricsGeneral { excellence topgun experience skydiver rider haha hehe huhu yoyo turu } }",
      });
    const metrics = response.body?.data?.metricsGeneral as
      | MetricsGeneral
      | undefined;
    if (!metrics)
      throw new Error(
        `metricsGeneral handshake failed with HTTP ${response.status}`,
      );
    return metrics;
  }

  async raw(body: object, headers: Record<string, string> = {}) {
    const response = await request(this.server)
      .post("/graphql")
      .set(headers)
      .send(body);
    return { status: response.status, body: response.body };
  }

  withUser(token: string | null) {
    return new GqlClient(this.server, this.nonce, token, this.extraHeaders);
  }

  async query<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GqlResult<T>> {
    this.publicToken ??= (await this.metricsGeneral()).experience;
    const response = await request(this.server)
      .post("/graphql")
      .set({
        nonce: this.nonce,
        "bop-auth": `Bearer ${this.publicToken}`,
        ...(this.userToken
          ? { authorization: `Bearer ${this.userToken}` }
          : {}),
        ...this.extraHeaders,
      })
      .send({ query, variables });
    return {
      status: response.status,
      data: response.body?.data ?? null,
      errors: response.body?.errors ?? [],
    };
  }
}
