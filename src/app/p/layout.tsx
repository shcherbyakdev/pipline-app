// Bare mobile-first chrome: no dashboard shell, no nav — the link is the
// only way in and the only identity.
export default function ParticipantLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">{children}</div>;
}
