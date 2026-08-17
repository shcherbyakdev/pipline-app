import { cn } from "@/lib/utils";
import { SECTIONS } from "@/features/marketing/site";
import { EmbedSnippetMock } from "./mocks/embed-snippet-mock";

export function EmbedShowcase() {
  return (
    <section aria-labelledby="embed-heading" className="bg-muted/40 border-t">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2">
        <div className="max-w-xl">
          <h2 id="embed-heading" className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">{SECTIONS.embed.heading}</h2>
          {SECTIONS.embed.paragraphs.map((text, i) => (
            <p key={text} className={cn("text-muted-foreground leading-relaxed", i === 0 ? "mt-4" : "mt-3")}>
              {text}
            </p>
          ))}
        </div>
        <EmbedSnippetMock />
      </div>
    </section>
  );
}
