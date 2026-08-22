import type { PeqBand } from "../types";
import { useTranslation } from "react-i18next";
import { buildPeqSvgModel } from "../lib/peqCurve";

/**
 * PEQ magnitude-response graph, styled after opra.roon.app: log-frequency
 * axis, ±15 dB grid, gradient fill under the curve, and a dot at every
 * band's (frequency, gain). JSX-only rendering — theme colors come from
 * the active chart palette via buildPeqSvgModel. Renders nothing when
 * there are no usable bands (the caller shows a hint instead).
 */
export function PeqGraph({ bands }: { bands: PeqBand[] }) {
  const { t } = useTranslation();
  const m = buildPeqSvgModel(bands);
  if (!m) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${m.w} ${m.h}`}
      className="w-full"
      style={{
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 6,
      }}
    >
      <defs>
        <linearGradient id={m.fillGradient.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={m.fillGradient.top} />
          <stop offset="100%" stopColor={m.fillGradient.bottom} />
        </linearGradient>
      </defs>
      {m.lines.map((l, i) => (
        <line
          key={`l${i}`}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={l.stroke}
          strokeWidth={l.width}
        />
      ))}
      {m.labels.map((t, i) => (
        <text
          key={`t${i}`}
          x={t.x}
          y={t.y}
          fill={t.fill}
          fontSize={11}
          textAnchor={t.anchor}
        >
          {t.text}
        </text>
      ))}
      <text x={m.legend.x} y={m.legend.y} fill={m.legend.fill} fontSize={11}>
        {m.legend.text}
      </text>
      <path d={m.fillPath} fill={`url(#${m.fillGradient.id})`} />
      {m.markers.map((mk, i) => (
        <circle key={`m${i}`} cx={mk.x} cy={mk.y} r={3} fill={m.markerFill} />
      ))}
      <path
        d={m.curvePath}
        fill="none"
        stroke={m.curve}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <text
        x={m.axisTitle.x}
        y={m.axisTitle.y}
        fill={m.axisTitle.fill}
        fontSize={11}
        textAnchor="middle"
      >
        {t("peq.axisTitle")}
      </text>
    </svg>
  );
}
