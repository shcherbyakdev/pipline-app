export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  // No max-w here — the iframe's box is the constraint, not our layout.
  return <main className="p-4">{children}</main>;
}
