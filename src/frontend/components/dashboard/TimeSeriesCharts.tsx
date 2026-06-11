/**
 * @fileoverview Time-series chart panels for the dashboard charts grid.
 *
 * Two further recharts variations over date-keyed data, both wrapped in
 * `<ChartContainer>` with the Monolith OKLCH palette and high-contrast text:
 *   - {@link TasksOverTimeArea} — stacked gradient Area chart (created vs
 *     completed) with a Line overlay feel; demonstrates the area/line family.
 *   - {@link ThroughputBar}     — single-series Bar chart of completed/day.
 *
 * Dates arrive as `YYYY-MM-DD`; we render them as short month/day ticks.
 */

"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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

import type { TasksOverTimePoint, ThroughputPoint } from "./types";

const AXIS_TICK = { fill: "hsl(var(--foreground))", fontSize: 12 } as const;

/** `YYYY-MM-DD` → short axis label like "Jun 7" (UTC-safe). */
function shortAxisDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Tasks over time — created vs completed (Area + gradient fills)
// ---------------------------------------------------------------------------

const OVER_TIME_CONFIG: ChartConfig = {
  created: { label: "Created", color: "var(--chart-1)" },
  completed: { label: "Completed", color: "var(--chart-5)" },
};

export function TasksOverTimeArea({ data }: { data: TasksOverTimePoint[] }) {
  return (
    <ChartContainer config={OVER_TIME_CONFIG} className="aspect-video w-full">
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-created)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--color-created)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-completed)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--color-completed)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={shortAxisDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          allowDecimals={false}
          width={36}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={(v) => shortAxisDate(String(v))} />}
        />
        <Area
          dataKey="created"
          type="monotone"
          stroke="var(--color-created)"
          fill="url(#fillCreated)"
          strokeWidth={2}
          stackId="a"
        />
        <Area
          dataKey="completed"
          type="monotone"
          stroke="var(--color-completed)"
          fill="url(#fillCompleted)"
          strokeWidth={2}
          stackId="b"
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

// ---------------------------------------------------------------------------
// Throughput — completed tasks per day (single-series Bar)
// ---------------------------------------------------------------------------

const THROUGHPUT_CONFIG: ChartConfig = {
  value: { label: "Completed", color: "var(--chart-2)" },
};

export function ThroughputBar({ data }: { data: ThroughputPoint[] }) {
  const max = useMemo(() => Math.max(0, ...data.map((d) => d.value)), [data]);
  return (
    <ChartContainer config={THROUGHPUT_CONFIG} className="aspect-video w-full">
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={shortAxisDate}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          allowDecimals={false}
          width={36}
          domain={[0, Math.max(max, 1)]}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelFormatter={(v) => shortAxisDate(String(v))} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ChartContainer>
  );
}
