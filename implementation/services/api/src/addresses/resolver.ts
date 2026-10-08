import { Inject } from "@nestjs/common";
import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import type { IdentityContext } from "../identity/service.js";
import { AddressesService } from "./service.js";
@Resolver()
export class AddressesResolver {
  constructor(
    @Inject(AddressesService) private readonly service: AddressesService,
  ) {}
  @Query("customerAddresses") list(@Context() ctx: IdentityContext) {
    return this.service.list(ctx);
  }
  @Mutation("createCustomerAddress") create(
    @Args("input") input: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.create(input, ctx);
  }
  @Mutation("updateCustomerAddress") update(
    @Args("id") id: unknown,
    @Args("input") input: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.update(id, input, ctx);
  }
  @Mutation("deleteCustomerAddress") delete(
    @Args("id") id: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.delete(id, ctx);
  }
  @Mutation("selectCustomerAddress") select(
    @Args("id") id: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.select(id, ctx);
  }

  @Mutation("createAddress") createEnatega(
    @Args("addressInput") input: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.createEnatega(input, ctx);
  }

  @Mutation("editAddress") editEnatega(
    @Args("addressInput") input: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.editEnatega(input, ctx);
  }

  @Mutation("deleteAddress") deleteEnatega(
    @Args("id") id: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.deleteEnatega(id, ctx);
  }

  @Mutation("deleteBulkAddresses") deleteBulkEnatega(
    @Args("ids") ids: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.deleteBulk(ids, ctx);
  }

  @Mutation("selectAddress") selectEnatega(
    @Args("id") id: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.selectEnatega(id, ctx);
  }
}
