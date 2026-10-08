import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { accessTokenSchema } from "@fairbite/identity-contracts";
import {
  BoundaryError,
  boundedJson,
  endpoint,
  names,
  sameOrigin,
} from "./auth";
import type { AddressInput, CustomerAddress } from "./address-types";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELDS = "id label deliveryAddress details longitude latitude selected";
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Sign in to manage your addresses.",
  AUTHENTICATION_FAILED: "Your session is no longer valid. Sign in again.",
  FORBIDDEN: "This account cannot manage customer addresses.",
  NOT_FOUND: "Address not found.",
  ADDRESS_LIMIT_REACHED: "You can save up to 50 addresses.",
  BAD_USER_INPUT: "Check the address details and coordinates.",
  INVALID_INPUT: "Check the address details and coordinates.",
  CSRF_REJECTED: "This request could not be verified.",
  SERVICE_UNAVAILABLE: "Address service is unavailable. Please try again.",
};
const statuses: Record<string, number> = {
  UNAUTHENTICATED: 401,
  AUTHENTICATION_FAILED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ADDRESS_LIMIT_REACHED: 409,
  BAD_USER_INPUT: 400,
};
function record(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid record");
  return v as Record<string, unknown>;
}
function addressInput(v: unknown): AddressInput {
  const row = record(v);
  const keys = ["label", "deliveryAddress", "details", "longitude", "latitude"];
  if (
    Object.keys(row).length !== keys.length ||
    Object.keys(row).some((k) => !keys.includes(k))
  )
    throw new Error("Invalid fields");
  const text = (key: string, min: number, max: number) => {
    const value = row[key];
    if (
      typeof value !== "string" ||
      value.includes("\0") ||
      value.trim().length < min ||
      value.trim().length > max
    )
      throw new Error("Invalid input");
    return value.trim();
  };
  const coordinate = (key: string, max: number) => {
    const value = row[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > max
    )
      throw new Error("Invalid coordinates");
    return value;
  };
  return {
    label: text("label", 1, 100),
    deliveryAddress: text("deliveryAddress", 1, 500),
    details: text("details", 0, 1000),
    longitude: coordinate("longitude", 180),
    latitude: coordinate("latitude", 90),
  };
}
function address(v: unknown): CustomerAddress {
  const row = record(v);
  if (
    typeof row.id !== "string" ||
    !UUID.test(row.id) ||
    typeof row.selected !== "boolean"
  )
    throw new Error("Invalid output");
  const { label, deliveryAddress, details, longitude, latitude } = row;
  return {
    id: row.id,
    ...addressInput({ label, deliveryAddress, details, longitude, latitude }),
    selected: row.selected,
  };
}
async function backendJson(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let count = 0;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 8000);
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      count += next.value.byteLength;
      if (count > 524288) {
        void reader.cancel().catch(() => {});
        throw new Error("Too large");
      }
      parts.push(next.value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (expired) throw new Error("Timed out");
  const bytes = new Uint8Array(count);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return record(JSON.parse(new TextDecoder().decode(bytes)));
}
async function graphql(
  query: string,
  variables: Record<string, unknown>,
  access: string,
) {
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${access}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("HTTP failure");
    const result = await backendJson(response.body);
    if ("errors" in result) {
      let code = "SERVICE_UNAVAILABLE";
      if (Array.isArray(result.errors)) {
        const first = record(result.errors[0]);
        const extensions = record(first.extensions);
        if (
          typeof extensions.code === "string" &&
          Object.hasOwn(statuses, extensions.code)
        )
          code = extensions.code;
      }
      throw new BoundaryError(code, statuses[code] ?? 503);
    }
    return record(result.data);
  } catch (error) {
    if (error instanceof BoundaryError && Object.hasOwn(MESSAGES, error.code))
      throw error;
    throw new BoundaryError("SERVICE_UNAVAILABLE", 503);
  }
}
function access(request: NextRequest) {
  const token = request.cookies.get(names().access)?.value;
  if (!token || !accessTokenSchema.safeParse(token).success)
    throw new BoundaryError("UNAUTHENTICATED", 401);
  return token;
}
function reply(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
function failure(error: unknown) {
  const known =
    error instanceof BoundaryError && Object.hasOwn(MESSAGES, error.code);
  const code = known ? error.code : "SERVICE_UNAVAILABLE";
  return reply({ code, message: MESSAGES[code] }, known ? error.status : 503);
}
export async function addressesGet(request: NextRequest) {
  try {
    const token = access(request);
    const result = await graphql(
      `query OwnAddresses { customerAddresses { ${FIELDS} } }`,
      {},
      token,
    );
    if (
      !Array.isArray(result.customerAddresses) ||
      result.customerAddresses.length > 50
    )
      throw new Error("Invalid list");
    const addresses = result.customerAddresses.map(address);
    if (
      new Set(addresses.map((a) => a.id)).size !== addresses.length ||
      addresses.filter((a) => a.selected).length > 1
    )
      throw new Error("Invalid list");
    return reply({ addresses });
  } catch (error) {
    return failure(error);
  }
}
export async function addressesPost(request: NextRequest) {
  try {
    sameOrigin(request);
    const token = access(request);
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      throw new BoundaryError("INVALID_INPUT", 400);
    let row: Record<string, unknown>;
    let input: AddressInput | undefined;
    try {
      row = record(await boundedJson(request.body));
      const action = row.action;
      if (!["create", "update", "delete", "select"].includes(action as string))
        throw new Error("Invalid action");
      const keys =
        action === "create"
          ? ["action", "input"]
          : action === "update"
            ? ["action", "id", "input"]
            : ["action", "id"];
      if (
        Object.keys(row).length !== keys.length ||
        Object.keys(row).some((k) => !keys.includes(k))
      )
        throw new Error("Invalid fields");
      if (
        action !== "create" &&
        (typeof row.id !== "string" || !UUID.test(row.id))
      )
        throw new Error("Invalid id");
      if (action === "create" || action === "update")
        input = addressInput(row.input);
    } catch {
      throw new BoundaryError("INVALID_INPUT", 400);
    }
    const action = row.action as "create" | "update" | "delete" | "select";
    const operations = {
      create: `mutation CreateAddress($input:CustomerAddressInput!) { createCustomerAddress(input:$input) { ${FIELDS} } }`,
      update: `mutation UpdateAddress($id:ID!,$input:CustomerAddressInput!) { updateCustomerAddress(id:$id,input:$input) { ${FIELDS} } }`,
      delete:
        "mutation DeleteAddress($id:ID!) { deleteCustomerAddress(id:$id) { accepted } }",
      select: `mutation SelectAddress($id:ID!) { selectCustomerAddress(id:$id) { ${FIELDS} } }`,
    };
    const variables =
      action === "create"
        ? { input }
        : action === "update"
          ? { id: row.id, input }
          : { id: row.id };
    const result = await graphql(operations[action], variables, token);
    const key = {
      create: "createCustomerAddress",
      update: "updateCustomerAddress",
      delete: "deleteCustomerAddress",
      select: "selectCustomerAddress",
    }[action];
    if (action === "delete") {
      if (record(result[key]).accepted !== true)
        throw new Error("Invalid deletion");
    } else {
      const parsed = address(result[key]);
      if (action !== "create" && parsed.id !== row.id)
        throw new Error("Invalid ownership response");
      if (action === "select" && !parsed.selected)
        throw new Error("Invalid selection");
    }
    return reply({ accepted: true });
  } catch (error) {
    return failure(error);
  }
}
