"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function SessionControls() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const run = async (action: "refresh" | "logout") => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fetch(`/api/auth/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await result.json();
      setMessage(
        data.message ??
          (result.ok ? "Session refreshed." : "The request failed."),
      );
      router.refresh();
    } catch {
      setMessage("The application could not reach the identity service.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="actions">
        <button disabled={busy} onClick={() => void run("refresh")}>
          Refresh session
        </button>
        <button disabled={busy} onClick={() => void run("logout")}>
          Sign out
        </button>
      </div>
      <p role="status">{message}</p>
    </>
  );
}
