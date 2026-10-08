"use client";
/* Source-adapted Enatega profile/addresses/main and main/address-listings. See SOURCE_PROVENANCE.md. */
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AddressInput, CustomerAddress } from "../../../lib/address-types";
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
class RequestFailure extends Error {
  constructor(public code: string) {
    super(MESSAGES[code] ?? MESSAGES.SERVICE_UNAVAILABLE);
  }
}
async function request(body?: Record<string, unknown>) {
  const response = await fetch("/api/customer/addresses", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new RequestFailure(
      typeof data.code === "string" && Object.hasOwn(MESSAGES, data.code)
        ? data.code
        : "SERVICE_UNAVAILABLE",
    );
  return data;
}
function AddressItem({
  address,
  actionLabel,
  busy,
  onEdit,
  onAction,
}: {
  address: CustomerAddress;
  actionLabel: string;
  busy: boolean;
  onEdit: (address: CustomerAddress) => void;
  onAction: (action: "delete" | "select", address: CustomerAddress) => void;
}) {
  return (
    <article className="address-item">
      <div className="address-content">
        <h2>{address.label}</h2>
        <p>{address.deliveryAddress}</p>
        {address.details && <p>{address.details}</p>}
        <p className="address-coordinates">
          Longitude {address.longitude} · Latitude {address.latitude}
        </p>
        {address.selected && (
          <p className="address-selected">Selected address</p>
        )}
      </div>
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => onEdit(address)}
          aria-label={`Edit ${actionLabel}`}
        >
          Edit
        </button>
        <button
          type="button"
          disabled={busy || address.selected}
          onClick={() => onAction("select", address)}
          aria-label={`Select ${actionLabel}`}
        >
          Select
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("delete", address)}
          aria-label={`Delete ${actionLabel}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
export default function AddressesScreen() {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [busy, setBusy] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState("Loading addresses…");
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [showForm, setShowForm] = useState(false);
  const busyRef = useRef(false);
  const labelRef = useRef<HTMLInputElement>(null);
  function failed(error: unknown) {
    const failure =
      error instanceof RequestFailure
        ? error
        : new RequestFailure("SERVICE_UNAVAILABLE");
    setMessage(failure.message);
    if (
      ["UNAUTHENTICATED", "AUTHENTICATION_FAILED", "FORBIDDEN"].includes(
        failure.code,
      )
    ) {
      setAddresses([]);
      setAuthenticated(false);
      setShowForm(false);
    }
  }
  async function load() {
    const data = await request();
    if (!Array.isArray(data.addresses))
      throw new RequestFailure("SERVICE_UNAVAILABLE");
    setAddresses(data.addresses);
    setAuthenticated(true);
  }
  useEffect(() => {
    let active = true;
    request()
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data.addresses))
          throw new RequestFailure("SERVICE_UNAVAILABLE");
        setAddresses(data.addresses);
        setAuthenticated(true);
        setMessage("");
      })
      .catch((error) => {
        if (active) failed(error);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (showForm) labelRef.current?.focus();
  }, [showForm, editing]);
  async function mutate(body: Record<string, unknown>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await request(body);
      if (result.accepted !== true)
        throw new RequestFailure("SERVICE_UNAVAILABLE");
      await load();
      setShowForm(false);
      setEditing(null);
      setMessage(success);
    } catch (error) {
      failed(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const form = new FormData(event.currentTarget);
    const longitude = String(form.get("longitude") ?? "");
    const latitude = String(form.get("latitude") ?? "");
    if (
      !longitude.trim() ||
      !latitude.trim() ||
      !Number.isFinite(Number(longitude)) ||
      !Number.isFinite(Number(latitude))
    ) {
      setMessage(MESSAGES.INVALID_INPUT);
      return;
    }
    const input: AddressInput = {
      label: String(form.get("label") ?? ""),
      deliveryAddress: String(form.get("deliveryAddress") ?? ""),
      details: String(form.get("details") ?? ""),
      longitude: Number(longitude),
      latitude: Number(latitude),
    };
    void mutate(
      editing
        ? { action: "update", id: editing.id, input }
        : { action: "create", input },
      "Address saved.",
    );
  }
  return (
    <section className="addresses-screen">
      <div className="catalog-heading">
        <h1>Your addresses</h1>
      </div>
      <p>
        Enter coordinates manually. Maps and address lookup are unavailable.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!authenticated && !busy && <Link href="/login">Sign in</Link>}
      {authenticated && (
        <>
          <div className="address-list" aria-busy={busy}>
            {addresses.map((address) => (
              <AddressItem
                key={address.id}
                address={address}
                actionLabel={
                  addresses.filter((item) => item.label === address.label)
                    .length > 1
                    ? `${address.label} (${address.id})`
                    : address.label
                }
                busy={busy}
                onEdit={(address) => {
                  setEditing(address);
                  setShowForm(true);
                  setMessage("");
                }}
                onAction={(action, address) =>
                  void mutate(
                    { action, id: address.id },
                    action === "delete"
                      ? "Address deleted."
                      : "Address selected.",
                  )
                }
              />
            ))}
            {!addresses.length && <p>No saved addresses yet.</p>}
          </div>
          <button
            type="button"
            className="address-add"
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setShowForm(true);
              setMessage("");
            }}
          >
            Add new address
          </button>
          {showForm && (
            <section
              className="panel address-form-panel"
              aria-labelledby="address-form-heading"
            >
              <h2 id="address-form-heading">
                {editing ? "Edit address" : "Add address"}
              </h2>
              <form key={editing?.id ?? "new"} onSubmit={submit}>
                <label>
                  Label
                  <input
                    ref={labelRef}
                    name="label"
                    required
                    maxLength={100}
                    defaultValue={editing?.label ?? ""}
                    disabled={busy}
                  />
                </label>
                <label>
                  Delivery address
                  <input
                    name="deliveryAddress"
                    required
                    maxLength={500}
                    autoComplete="street-address"
                    defaultValue={editing?.deliveryAddress ?? ""}
                    disabled={busy}
                  />
                </label>
                <label htmlFor="address-details">Details</label>
                <textarea
                  id="address-details"
                  name="details"
                  maxLength={1000}
                  defaultValue={editing?.details ?? ""}
                  disabled={busy}
                />
                <label>
                  Longitude
                  <input
                    name="longitude"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    required
                    defaultValue={editing?.longitude ?? ""}
                    disabled={busy}
                  />
                </label>
                <label>
                  Latitude
                  <input
                    name="latitude"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    required
                    defaultValue={editing?.latitude ?? ""}
                    disabled={busy}
                  />
                </label>
                <div className="actions">
                  <button type="submit" disabled={busy}>
                    Save address
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setShowForm(false);
                      setEditing(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}
      <button
        className="address-retry"
        type="button"
        disabled={busy}
        onClick={() => {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          void load()
            .then(() => setMessage(""))
            .catch(failed)
            .finally(() => {
              busyRef.current = false;
              setBusy(false);
            });
        }}
      >
        Reload addresses
      </button>
    </section>
  );
}
