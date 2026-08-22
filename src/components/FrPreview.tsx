import { buildFrSvgModel } from "../lib/renderFr";

/**
 * FR measurement preview for the web-fetch panel (JSX; theme colors come
 * from the active chart palette via buildFrSvgModel). Renders nothing when
 * there are fewer than two curve points.
 */
export function FrPreview({ curve }: { curve: number[][] }) {
  const m = buildFrSvgModel(curve);
  if (!m) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={m.w}
      height={m.h}
      viewBox={`0 0 ${m.w} ${m.h}`}
      className="h-auto w-full"
      style={{
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 6,
      }}
    >
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
      <path
        d={m.path}
        fill="none"
        stroke={m.curve}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <text x={8} y={m.h - 8} fill={m.label} fontSize={12}>
        20 Hz
      </text>
      <text
        x={m.w - 8}
        y={m.h - 8}
        fill={m.label}
        fontSize={12}
        textAnchor="end"
      >
        20 kHz
      </text>
    </svg>
  );
}
