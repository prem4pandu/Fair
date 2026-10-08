import "reflect-metadata";
import { readFileSync } from "node:fs";
import {
  Controller,
  Injectable,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Context, GraphQLModule, Query, Resolver } from "@nestjs/graphql";
import { ApolloDriver, type ApolloDriverConfig } from "@nestjs/apollo";
import { brand } from "@fairbite/brand";
import { Pool } from "pg";
import { Redis } from "ioredis";
import helmet from "helmet";
import { json, type Request, type Response, type NextFunction } from "express";
import {
  GraphQLError,
  Kind,
  type SelectionSetNode,
  type FragmentDefinitionNode,
  type ValidationRule,
} from "graphql";
import { AddressesModule } from "./addresses/module.js";
import { CatalogModule } from "./catalog/module.js";
import { IdentityService } from "./identity/service.js";
import { IdentityResolver } from "./identity/resolver.js";
import type { Config } from "./config.js";
export const boundedOperation: ValidationRule = (context) => ({
  Document(node) {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of node.definitions)
      if (definition.kind === Kind.FRAGMENT_DEFINITION)
        fragments.set(definition.name.value, definition);
    let fields = 0;
    let mutationRoots = 0;
    let isMutation = false;
    let exceeded = node.definitions.length > 10;
    const walk = (
      selection: SelectionSetNode,
      depth: number,
      seen: Set<string>,
    ): void => {
      if (depth > 8 || fields > 100) {
        exceeded = true;
        return;
      }
      for (const entry of selection.selections) {
        if (entry.kind === Kind.FIELD) {
          fields++;
          if (isMutation && depth === 1) mutationRoots++;
          if (entry.selectionSet) walk(entry.selectionSet, depth + 1, seen);
        } else if (entry.kind === Kind.INLINE_FRAGMENT)
          walk(entry.selectionSet, depth, seen);
        else {
          const name = entry.name.value;
          const fragment = fragments.get(name);
          if (seen.has(name)) {
            exceeded = true;
            return;
          }
          if (fragment)
            walk(fragment.selectionSet, depth, new Set([...seen, name]));
        }
        if (fields > 100) {
          exceeded = true;
          return;
        }
      }
    };
    for (const definition of node.definitions)
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        isMutation = definition.operation === "mutation";
        mutationRoots = 0;
        walk(definition.selectionSet, 1, new Set());
        if (mutationRoots > 1) exceeded = true;
      }
    if (exceeded)
      context.reportError(new GraphQLError("Operation exceeds allowed limits"));
  },
});
export async function createApp(config: Config) {
  const identity = new IdentityService(config);
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
    async onApplicationShutdown() {
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
      CatalogModule.register(config),
      AddressesModule.register(config, {
        authorize: (context) => identity.identity("CUSTOMER", context),
      }),
      GraphQLModule.forRoot<ApolloDriverConfig>({
        driver: ApolloDriver,
        path: "/graphql",
        context: ({ req }: { req: Request }) => {
          let result: Promise<boolean> | undefined;
          return {
            ready: () => (result ??= ready()),
            ip: req.socket.remoteAddress ?? "unknown",
            authorization: req.headers.authorization,
          };
        },
        typeDefs: [
          readFileSync(
            new URL("../../../contracts/foundation.graphql", import.meta.url),
            "utf8",
          ),
          readFileSync(
            new URL("../../../contracts/identity.graphql", import.meta.url),
            "utf8",
          ),
          readFileSync(
            new URL("../../../contracts/catalog.graphql", import.meta.url),
            "utf8",
          ),
          readFileSync(
            new URL("../../../contracts/addresses.graphql", import.meta.url),
            "utf8",
          ),
        ],
        playground: false,
        introspection: config.APP_ENV !== "production",
        validationRules: [boundedOperation],
        formatError: (formatted) => {
          const code = String(
            formatted.extensions?.code ?? "INTERNAL_SERVER_ERROR",
          );
          const messages: Record<string, string> = {
            BAD_USER_INPUT: "Invalid request",
            NOT_FOUND: "Resource not found",
            ADDRESS_LIMIT_REACHED: "Saved address limit reached",
            AUTHENTICATION_FAILED: "Authentication required",
            FORBIDDEN: "Access denied",
            RATE_LIMITED: "Too many authentication attempts",
            SERVICE_UNAVAILABLE: "Service unavailable",
            AUTH_DISABLED: "Password authentication is unavailable",
            ACCOUNT_EXISTS: "Account already exists",
          };
          return {
            message: Object.hasOwn(messages, code)
              ? messages[code]
              : "GraphQL request failed",
            extensions: {
              code: Object.hasOwn(messages, code)
                ? code
                : "INTERNAL_SERVER_ERROR",
            },
          };
        },
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
  const app = await NestFactory.create(FoundationModule, {
    logger: false,
    bodyParser: false,
  });
  app.use(helmet());
  app.use(json({ limit: "16kb" }));
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
  app.enableCors({ origin: config.origins, credentials: false });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
