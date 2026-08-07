import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Sign in to RolloutOS
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          We&apos;ll email you a magic link — no password needed.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
