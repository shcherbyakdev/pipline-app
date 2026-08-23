import type { Section, SectionOf, SectionType } from "../../schema";

export type FormProps<T extends SectionType> = {
  section: SectionOf<T>;
  /** zod messages keyed by relative field path ("headline", "items.2.url"). */
  issues: Record<string, string>;
  supabaseUrl: string;
  onChange: (next: SectionOf<T>) => void;
};

export function patch<T extends Section>(section: T, changes: Partial<T>): T {
  return { ...section, ...changes };
}
