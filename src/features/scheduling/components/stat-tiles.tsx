export function StatTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="mt-1 text-2xl font-semibold">{value}</span>
      {caption ? <span className="text-muted-foreground mt-0.5 text-xs">{caption}</span> : null}
    </div>
  );
}
