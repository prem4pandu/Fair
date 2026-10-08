import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Inject } from "@nestjs/common";
import { IdentityService, type IdentityContext } from "./service.js";
import {
  EnategaIdentityAdapter,
  type EnategaCreateUser,
  type EnategaPasswordLogin,
} from "./enatega.js";
@Resolver()
export class IdentityResolver {
  private readonly enatega: EnategaIdentityAdapter;
  constructor(
    @Inject(IdentityService) private readonly service: IdentityService,
  ) {
    this.enatega = new EnategaIdentityAdapter(service);
  }
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

  @Mutation("login") enategaLogin(
    @Args() input: EnategaPasswordLogin,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.login(input, ctx);
  }

  @Mutation("createUser") createUser(
    @Args("userInput") input: EnategaCreateUser,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.createUser(input, ctx);
  }

  @Mutation("ownerLogin") ownerLogin(
    @Args("email") email: unknown,
    @Args("password") password: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.ownerLogin(email, password, ctx);
  }

  @Mutation("restaurantLogin") restaurantLogin(
    @Args("username") username: unknown,
    @Args("password") password: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.restaurantLogin(username, password, ctx);
  }

  @Mutation("riderLogin") riderLogin(
    @Args("username") username: unknown,
    @Args("password") password: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.riderLogin(username, password, ctx);
  }

  @Mutation("refreshToken") enategaRefresh(
    @Args("refreshToken") refreshToken: unknown,
    @Args("userType") userType: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.refreshToken(refreshToken, userType, ctx);
  }

  @Query("profile") profile(@Context() ctx: IdentityContext) {
    return this.enatega.profile(ctx);
  }

  @Query("hasOwnerPermission") hasOwnerPermission(
    @Args("permission") permission: unknown,
    @Context() ctx: IdentityContext,
  ) {
    return this.enatega.hasOwnerPermission(permission, ctx);
  }
}
