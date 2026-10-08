import {
  Module,
  Inject,
  type DynamicModule,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Pool } from "pg";
import type { Config } from "../config.js";
import { AddressesService, type AddressAuthority } from "./service.js";
import { AddressesResolver } from "./resolver.js";
const ADDRESSES_POOL = Symbol("ADDRESSES_POOL");
@Module({})
export class AddressesModule implements OnModuleDestroy {
  constructor(@Inject(ADDRESSES_POOL) private readonly pool: Pool) {}
  static register(config: Config, authority: AddressAuthority): DynamicModule {
    return {
      module: AddressesModule,
      providers: [
        {
          provide: ADDRESSES_POOL,
          useFactory: () => {
            const pool = new Pool({
              connectionString: config.DATABASE_URL,
              max: 3,
              statement_timeout: 1000,
              query_timeout: 1000,
              connectionTimeoutMillis: 1000,
              idle_in_transaction_session_timeout: 5000,
            });
            pool.on("error", () => {
              /* Do not disclose database or address details. */
            });
            return pool;
          },
        },
        {
          provide: AddressesService,
          useFactory: (pool: Pool) => new AddressesService(pool, authority),
          inject: [ADDRESSES_POOL],
        },
        AddressesResolver,
      ],
      exports: [AddressesService],
    };
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
