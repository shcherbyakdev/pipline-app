import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { themeCssVars } from "@/lib/widget-theme";
import { widgetFontClass } from "@/lib/widget-fonts";
import { cn } from "@/lib/utils";

export function WidgetTheme({
  config,
  accentColor,
  className,
  children,
}: {
  config: WidgetThemeConfig;
  accentColor: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("widget-theme", `wt-${config.theme}`, widgetFontClass(config.font), className)}
      style={themeCssVars(config, accentColor)}
    >
      {children}
    </div>
  );
}
