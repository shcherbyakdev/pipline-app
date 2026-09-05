import { appIcon } from "@/lib/app-icon";

// iOS Home Screen icon (Add to Home Screen — the only way iOS delivers Web
// Push, spec 2026-09-05 §2). iOS ignores manifest icons and reads this.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180);
}
