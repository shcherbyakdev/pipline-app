import { SITE } from "@/features/marketing/site";

export function EmbedSnippetMock() {
  const slug = SITE.name.toLowerCase();
  const LINES = [
    `<div id="${slug}-widget"></div>`,
    `<script src="https://${slug}.example/embed.js"`,
    `        data-handle="anna-kovac" async></script>`,
  ];
  return (
    <div aria-hidden="true" className="bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        <span className="text-muted-foreground ml-2 text-xs">index.html</span>
      </div>
      {/* tabIndex={-1}: the card is aria-hidden, so this scroller must stay out of the tab order. */}
      <pre tabIndex={-1} className="overflow-x-auto p-4 font-mono text-xs leading-6">
        {LINES.map((l, i) => (
          <div key={i} className="flex">
            <span className="text-muted-foreground w-6 shrink-0 select-none">{i + 1}</span>
            <span>{l}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
