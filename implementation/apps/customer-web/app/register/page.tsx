import AuthForm from "../login/auth-form";
export default function Register() {
  return (
    <>
      <h1>Create customer account</h1>
      <section className="panel">
        <AuthForm register />
      </section>
    </>
  );
}
