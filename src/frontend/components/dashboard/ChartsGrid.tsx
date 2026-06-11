/**
 * @fileoverview Charts grid — composes all five dashboard charts.
 *
 * Lays out one {@link ChartCard} per recharts variation sourced from
 * `GET /api/dashboard/charts`:
 *   1. Tasks Over Time  → stacked Area (created vs completed)
 *   2. Throughput       → Bar (completed/day)
 *   3. Tasks by Status  → Donut/Pie with center total
 *   4. Tasks by Priority→ Vertical Bar
 *   5. Projects byStatus→ Horizontal Bar
 *
 * The grid collapses to a single column on mobile. The two time-series panels
 * span the full width on large screens (they read better wide); the three
 * categorical panels sit in a 3-up row beneath them. Each card independently
 * surfaces LOADING / ERROR / EMPTY, all driven by one shared charts resource.
 */

"use client";

import { ChartCard } from "./ChartCard";
import {
  ProjectsByStatusBar,
  TasksByPriorityBar,
  TasksByStatusDonut,
} from "./CategoryCharts";
import { TasksOverTimeArea, ThroughputBar } from "./TimeSeriesCharts";
import type { DashboardCharts } from "./types";
import type { Resource } from "./useDashboardData";

export function ChartsGrid({ resource }: { resource: Resource<DashboardCharts> }) {
  const { data, loading, error, reload } = resource;

  const shell = (
    title: string,
    description: string,
    hasData: boolean,
    body: React.ReactNode,
  ) => (
    <ChartCard
      title={title}
      description={description}
      loading={loading && !data}
      error={error}
      onRetry={reload}
      hasData={hasData}
    >
      {body}
    </ChartCard>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Wide time-series row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {shell(
          "Tasks Over Time",
          "Created vs. completed per day.",
          !!data && data.tasksOverTime.length > 0,
          data ? <TasksOverTimeArea data={data.tasksOverTime} /> : null,
        )}
        {shell(
          "Throughput",
          "Tasks completed per day.",
          !!data && data.throughput.length > 0,
          data ? <ThroughputBar data={data.throughput} /> : null,
        )}
      </div>

      {/* Categorical 3-up row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {shell(
          "Tasks by Status",
          "Distribution across the workflow.",
          !!data && data.tasksByStatus.length > 0,
          data ? <TasksByStatusDonut data={data.tasksByStatus} /> : null,
        )}
        {shell(
          "Tasks by Priority",
          "How urgent is the backlog?",
          !!data && data.tasksByPriority.length > 0,
          data ? <TasksByPriorityBar data={data.tasksByPriority} /> : null,
        )}
        {shell(
          "Projects by Status",
          "Portfolio breakdown.",
          !!data && data.projectsByStatus.length > 0,
          data ? <ProjectsByStatusBar data={data.projectsByStatus} /> : null,
        )}
      </div>
    </div>
  );
}
