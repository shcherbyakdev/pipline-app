import { appIcon } from "@/lib/app-icon";

// Manifest icons (192 for the install prompt, 512 for the splash) from the
// one drawing in lib/app-icon.tsx. Clamped so a stray ?size= cannot ask for
// a 10k-pixel render.
export function GET(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("size"));
  const size = Number.isFinite(raw) ? Math.min(512, Math.max(64, Math.round(raw))) : 192;
  return appIcon(size);
}
