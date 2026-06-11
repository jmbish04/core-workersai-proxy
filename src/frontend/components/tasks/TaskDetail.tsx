/**
 * @fileoverview TaskDetail — the `/tasks/[id]` island (hextaui task-detail +
 * task-progress). Fetches `GET /api/tasks/{id}` and renders an editable detail
 * panel:
 *   - inline-editable title + description (PATCH on blur/save)
 *   - status + priority selects (PATCH)
 *   - progress bar with a stepper (−/+ 10) and quick presets (task-progress)
 *   - assignee, labels, due date, created/updated metadata
 *   - delete via AlertDialog → `DELETE /api/tasks/{id}` (no window.confirm)
 *
 * Receives the route `id` from the Astro page (`Astro.params.id`).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet, apiSend, ApiError } from "@/lib/api";
import { shortDate, relativeTime } from "@/lib/format";

import { AssigneeAvatar, ErrorState, LabelChips } from "./Shared";
import { useProjects } from "./useProjects";
import {
  BOARD_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "./types";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

export interface TaskDetailProps {
  id: string;
}

function clampProgress(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function TaskDetail({ id }: TaskDetailProps) {
  const { nameById } = useProjects();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Local editable buffers for the text fields.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<Task>(`tasks/${id}`);
      setTask(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load task.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Patch a set of fields, optimistically updating local state. */
  const patch = useCallback(
    async (body: Partial<Task>) => {
      if (!task) return;
      const prev = task;
      setSaving(true);
      setError(null);
      setTask({ ...task, ...body });
      try {
        const updated = await apiSend<Task>("PATCH", `tasks/${task.id}`, body);
        setTask(updated);
      } catch (e) {
        setTask(prev);
        setError(e instanceof ApiError ? e.message : "Failed to save changes.");
      } finally {
        setSaving(false);
      }
    },
    [task],
  );

  async function handleDelete() {
    if (!task) return;
    try {
      await apiSend<{ ok: boolean }>("DELETE", `tasks/${task.id}`);
      window.location.href = "/tasks";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete task.");
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !task) {
    return <ErrorState message={error} onRetry={load} />;
  }

  if (!task) {
    return <ErrorState message="Task not found." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <a
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to tasks
        </a>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" size="sm">
                <Trash2Icon className="size-4" />
                Delete
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes “{task.title}”. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                Delete task
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Main column */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4">
              {/* Title */}
              {editingTitle ? (
                <div className="flex flex-col gap-2">
                  <Input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    autoFocus
                    className="text-lg"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={saving || !titleDraft.trim()}
                      onClick={async () => {
                        await patch({ title: titleDraft.trim() });
                        setEditingTitle(false);
                      }}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingTitle(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit title"
                    onClick={() => {
                      setTitleDraft(task.title);
                      setEditingTitle(true);
                    }}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                </div>
              )}

              <Separator className="bg-border/40" />

              {/* Description */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Description
                  </Label>
                  {!editingDesc ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Edit description"
                      onClick={() => {
                        setDescDraft(task.description ?? "");
                        setEditingDesc(true);
                      }}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
                {editingDesc ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      rows={4}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={async () => {
                          await patch({ description: descDraft.trim() || null });
                          setEditingDesc(false);
                        }}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingDesc(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : task.description ? (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {task.description}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">No description</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Progress (task-progress) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Progress value={task.progress} className="flex-1" />
                <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                  {task.progress}%
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Decrease progress by 10"
                  disabled={saving || task.progress <= 0}
                  onClick={() => patch({ progress: clampProgress(task.progress - 10) })}
                >
                  <MinusIcon className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Increase progress by 10"
                  disabled={saving || task.progress >= 100}
                  onClick={() => patch({ progress: clampProgress(task.progress + 10) })}
                >
                  <PlusIcon className="size-4" />
                </Button>
                <Separator orientation="vertical" className="mx-1 h-6 bg-border/40" />
                {PROGRESS_PRESETS.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={task.progress === p ? "secondary" : "ghost"}
                    disabled={saving}
                    onClick={() => patch({ progress: p })}
                  >
                    {p}%
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Metadata sidebar */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Status
                </Label>
                <Select
                  value={task.status}
                  onValueChange={(v) => patch({ status: v as TaskStatus })}
                >
                  <SelectTrigger className="w-full" disabled={saving}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOARD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Priority
                </Label>
                <Select
                  value={task.priority}
                  onValueChange={(v) => patch({ priority: v as TaskPriority })}
                >
                  <SelectTrigger className="w-full" disabled={saving}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-4 text-sm">
              <MetaRow label="Assignee">
                {task.assignee ? (
                  <AssigneeAvatar name={task.assignee} showName />
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </MetaRow>
              <MetaRow label="Project">
                <span className="text-muted-foreground">
                  {task.projectId ? (nameById.get(task.projectId) ?? "—") : "—"}
                </span>
              </MetaRow>
              <MetaRow label="Due date">
                <span className="text-muted-foreground">
                  {task.dueDate != null ? shortDate(task.dueDate) : "—"}
                </span>
              </MetaRow>
              <MetaRow label="Labels">
                {task.labels.length > 0 ? (
                  <LabelChips labels={task.labels} />
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </MetaRow>
              <Separator className="bg-border/40" />
              <MetaRow label="Created">
                <span className="text-muted-foreground">{relativeTime(task.createdAt)}</span>
              </MetaRow>
              <MetaRow label="Updated">
                <span className="text-muted-foreground">{relativeTime(task.updatedAt)}</span>
              </MetaRow>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
