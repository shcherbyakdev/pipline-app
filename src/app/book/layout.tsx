export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <main className="mx-auto w-full max-w-lg p-6">{children}</main>
    </div>
  );
}
