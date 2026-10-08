import {
  Module,
  Inject,
  type DynamicModule,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Pool } from "pg";
import type { Config } from "../config.js";
import { ConfigurationService } from "./service.js";
import { ConfigurationResolver } from "./resolver.js";
const CONFIGURATION_POOL = Symbol("CONFIGURATION_POOL");
@Module({})
export class ConfigurationModule implements OnModuleDestroy {
  constructor(@Inject(CONFIGURATION_POOL) private readonly pool: Pool) {}
  static register(config: Config): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [
        {
          provide: CONFIGURATION_POOL,
          useFactory: () => {
            const pool = new Pool({
              connectionString: config.DATABASE_URL,
              max: 3,
              connectionTimeoutMillis: 1000,
              statement_timeout: 1000,
              query_timeout: 1500,
              idle_in_transaction_session_timeout: 5000,
            });
            pool.on("error", () => {});
            return pool;
          },
        },
        {
          provide: ConfigurationService,
          useFactory: (pool: Pool) => new ConfigurationService(pool),
          inject: [CONFIGURATION_POOL],
        },
        ConfigurationResolver,
      ],
      exports: [ConfigurationService],
    };
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
