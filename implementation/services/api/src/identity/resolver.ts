import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Inject } from "@nestjs/common";
import { IdentityService, type IdentityContext } from "./service.js";
@Resolver()
export class IdentityResolver {
  constructor(
    @Inject(IdentityService) private readonly service: IdentityService,
  ) {}
  @Mutation("registerCustomer") register(
    @Args("input") input: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.register(input, ctx);
  }
  @Mutation("loginPassword") login(
    @Args("input") input: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.service.login(input, ctx);
  }
  @Mutation("refreshSession") refresh(
    @Args("input")
    input: {
      refreshToken: string;
      application: "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN";
    },
    @Context() ctx: IdentityContext,
  ) {
    return this.service.refresh(input.refreshToken, input.application, ctx);
  }
  @Mutation("logoutSession") logout(
    @Args("input") input: { refreshToken: string },
    @Context() ctx: IdentityContext,
  ) {
    return this.service.logout(input.refreshToken, ctx);
  }
  @Mutation("logoutAllSessions") logoutAll(
    @Args("application")
    application: "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN",
    @Context() ctx: IdentityContext,
  ) {
    return this.service.logoutAll(application, ctx);
  }
  @Query("me") me(
    @Args("application")
    application: "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN",
    @Context() ctx: IdentityContext,
  ) {
    return this.service.me(application, ctx);
  }
}
