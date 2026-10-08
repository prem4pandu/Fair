import { cookies } from "next/headers";
import Link from "next/link";
import { currentUser, names, BoundaryError } from "../../lib/auth";
import SessionControls from "./session-controls";
export const dynamic = "force-dynamic";
export default async function Account() {
  let user;
  let message = "";
  try {
    user = await currentUser((await cookies()).get(names().access)?.value);
  } catch (error) {
    message =
      error instanceof BoundaryError && error.status === 401
        ? "Your access session has expired or is unavailable. Sign in or try refreshing your session."
        : "Account details are unavailable.";
  }
  return (
    <>
      <h1>Your account</h1>
      <section className="panel">
        {user ? (
          <dl>
            <dt>Display name</dt>
            <dd>{user.displayName}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Email verification</dt>
            <dd>{user.emailVerificationStatus}</dd>
          </dl>
        ) : (
          <>
            <p>{message}</p>
            <Link href="/login">Sign in</Link>
          </>
        )}
        {user && (
          <p>
            <Link href="/profile/addresses">Manage addresses</Link>
          </p>
        )}
        <SessionControls />
      </section>
    </>
  );
}
