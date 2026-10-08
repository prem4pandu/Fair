import AuthForm from "./auth-form";
export default function Login() {
  return (
    <>
      <h1>Sign in</h1>
      <p>Sign in to this application with your password.</p>
      <section className="panel">
        <AuthForm />
        <p>
          Privileged accounts require approved provisioning. Public registration
          is unavailable.
        </p>
      </section>
    </>
  );
}
