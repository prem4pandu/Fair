import type { ApolloServerPlugin } from "@apollo/server";
import { statusFor } from "./errors.js";

// Enatega clients branch on HTTP status for authentication and dependency
// failures. Track errors in didEncounterErrors because willSendResponse does not
// receive an errors field in Apollo Server 5.
export const httpStatusPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    let status = 200;
    return {
      async didEncounterErrors({ errors }) {
        status = Math.max(
          status,
          ...errors.map((error) =>
            statusFor(
              String(error.extensions?.code ?? "INTERNAL_SERVER_ERROR"),
            ),
          ),
        );
      },
      async willSendResponse({ response }) {
        if (status !== 200) response.http.status = status;
      },
    };
  },
};
