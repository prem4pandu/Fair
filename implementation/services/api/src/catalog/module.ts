import {
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import { Pool } from "pg";
import type { Config } from "../config.js";
import { CatalogService } from "./service.js";
import { CatalogResolver } from "./resolver.js";
const CATALOG_POOL = Symbol("CATALOG_POOL");
@Module({})
export class CatalogModule implements OnModuleDestroy {
  constructor(@Inject(CATALOG_POOL) private readonly pool: Pool) {}
  static register(config: Config): DynamicModule {
    return {
      module: CatalogModule,
      providers: [
        {
          provide: CATALOG_POOL,
          useFactory: () => {
            const pool = new Pool({
              connectionString: config.DATABASE_URL,
              max: 3,
              statement_timeout: 1000,
              query_timeout: 1000,
              connectionTimeoutMillis: 1000,
            });
            pool.on("error", () => {
              /* Idle connection errors are handled without disclosing database configuration. */
            });
            return pool;
          },
        },
        {
          provide: CatalogService,
          useFactory: (pool: Pool) => new CatalogService(pool),
          inject: [CATALOG_POOL],
        },
        CatalogResolver,
      ],
      exports: [CatalogService],
    };
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
