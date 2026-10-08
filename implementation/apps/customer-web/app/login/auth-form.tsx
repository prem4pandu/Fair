"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function AuthForm({ register = false }: { register?: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          const result = await fetch(
            register ? "/api/auth/register" : "/api/auth/login",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email: form.get("email"),
                password: form.get("password"),
                ...(register ? { displayName: form.get("displayName") } : {}),
              }),
            },
          );
          const data = await result.json();
          if (!result.ok) {
            setMessage(data.message ?? "Sign-in failed.");
            return;
          }
          router.push("/account");
          router.refresh();
        } catch {
          setMessage("The application could not reach the identity service.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {register && (
        <label>
          Display name
          <input
            name="displayName"
            autoComplete="name"
            required
            maxLength={100}
          />
        </label>
      )}
      <label>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete={register ? "new-password" : "current-password"}
          required
          minLength={register ? 12 : undefined}
          maxLength={128}
        />
      </label>
      <button disabled={busy} type="submit">
        {busy
          ? "Please wait…"
          : register
            ? "Create customer account"
            : "Sign in"}
      </button>
      <p role="status">{message}</p>
      {register && (
        <p>
          Email verification is not available in this packet. New accounts
          remain unverified.
        </p>
      )}
    </form>
  );
}
