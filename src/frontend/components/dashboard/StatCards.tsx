/**
 * @fileoverview Stat-card row for the Admin Dashboard.
 *
 * Renders six KPI cards derived from `GET /api/dashboard/stats`:
 *   Total Projects · Active Projects · Total Tasks · Completed Tasks ·
 *   Completion Rate · Overdue Tasks.
 *
 * Each card shows a label, a big compact number, a small contextual subtext,
 * and a lucide icon. While the stats request is in flight the whole row is
 * replaced with matching skeletons; on failure an inline error (with retry)
 * spans the row. Monolith styling: `bg-card` + `ring-1 ring-border/40`, never
 * a traditional 1px border.
 */

"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FolderKanban,
  ListTodo,
  Target,
  Zap,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { InlineError } from "./shared";
import type { DashboardStats } from "./types";
import type { Resource } from "./useDashboardData";

interface StatDef {
  key: string;
  label: string;
  icon: typeof Target;
  value: (s: DashboardStats) => string;
  subtext: (s: DashboardStats) => string;
  /** Optional accent for the icon chip (drawn from the chart palette). */
  accent?: string;
}

const STAT_DEFS: StatDef[] = [
  {
    key: "totalProjects",
    label: "Total Projects",
    icon: FolderKanban,
    value: (s) => compactNumber(s.totalProjects),
    subtext: (s) => `${compactNumber(s.activeProjects)} active`,
    accent: "var(--chart-1)",
  },
  {
    key: "activeProjects",
    label: "Active Projects",
    icon: Zap,
    value: (s) => compactNumber(s.activeProjects),
    subtext: (s) =>
      s.totalProjects > 0
        ? `${Math.round((s.activeProjects / s.totalProjects) * 100)}% of portfolio`
        : "no projects yet",
    accent: "var(--chart-2)",
  },
  {
    key: "totalTasks",
    label: "Total Tasks",
    icon: ListTodo,
    value: (s) => compactNumber(s.totalTasks),
    subtext: (s) => `${compactNumber(s.completedTasks)} completed`,
    accent: "var(--chart-3)",
  },
  {
    key: "completedTasks",
    label: "Completed Tasks",
    icon: CheckCircle2,
    value: (s) => compactNumber(s.completedTasks),
    subtext: (s) =>
      `${compactNumber(Math.max(s.totalTasks - s.completedTasks, 0))} remaining`,
    accent: "var(--chart-5)",
  },
  {
    key: "completionRatePct",
    label: "Completion Rate",
    icon: Target,
    value: (s) => `${s.completionRatePct}%`,
    subtext: (s) => `${compactNumber(s.completedTasks)} / ${compactNumber(s.totalTasks)} tasks`,
    accent: "var(--chart-2)",
  },
  {
    key: "overdueTasks",
    label: "Overdue Tasks",
    icon: AlertTriangle,
    value: (s) => compactNumber(s.overdueTasks),
    subtext: (s) =>
      s.overdueTasks > 0 ? "needs attention" : "all on schedule",
    accent: "var(--chart-4)",
  },
];

/** Grid wrapper: 1 col on mobile → 2 → 3 → 6 across breakpoints. */
function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {children}
    </div>
  );
}

export function StatCards({ resource }: { resource: Resource<DashboardStats> }) {
  const { data, loading, error, reload } = resource;

  if (error) {
    return <InlineError message={error} onRetry={reload} />;
  }

  if (loading && !data) {
    return (
      <CardGrid>
        {STAT_DEFS.map((d) => (
          <Card key={d.key}>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="size-8 rounded-md" />
              </div>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </CardGrid>
    );
  }

  if (!data) return null;

  return (
    <CardGrid>
      {STAT_DEFS.map((d) => {
        const Icon = d.icon;
        const isAlert = d.key === "overdueTasks" && data.overdueTasks > 0;
        return (
          <Card key={d.key} className="transition-colors hover:bg-card/80">
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {d.label}
                </span>
                <span
                  className="flex size-8 items-center justify-center rounded-md ring-1 ring-border/40"
                  style={{ backgroundColor: `color-mix(in oklch, ${d.accent} 14%, transparent)` }}
                >
                  <Icon
                    className="size-4"
                    style={{ color: d.accent }}
                    aria-hidden
                  />
                </span>
              </div>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                {d.value(data)}
              </span>
              <span
                className={cn(
                  "text-xs",
                  isAlert ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {d.subtext(data)}
              </span>
            </CardContent>
          </Card>
        );
      })}
    </CardGrid>
  );
}
