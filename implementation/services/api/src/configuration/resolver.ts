import { Inject } from "@nestjs/common";
import { Query, Resolver } from "@nestjs/graphql";
import { ConfigurationService } from "./service.js";
@Resolver()
export class ConfigurationResolver {
  constructor(
    @Inject(ConfigurationService)
    private readonly service: ConfigurationService,
  ) {}
  @Query("configuration") configuration() {
    return this.service.read();
  }
  @Query("publicConfiguration") publicConfiguration() {
    return this.service.read();
  }
}
