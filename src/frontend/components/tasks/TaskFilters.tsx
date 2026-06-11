/**
 * @fileoverview TaskFilters — the filter bar shared by the TaskList table
 * (covers the hextaui "task-filters" block). A controlled component: it owns no
 * state; the parent passes the current `value` and an `onChange` patch handler.
 *
 * Filters: free-text search, status, priority, project, assignee, label, sort.
 * The project dropdown is populated from `useProjects()`.
 */

import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FilterSelect } from "./FilterSelect";
import { useProjects } from "./useProjects";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "./types";

/** The shape of the task-list query the parent tracks. */
export interface TaskQuery {
  q: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string;
  assignee?: string;
  label?: string;
  sort: string;
}

const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as TaskStatus[]).map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

const PRIORITY_OPTIONS = (Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((value) => ({
  value,
  label: PRIORITY_LABELS[value],
}));

const SORT_OPTIONS = [
  { value: "createdAt", label: "Recently created" },
  { value: "dueDate", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "position", label: "Manual order" },
];

export interface TaskFiltersProps {
  value: TaskQuery;
  onChange: (patch: Partial<TaskQuery>) => void;
  onClear: () => void;
}

export function TaskFilters({ value, onChange, onClear }: TaskFiltersProps) {
  const { options: projectOptions } = useProjects();

  const hasActiveFilters = Boolean(
    value.q || value.status || value.priority || value.projectId || value.assignee || value.label,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Search tasks…"
            className="pl-8"
            aria-label="Search tasks"
          />
        </div>
        <Input
          value={value.assignee ?? ""}
          onChange={(e) => onChange({ assignee: e.target.value || undefined })}
          placeholder="Assignee"
          className="max-w-[10rem]"
          aria-label="Filter by assignee"
        />
        <Input
          value={value.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          placeholder="Label"
          className="max-w-[9rem]"
          aria-label="Filter by label"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={value.status}
          onChange={(v) => onChange({ status: v as TaskStatus | undefined })}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
          aria-label="Filter by status"
        />
        <FilterSelect
          value={value.priority}
          onChange={(v) => onChange({ priority: v as TaskPriority | undefined })}
          options={PRIORITY_OPTIONS}
          allLabel="All priorities"
          aria-label="Filter by priority"
        />
        <FilterSelect
          value={value.projectId}
          onChange={(v) => onChange({ projectId: v })}
          options={projectOptions}
          allLabel="All projects"
          aria-label="Filter by project"
        />
        <FilterSelect
          value={value.sort}
          onChange={(v) => onChange({ sort: v ?? "createdAt" })}
          options={SORT_OPTIONS}
          allLabel="Recently created"
          aria-label="Sort tasks"
        />
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
            <XIcon className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
