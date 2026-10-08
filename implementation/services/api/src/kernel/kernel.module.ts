import { type DynamicModule, Module } from "@nestjs/common";
import type { Config } from "../config.js";
import { UserTokens } from "./auth/tokens.js";
import { PublicAccessResolver } from "./public-access/resolver.js";
import { PublicAccessTokens } from "./public-access/token.js";
import { PUBSUB, RedisPubSub } from "./pubsub.js";

@Module({})
export class KernelModule {
  static register(config: Config): DynamicModule {
    return {
      module: KernelModule,
      global: true,
      providers: [
        {
          provide: PublicAccessTokens,
          useValue: new PublicAccessTokens(
            config.PUBLIC_ACCESS_SECRET!,
            config.PUBLIC_ACCESS_TTL_SECONDS,
          ),
        },
        {
          provide: UserTokens,
          useValue: new UserTokens(
            config.ACCESS_TOKEN_SECRET ??
              Buffer.alloc(32, 5).toString("base64url"),
            config.USER_TOKEN_TTL_SECONDS,
          ),
        },
        {
          provide: PUBSUB,
          useFactory: () => new RedisPubSub(config.REDIS_URL),
        },
        PublicAccessResolver,
      ],
      exports: [PublicAccessTokens, UserTokens, PUBSUB],
    };
  }
}
