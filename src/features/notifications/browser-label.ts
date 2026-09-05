/* A user-agent string → "Chrome on Android", for the devices list. Pure,
   coarse on purpose: the person only needs to tell their phone from their
   laptop. Order matters (Edge and Opera carry "Chrome"; Chrome on iOS
   carries "Safari"). Unknown → null and the page says "Unknown browser". */
export function browserLabel(ua: string | null | undefined): { browser: string; os: string } | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /CriOS\//.test(ua) || /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (!browser && !os) return null;
  return { browser: browser ?? "Browser", os: os ?? "" };
}
