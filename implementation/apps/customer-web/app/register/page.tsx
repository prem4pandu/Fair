import EmailIcon from "../login/email-icon";
import Link from "next/link";
import AuthForm from "../login/auth-form";
export default function Register() {
  return (
    <section className="identity-panel" aria-labelledby="identity-heading">
      <div className="identity-symbol" aria-hidden="true">
        <EmailIcon />
      </div>
      <h1 id="identity-heading">Create customer account</h1>
      <p className="identity-intro">
        Tell us your name and choose your account details.
      </p>
      <AuthForm register />
      <p className="identity-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
      <div className="identity-availability">
        <p>Google sign-in is currently unavailable.</p>
      </div>
    </section>
  );
}
