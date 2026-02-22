"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  // ReferenceLine, // future: benchmark overlay — overall_leader_hf (see GitHub issue #1)
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse } from "@/lib/types";

interface ComparisonChartProps {
  data: CompareResponse;
  // showBenchmark?: boolean; // future: benchmark overlay (see GitHub issue #1)
}

export function ComparisonChart({ data }: ComparisonChartProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));

  const chartData = stages.map((stage) => {
    const row: Record<string, string | number> = {
      name: `S${stage.stage_num}`,
    };
    for (const comp of competitors) {
      const sc = stage.competitors[comp.id];
      const key = `${comp.competitor_number}_${comp.id}`;
      if (!sc || sc.dnf || sc.dq) {
        row[key] = 0;
        row[`${key}_opacity`] = 0.25;
      } else {
        row[key] = sc.hit_factor ?? 0;
        row[`${key}_opacity`] = sc.zeroed ? 0.3 : 1;
      }
    }
    return row;
  });

  const formatLabel = (id: number) => {
    const comp = competitors.find((c) => c.id === id);
    return comp ? `#${comp.competitor_number} ${comp.name.split(" ")[0]}` : String(id);
  };

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
          allowDecimals
          tickFormatter={(v: number) => v.toFixed(1)}
          label={{
            value: "Hit Factor",
            angle: -90,
            position: "insideLeft",
            offset: 10,
            style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value: number | undefined, name: string | undefined) => {
            const id = parseInt((name ?? "").split("_").pop() ?? "0", 10);
            return [
              typeof value === "number" ? value.toFixed(4) : "—",
              formatLabel(id),
            ];
          }}
        />
        <Legend
          formatter={(value: string) => {
            const id = parseInt(value.split("_").pop() ?? "0", 10);
            return formatLabel(id);
          }}
        />
        {/* future benchmark overlay hook — do not remove:
        {showBenchmark && stages[0] && (
          <ReferenceLine y={stages[0].overall_leader_hf ?? 0} stroke="gray" strokeDasharray="4 2" label="Field leader" />
        )}
        */}
        {competitors.map((comp) => {
          const key = `${comp.competitor_number}_${comp.id}`;
          return (
            <Bar
              key={comp.id}
              dataKey={key}
              fill={colorMap[comp.id]}
              name={key}
              radius={[3, 3, 0, 0]}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
