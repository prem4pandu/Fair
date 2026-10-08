import Link from "next/link";
import AuthForm from "./auth-form";
export default function Login() {
  return (
    <>
      <h1>Sign in</h1>
      <p>Sign in to this application with your password.</p>
      <section className="panel">
        <AuthForm />
        <Link href="/register">Create customer account</Link>
      </section>
    </>
  );
}
