/* One awaited clipboard write. The write can be refused (permissions,
   insecure context, no focus) and a button must not claim "Copied" when it
   was — portal-links-panel.tsx / staff-list.tsx precedent, shared here for
   the copy-link controls the admin IA slice adds. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** English fallback for the studio's links table (Wave 4 moves it to
    `settings.copyRefused`, which the admin's copy-link controls read). */
export const COPY_REFUSED = "Couldn't copy — select the link text and copy manually.";
