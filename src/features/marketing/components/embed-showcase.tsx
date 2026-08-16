import { EmbedSnippetMock } from "./mocks/embed-snippet-mock";

export function EmbedShowcase() {
  return (
    <section aria-labelledby="embed-heading" className="bg-muted/40 border-t">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2">
        <div className="max-w-xl">
          <h2 id="embed-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Paste one line. The widget resizes itself.</h2>
          <p className="text-muted-foreground mt-4 leading-relaxed">
            Drop the snippet into any website builder or plain HTML page. The booking widget loads inside your page,
            adjusts its own height as clients move through the steps, and never asks them to leave your site.
          </p>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            Prefer a link? The same page works standalone at your own handle — share it in email, on social, or in your bio.
          </p>
        </div>
        <EmbedSnippetMock />
      </div>
    </section>
  );
}
