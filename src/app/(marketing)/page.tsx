import { SITE } from "@/features/marketing/site";

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-24">
      <h1 className="text-5xl font-semibold tracking-tight">{SITE.headline}</h1>
    </main>
  );
}
