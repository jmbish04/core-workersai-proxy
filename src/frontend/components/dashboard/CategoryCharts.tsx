/**
 * @fileoverview Categorical chart panels for the dashboard charts grid.
 *
 * Three distinct recharts variations, each wrapped in `<ChartContainer>` with
 * the Monolith OKLCH palette (`--chart-1..5`) and high-contrast axis text:
 *   - {@link TasksByStatusDonut}   — donut/pie with a center total label.
 *   - {@link TasksByPriorityBar}   — vertical bar chart, color-per-bar.
 *   - {@link ProjectsByStatusBar}  — horizontal bar chart.
 *
 * All three read `{ name, value }[]` datasets straight from
 * `GET /api/dashboard/charts`. No data is fabricated. Axis/label text is forced
 * to `hsl(var(--foreground))` per the Monolith chart rules.
 */

"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Label as RechartsLabel,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { compactNumber } from "@/lib/format";

import type { NameValue } from "./types";

/** The five-hue palette, indexable for per-slice / per-bar coloring. */
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const AXIS_TICK = { fill: "hsl(var(--foreground))", fontSize: 12 } as const;

/** Build a `ChartConfig` keyed by slugified datum name for legend/tooltip. */
function buildConfig(data: NameValue[]): ChartConfig {
  const cfg: ChartConfig = {};
  data.forEach((d, i) => {
    cfg[d.name] = { label: d.name, color: PALETTE[i % PALETTE.length] };
  });
  return cfg;
}

// ---------------------------------------------------------------------------
// Tasks by status — donut with center total
// ---------------------------------------------------------------------------

export function TasksByStatusDonut({ data }: { data: NameValue[] }) {
  const config = useMemo(() => buildConfig(data), [data]);
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const withFill = useMemo(
    () => data.map((d, i) => ({ ...d, fill: PALETTE[i % PALETTE.length] })),
    [data],
  );

  return (
    <ChartContainer config={config} className="mx-auto aspect-square max-h-[260px]">
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="name" hideLabel />} />
        <Pie
          data={withFill}
          dataKey="value"
          nameKey="name"
          innerRadius={62}
          outerRadius={92}
          strokeWidth={2}
          stroke="hsl(var(--background))"
        >
          <RechartsLabel
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox)) return null;
              const { cx, cy } = viewBox as { cx: number; cy: number };
              return (
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                  <tspan
                    x={cx}
                    y={cy - 6}
                    className="fill-foreground text-2xl font-semibold tabular-nums"
                  >
                    {compactNumber(total)}
                  </tspan>
                  <tspan x={cx} y={cy + 16} className="fill-muted-foreground text-xs">
                    tasks
                  </tspan>
                </text>
              );
            }}
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Tasks by priority — vertical bar, color per bar
// ---------------------------------------------------------------------------

export function TasksByPriorityBar({ data }: { data: NameValue[] }) {
  const config = useMemo(() => buildConfig(data), [data]);
  const withFill = useMemo(
    () => data.map((d, i) => ({ ...d, fill: PALETTE[i % PALETTE.length] })),
    [data],
  );

  return (
    <ChartContainer config={config} className="aspect-video w-full">
      <BarChart data={withFill} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          allowDecimals={false}
          width={32}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64}>
          {withFill.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            className="fill-foreground"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Projects by status — horizontal bar
// ---------------------------------------------------------------------------

export function ProjectsByStatusBar({ data }: { data: NameValue[] }) {
  const config = useMemo(() => buildConfig(data), [data]);
  const withFill = useMemo(
    () => data.map((d, i) => ({ ...d, fill: PALETTE[i % PALETTE.length] })),
    [data],
  );

  return (
    <ChartContainer config={config} className="aspect-video w-full">
      <BarChart
        data={withFill}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          width={84}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={36}>
          {withFill.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            className="fill-foreground"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
