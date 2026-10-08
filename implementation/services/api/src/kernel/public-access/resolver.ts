import { Inject } from "@nestjs/common";
import { Context, Mutation, Resolver } from "@nestjs/graphql";
import { PublicAccessTokens } from "./token.js";

type PublicAccessContext = { nonce: string };

@Resolver()
export class PublicAccessResolver {
  constructor(
    @Inject(PublicAccessTokens) private readonly tokens: PublicAccessTokens,
  ) {}

  // The gate has already required a non-empty nonce for this operation.
  @Mutation("metricsGeneral") metricsGeneral(
    @Context() context: PublicAccessContext,
  ) {
    return this.tokens.mint(context.nonce);
  }
}
