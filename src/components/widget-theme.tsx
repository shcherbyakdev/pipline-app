import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { themeCssVars } from "@/lib/widget-theme";
import { widgetFontClass } from "@/lib/widget-fonts";
import { cn } from "@/lib/utils";

export function WidgetTheme({
  config,
  accentColor,
  transparent = false,
  className,
  children,
}: {
  config: WidgetThemeConfig;
  accentColor: string | null;
  // Embed surfaces default to painting NO background so the widget sits
  // natively on any host page; an explicit background override re-enables
  // painting (the caller decides — see /embed/[handle]).
  transparent?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "widget-theme",
        `wt-${config.theme}`,
        transparent && "wt-transparent",
        widgetFontClass(config.font),
        className,
      )}
      style={themeCssVars(config, accentColor)}
    >
      {children}
    </div>
  );
}
