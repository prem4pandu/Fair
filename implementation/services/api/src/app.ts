import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  Controller,
  Inject,
  Injectable,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  Context,
  GraphQLModule,
  GraphQLSchemaHost,
  Query,
  Resolver,
} from "@nestjs/graphql";
import { ApolloDriver, type ApolloDriverConfig } from "@nestjs/apollo";
import { brand } from "@fairbite/brand";
import { Pool } from "pg";
import { Redis } from "ioredis";
import helmet from "helmet";
import { json, type Request, type Response, type NextFunction } from "express";
import { AddressesModule } from "./addresses/module.js";
import { CatalogModule } from "./catalog/module.js";
import { ConfigurationModule } from "./configuration/module.js";
import { IdentityService } from "./identity/service.js";
import { IdentityResolver } from "./identity/resolver.js";
import type { Config } from "./config.js";
import { KernelModule } from "./kernel/kernel.module.js";
import { loadTypeDefs } from "./kernel/schema.js";
import { boundedOperation } from "./kernel/limits.js";
import { fillNotImplemented } from "./kernel/not-implemented.js";
import { formatError } from "./kernel/errors.js";
import { httpStatusPlugin } from "./kernel/http-status.plugin.js";
import { PublicAccessTokens } from "./kernel/public-access/token.js";
import { publicAccessMiddleware } from "./kernel/public-access/gate.js";
import { UserTokens } from "./kernel/auth/tokens.js";
import { resolveAuth, type AuthContext } from "./kernel/auth/guards.js";
import type { RequestContext } from "./kernel/context.js";
import { PUBSUB, type RedisPubSub } from "./kernel/pubsub.js";
import { attachSubscriptionServer } from "./kernel/ws/server.js";
export async function createApp(config: Config) {
  const identity = new IdentityService(config);
  let closeWs = async () => {};
  const database = new Pool({
    connectionString: config.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
    statement_timeout: 1000,
  });
  database.on("error", () => {});
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  let readinessFlight: Promise<boolean> | undefined;
  const probeReady = async () => {
    const checks = await Promise.allSettled([
      database.query("SELECT 1"),
      (async () => {
        if (redis.status === "end") await redis.connect();
        return redis.ping();
      })(),
    ]);
    return checks.every((check) => check.status === "fulfilled");
  };
  const ready = () =>
    (readinessFlight ??= probeReady().finally(() => {
      readinessFlight = undefined;
    }));
  @Injectable()
  class DependencyLifecycle {
    constructor(@Inject(PUBSUB) private readonly pubsub: RedisPubSub) {}
    async onApplicationShutdown() {
      await closeWs();
      await this.pubsub.close();
      redis.disconnect();
      await database.end();
      await identity.close();
    }
  }
  @Controller("health")
  class HealthController {
    @Get("live") live() {
      return { status: "ok", service: brand.name };
    }
    @Get("ready") async ready() {
      if (!(await ready()))
        throw new ServiceUnavailableException("Dependencies unavailable");
      return { status: "ok" };
    }
  }
  @Resolver()
  class FoundationResolver {
    @Query("serviceInfo") async serviceInfo(
      @Context() context: { ready: () => Promise<boolean> },
    ) {
      return {
        name: brand.name,
        status: (await context.ready()) ? "ready" : "unavailable",
      };
    }
  }
  @Module({
    imports: [
      KernelModule.register(config),
      CatalogModule.register(config),
      ConfigurationModule.register(config),
      AddressesModule.register(config, {
        authorize: (context) => identity.identity("CUSTOMER", context),
      }),
      GraphQLModule.forRoot<ApolloDriverConfig>({
        driver: ApolloDriver,
        path: "/graphql",
        context: ({ req }: { req: Request }) => makeHttpContext(req),
        typeDefs: loadTypeDefs(),
        playground: false,
        introspection: config.APP_ENV !== "production",
        validationRules: [boundedOperation],
        formatError: (error) =>
          config.APP_ENV === "production" &&
          error.extensions?.code === "GRAPHQL_VALIDATION_FAILED"
            ? {
                message: "GraphQL request failed",
                extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
              }
            : formatError(error),
        plugins: [httpStatusPlugin],
        transformSchema: fillNotImplemented,
      }),
    ],
    controllers: [HealthController],
    providers: [
      FoundationResolver,
      DependencyLifecycle,
      IdentityResolver,
      { provide: IdentityService, useValue: identity },
    ],
  })
  class FoundationModule {}

  const userTokens = new UserTokens(
    config.ACCESS_TOKEN_SECRET ?? Buffer.alloc(32, 5).toString("base64url"),
    config.USER_TOKEN_TTL_SECONDS,
  );
  const sessions = {
    async isActive(sessionId: string) {
      const result = await database.query(
        `SELECT 1
           FROM "IdentityRefreshSession" refresh
           JOIN "IdentitySessionFamily" family
             ON family.id = refresh."familyId"
            AND family."userId" = refresh."userId"
          WHERE refresh.id = $1::uuid
            AND refresh."consumedAt" IS NULL
            AND family."revokedAt" IS NULL
            AND family."expiresAt" > now()`,
        [sessionId],
      );
      return result.rowCount === 1;
    },
  };
  const resolvePrincipal = async (
    authorization: string | undefined,
  ): Promise<AuthContext | null> => {
    const basic = await resolveAuth(authorization, userTokens, sessions);
    if (!basic) return null;
    return {
      ...basic,
      permissions: [],
      restaurantIds: [],
      vendorId: null,
      riderId: null,
    };
  };
  const header = (request: Request, name: string) => {
    const value = request.headers[name];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const makeHttpContext = (request: Request) => {
    let auth: Promise<AuthContext | null> | undefined;
    let readyResult: Promise<boolean> | undefined;
    return {
      requestId: randomUUID(),
      ip: request.socket.remoteAddress ?? "unknown",
      nonce: header(request, "nonce").trim(),
      platform: header(request, "x-platform") || null,
      language: header(request, "accept-language") || "en",
      transport: "http" as const,
      auth: () => (auth ??= resolvePrincipal(request.headers.authorization)),
      // Temporary legacy fields remain until Wave 1 removes the old contract.
      ready: () => (readyResult ??= ready()),
      authorization: request.headers.authorization,
    } satisfies RequestContext & {
      ready: () => Promise<boolean>;
      authorization: string | undefined;
    };
  };
  const app = await NestFactory.create(FoundationModule, {
    logger: false,
    bodyParser: false,
  });
  const publicTokens = app.get(PublicAccessTokens);
  app.use(helmet());
  app.use(json({ limit: config.GRAPHQL_BODY_LIMIT }));
  app.use(
    "/graphql",
    publicAccessMiddleware(config.PUBLIC_ACCESS_ENFORCED, (token, nonce) =>
      publicTokens.verify(token, nonce),
    ),
  );
  app.use(
    (
      error: { type?: string },
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error.type === "entity.parse.failed") {
        response.status(400).json({ message: "Invalid JSON request" });
        return;
      }
      if (error.type === "entity.too.large") {
        response.status(413).json({ message: "Request too large" });
        return;
      }
      next(error);
    },
  );
  app.enableCors({
    origin: config.origins,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "nonce",
      "bop-auth",
      "userid",
      "isauth",
      "x-client-type",
      "x-platform",
      "accept",
      "accept-language",
      "x-skip-public-auth",
    ],
  });
  app.enableShutdownHooks();
  await app.init();
  const schema = app.get(GraphQLSchemaHost).schema;
  closeWs = attachSubscriptionServer(
    app.getHttpServer(),
    schema,
    async (params) => {
      const authorization =
        typeof params.authorization === "string" ? params.authorization : "";
      let auth: Promise<AuthContext | null> | undefined;
      return {
        requestId: randomUUID(),
        ip: "ws",
        nonce: typeof params.nonce === "string" ? params.nonce : "",
        platform:
          typeof params["x-platform"] === "string"
            ? params["x-platform"]
            : null,
        language:
          typeof params["accept-language"] === "string"
            ? params["accept-language"]
            : "en",
        transport: "ws",
        auth: () => (auth ??= resolvePrincipal(authorization)),
      } satisfies RequestContext;
    },
  );
  return app;
}
