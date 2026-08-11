// Read-only client surface: wider than /p (office viewers, tables of
// sites), same bare chrome — the link is the only way in.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4">{children}</div>;
}
