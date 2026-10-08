import { Inject } from "@nestjs/common";
import { Args, Query, Resolver } from "@nestjs/graphql";
import { CatalogService } from "./service.js";
@Resolver()
export class CatalogResolver {
  constructor(
    @Inject(CatalogService) private readonly service: CatalogService,
  ) {}
  @Query("catalogOutlets") outlets(
    @Args("limit") limit?: unknown,
    @Args("after") after?: unknown,
  ) {
    return this.service.outlets(limit, after);
  }
  @Query("catalogOutlet") outlet(@Args("id") id: unknown) {
    return this.service.outlet(id);
  }
  @Query("catalogItems") items(
    @Args("outletId") outletId: unknown,
    @Args("limit") limit?: unknown,
    @Args("after") after?: unknown,
  ) {
    return this.service.items(outletId, limit, after);
  }
  @Query("restaurants") restaurants() {
    return this.service.enategaRestaurants();
  }
  @Query("restaurant") restaurant(@Args("id") id: unknown) {
    return this.service.enategaRestaurant(id);
  }
}
