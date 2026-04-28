import type { CompetitorShape } from "@/lib/colors";

interface CompetitorMarkerProps {
  cx: number;
  cy: number;
  size?: number;
  fill: string;
  shape: CompetitorShape;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
}

// Renders a small SVG glyph for a competitor series. The shape carries the same
// information as fill color, so series remain distinguishable when color cycles
// (>8 competitors) and under deuteranopia/protanopia.
//
// Suitable for use as a recharts <Line dot={...}> renderer or <Scatter shape={...}>.
// Standalone in a legend — wrap in an <svg> sized to fit (see CompetitorLegendSwatch).
export function CompetitorMarker({
  cx,
  cy,
  size = 10,
  fill,
  shape,
  opacity,
  stroke,
  strokeWidth,
}: CompetitorMarkerProps) {
  const r = size / 2;
  const common = { fill, opacity, stroke, strokeWidth };
  switch (shape) {
    case "circle":
      return <circle cx={cx} cy={cy} r={r} {...common} />;
    case "square":
      return (
        <rect x={cx - r} y={cy - r} width={size} height={size} {...common} />
      );
    case "triangle":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`}
          {...common}
        />
      );
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
          {...common}
        />
      );
    case "cross": {
      const t = r / 2.4;
      const points = [
        [cx - t, cy - r],
        [cx + t, cy - r],
        [cx + t, cy - t],
        [cx + r, cy - t],
        [cx + r, cy + t],
        [cx + t, cy + t],
        [cx + t, cy + r],
        [cx - t, cy + r],
        [cx - t, cy + t],
        [cx - r, cy + t],
        [cx - r, cy - t],
        [cx - t, cy - t],
      ]
        .map((p) => p.join(","))
        .join(" ");
      return <polygon points={points} {...common} />;
    }
    case "star": {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r / 2.4;
        pts.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
      }
      return <polygon points={pts.join(" ")} {...common} />;
    }
    case "wye": {
      const armW = r / 2.4;
      const armH = r;
      const arm = (angleDeg: number) => {
        const a = (angleDeg * Math.PI) / 180;
        const px = Math.cos(a + Math.PI / 2) * armW;
        const py = Math.sin(a + Math.PI / 2) * armW;
        const ex = Math.cos(a) * armH;
        const ey = Math.sin(a) * armH;
        const p1 = [cx + px, cy + py];
        const p2 = [cx + ex + px, cy + ey + py];
        const p3 = [cx + ex - px, cy + ey - py];
        const p4 = [cx - px, cy - py];
        return `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]} L${p4[0]},${p4[1]} Z`;
      };
      const d = [arm(-90), arm(30), arm(150)].join(" ");
      return <path d={d} {...common} />;
    }
  }
}

interface SwatchProps {
  size?: number;
  fill: string;
  shape: CompetitorShape;
  ariaLabel?: string;
}

// Standalone SVG glyph for chart legends. Defaults to a 12px box.
export function CompetitorLegendSwatch({
  size = 12,
  fill,
  shape,
  ariaLabel,
}: SwatchProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-none"
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <CompetitorMarker
        cx={size / 2}
        cy={size / 2}
        size={size - 1}
        fill={fill}
        shape={shape}
      />
    </svg>
  );
}
