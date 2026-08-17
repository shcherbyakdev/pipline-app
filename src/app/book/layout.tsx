export default function BookLayout({ children }: { children: React.ReactNode }) {
  // The page itself paints the ground (in the org's widget theme); this only
  // makes it fill the viewport.
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}
