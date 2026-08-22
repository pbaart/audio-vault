import { Siren } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TubeBadgeValue } from "../types";
import { tubeBadgeLabel } from "../lib/tube";
import { cls } from "../ui";

interface TubeBadgeProps {
  badge: TubeBadgeValue;
  size?: "sm" | "md";
  /** Solid colored dot (no icon/text) for use on top of images (grid view). */
  dot?: boolean;
}

const BADGE_STYLES: Record<TubeBadgeValue, string> = {
  Yes: "border-tm-green/40 bg-tm-green/10 text-tm-green",
  "OTL Only": "border-tm-orange/40 bg-tm-orange/10 text-tm-orange",
  "Transformer Only": "border-tm-blue/40 bg-tm-blue/10 text-tm-blue",
  No: "border-tm-gray/40 bg-tm-gray/10 text-tm-gray",
};

/** Solid (opaque) backgrounds for the dot variant on images. */
const SOLID_STYLES: Record<TubeBadgeValue, string> = {
  Yes: "bg-tm-green",
  "OTL Only": "bg-tm-orange",
  "Transformer Only": "bg-tm-blue",
  No: "bg-tm-gray",
};

/** Colored tube-amp compatibility badge (computed by the rule in lib/tube). */
export function TubeBadge({ badge, size = "md", dot = false }: TubeBadgeProps) {
  const { t } = useTranslation();
  if (dot) {
    return (
      <span
        title={t(`tube.dot.${badge}`)}
        className={cls(
          "inline-block rounded-full ring-2 ring-black/30",
          size === "sm" ? "h-4 w-4" : "h-5 w-5",
          SOLID_STYLES[badge],
        )}
      />
    );
  }
  return (
    <span
      title={t("tube.tooltip")}
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
