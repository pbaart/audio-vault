import { Siren } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TubeBadgeValue } from "../types";
import { tubeBadgeLabel } from "../lib/tube";
import { cls } from "../ui";

interface TubeBadgeProps {
  badge: TubeBadgeValue;
  size?: "sm" | "md";
  /**
   * Native hover tooltip. Defaults to the tube.tooltip text; pass null to
   * disable it (e.g. when the badge is wrapped in its own styled tooltip).
   */
  tooltip?: string | null;
}

const BADGE_STYLES: Record<TubeBadgeValue, string> = {
  Yes: "border-tm-green/40 bg-tm-green/10 text-tm-green",
  "OTL Only": "border-tm-orange/40 bg-tm-orange/10 text-tm-orange",
  "Transformer Only": "border-tm-blue/40 bg-tm-blue/10 text-tm-blue",
  No: "border-tm-gray/40 bg-tm-gray/10 text-tm-gray",
};

/** Colored tube-amp compatibility badge (computed by the rule in lib/tube). */
export function TubeBadge({ badge, size = "md", tooltip }: TubeBadgeProps) {
  const { t } = useTranslation();
  const tip = tooltip === undefined ? t("tube.tooltip") : tooltip || undefined;
  return (
    <span
      title={tip}
      className={cls(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[12.5px]" : "px-2.5 py-1 text-xs",
        BADGE_STYLES[badge],
      )}
    >
      <Siren size={size === "sm" ? 12 : 14} />
      {tubeBadgeLabel(badge, (k) => t(k))}
    </span>
  );
}
