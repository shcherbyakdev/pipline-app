/* Optional page intro under the top bar: what this page is for, in one line.
   The page *title* lives in the top bar (see TopBar); this is the job note. */
export function PageIntro({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground -mt-1 text-sm">{children}</p>;
}
