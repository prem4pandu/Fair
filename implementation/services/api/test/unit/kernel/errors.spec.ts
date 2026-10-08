import type {
  BaseContext,
  GraphQLResponse,
  GraphQLRequestContextDidEncounterErrors,
  GraphQLRequestContextWillSendResponse,
} from "@apollo/server";
import { HeaderMap } from "@apollo/server";
import { GraphQLError } from "graphql";
import { describe, expect, it } from "vitest";
import {
  appError,
  FORBIDDEN_WORDS,
  formatError,
  statusFor,
} from "../../../src/kernel/errors.js";
import { httpStatusPlugin } from "../../../src/kernel/http-status.plugin.js";

describe("error contract", () => {
  it("keeps allow-listed codes and their messages", () => {
    const error = appError("BAD_USER_INPUT", "Minimum order not met");
    expect(
      formatError({ message: error.message, extensions: error.extensions }),
    ).toEqual({
      message: "Minimum order not met",
      extensions: { code: "BAD_USER_INPUT" },
    });
  });

  it("uses the default message when none is given", () => {
    const error = appError("TOKEN_EXPIRED");
    expect(error.message).toBe("Access token expired");
  });

  it("masks unknown codes as INTERNAL_SERVER_ERROR", () => {
    expect(
      formatError({ message: "db exploded", extensions: { code: "WHATEVER" } }),
    ).toEqual({
      message: "GraphQL request failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  });

  it("passes GraphQL validation messages through", () => {
    expect(
      formatError({
        message: 'Cannot query field "x" on type "Query".',
        extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
      }),
    ).toEqual({
      message: 'Cannot query field "x" on type "Query".',
      extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
    });
  });

  it("maps codes to HTTP statuses", () => {
    expect(statusFor("UNAUTHENTICATED")).toBe(401);
    expect(statusFor("TOKEN_EXPIRED")).toBe(401);
    expect(statusFor("INVALID_TOKEN")).toBe(401);
    expect(statusFor("FORBIDDEN")).toBe(403);
    expect(statusFor("PUBLIC_ACCESS_DENIED")).toBe(403);
    expect(statusFor("SERVICE_UNAVAILABLE")).toBe(503);
    expect(statusFor("BAD_USER_INPUT")).toBe(200);
  });

  it("refuses business messages containing client auth-refresh words", () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(() => appError("BAD_USER_INPUT", `You are ${word} here`)).toThrow(
        /reserved word/,
      );
    }
  });

  it("produces GraphQLError instances", () => {
    expect(appError("NOT_FOUND")).toBeInstanceOf(GraphQLError);
  });
});

describe("HTTP status plugin", () => {
  function hookContext<T>(value: Partial<T>): T {
    return value as T;
  }

  async function run(codes: string[]): Promise<number | undefined> {
    const listener = await httpStatusPlugin.requestDidStart?.({} as never);
    if (!listener) throw new Error("HTTP status plugin returned no listener");

    if (codes.length > 0) {
      await listener.didEncounterErrors?.(
        hookContext<GraphQLRequestContextDidEncounterErrors<BaseContext>>({
          errors: codes.map(
            (code) => new GraphQLError(code, { extensions: { code } }),
          ),
        }),
      );
    }

    const response: GraphQLResponse = {
      http: { headers: new HeaderMap() },
      body: { kind: "single", singleResult: { data: {} } },
    };
    await listener.willSendResponse?.(
      hookContext<GraphQLRequestContextWillSendResponse<BaseContext>>({
        response,
      }),
    );
    return response.http.status;
  }

  it("leaves successful responses at Apollo's default status", async () => {
    await expect(run([])).resolves.toBeUndefined();
  });

  it("uses the most severe status across mixed errors", async () => {
    await expect(
      run(["BAD_USER_INPUT", "UNAUTHENTICATED", "FORBIDDEN"]),
    ).resolves.toBe(403);
    await expect(run(["FORBIDDEN", "SERVICE_UNAVAILABLE"])).resolves.toBe(503);
  });
});
