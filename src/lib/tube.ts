import type { DriverType, TubeBadgeValue } from "../types";

/**
 * Tube-amp compatibility rule (spec §4):
 *
 * - impedance >= 120 Ω              → Yes ("Perfect Match")
 * - 32 Ω <= impedance < 120 Ω:
 *     driver type = Dynamic          → OTL Only ("Limited Compatibility")
 *     driver type != Dynamic         → Transformer Only ("Not Recommended")
 * - impedance < 32 Ω                → No ("Not Supported")
 * - impedance unknown (null/NaN)    → no badge
 *
 * With a known impedance in 32–119 Ω but no driver type, the rule is
 * underdetermined, so no badge is returned either.
 */
export function deriveTubeBadge(
 impedance: number | null,
 driverType: DriverType | null,
): TubeBadgeValue | null {
 if (impedance === null || Number.isNaN(impedance)) {
  return null;
 }
 if (impedance >= 120) {
  return "Yes";
 }
 if (impedance >= 32) {
  if (driverType === null) {
   return null;
  }
  return driverType === "Dynamic" ? "OTL Only" : "Transformer Only";
 }
 return "No";
}

/**
 * Localized display label for a tube badge value (stored values like
 * "OTL Only" stay stable; only the display text is translated).
 */
export function tubeBadgeLabel(
 badge: TubeBadgeValue,
 t: (key: string) => string,
): string {
 return t(`tube.badges.${badge}`);
}

/**
 * Human-readable form of the rule (display labels, not stored values),
 * for the settings page / tooltip.
 */
export function describeTubeRule(t: (key: string) => string): string {
 return [
  t("tubeRule.high"),
  t("tubeRule.dynamic"),
  t("tubeRule.nonDynamic"),
  t("tubeRule.low"),
  t("tubeRule.unknown"),
 ].join(" · ");
}
