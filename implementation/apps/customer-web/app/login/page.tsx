import EmailIcon from "./email-icon";
import Link from "next/link";
import AuthForm from "./auth-form";
export default function Login() {
  return (
    <section className="identity-panel" aria-labelledby="identity-heading">
      <div className="identity-symbol" aria-hidden="true">
        <EmailIcon />
      </div>
      <h1 id="identity-heading">Sign in</h1>
      <p className="identity-intro">
        Good to see you again. Enter your email and password to continue.
      </p>
      <AuthForm />
      <p className="identity-switch">
        New here? <Link href="/register">Create customer account</Link>
      </p>
      <div className="identity-availability">
        <p>Google sign-in and password recovery are currently unavailable.</p>
      </div>
    </section>
  );
}
