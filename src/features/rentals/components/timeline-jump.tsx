"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DatePicker } from "@/features/scheduling/components/date-picker";

/* The timeline's window label doubles as "go to date": it is the app's
   DatePicker wearing the label, and a pick moves the window to start on
   that day (the URL's `from`), zoom and scope kept. */
export function TimelineJump({ from, label, hrefBase }: { from: string; label: string; hrefBase: string }) {
  const router = useRouter();
  const t = useTranslations("bookings");
  return (
    <DatePicker
      value={from}
      onCommit={(date) => router.push(`${hrefBase}&from=${date}`)}
      label={t("timeline.goTo")}
      className="ml-1.5 h-8 border-transparent bg-transparent px-1.5 text-[15px] font-medium tabular-nums hover:bg-muted"
    >
      {label}
    </DatePicker>
  );
}
