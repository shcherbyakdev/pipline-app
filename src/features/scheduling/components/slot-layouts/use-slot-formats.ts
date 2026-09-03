"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { INTL_LOCALES } from "@/i18n/config";
import { slotFormats } from "./group";

/** The slot formatters in the viewer's language — built once per locale. */
export function useSlotFormats() {
  const locale = useLocale();
  return React.useMemo(() => slotFormats(INTL_LOCALES[locale]), [locale]);
}
