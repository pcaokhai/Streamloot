import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import { TERMINAL_STATUSES, type ProgressEvent, type Task } from "../types";

const STORAGE_KEY = "downloader.activeTaskIds";

function loadStoredTaskIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveStoredTaskIds(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function useTasks() {
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const streamsRef = useRef<Map<string, EventSource>>(new Map());
  // Guards the persist-effect below from firing on the very first mount
  // render (tasks = {}) before the rehydration effect has read the
  // stored id list — without this, the persist-effect wins the race and
  // overwrites the stored list with [] before rehydration ever sees it.
  const hydratedRef = useRef(false);

  const patchTask = useCallback((taskId: string, patch: Partial<Task>) => {
    setTasks((prev) => {
      const existing = prev[taskId];
      if (!existing) return prev;
      return { ...prev, [taskId]: { ...existing, ...patch } };
    });
  }, []);

  const attachStream = useCallback((taskId: string) => {
    if (streamsRef.current.has(taskId)) return;
    const es = new EventSource(`${api.getBaseUrl()}/downloads/${taskId}/stream`);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as ProgressEvent;
      patchTask(taskId, {
        status: data.status,
        completed: data.completed,
        speed: data.speed,
        ...(data.title ? { title: data.title } : {}),
        ...(data.output_path ? { outputPath: data.output_path } : {}),
      });
      if (TERMINAL_STATUSES.has(data.status)) {
        es.close();
        streamsRef.current.delete(taskId);
      }
    };
    es.onerror = () => {
      es.close();
      streamsRef.current.delete(taskId);
    };
    streamsRef.current.set(taskId, es);
  }, [patchTask]);

  // Persist the active task-id list whenever the set of known tasks changes
  // (not on every field update) so a relaunch can rehydrate live progress.
  // Skipped until the rehydration effect below has run once — see hydratedRef.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveStoredTaskIds(Object.keys(tasks));
  }, [tasks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storedIds = loadStoredTaskIds();
      for (const taskId of storedIds) {
        try {
          const t = await api.getTask(taskId);
          if (!t || cancelled) continue;
          setTasks((prev) => ({
            ...prev,
            [taskId]: {
              url: t.url,
              title: t.title,
              status: t.status,
              completed: t.progress,
              speed: t.avg_speed ?? "--",
              formatId: null,
              outputPath: t.output_path,
            },
          }));
          if (!TERMINAL_STATUSES.has(t.status)) attachStream(taskId);
        } catch {
          // Task no longer exists server-side (e.g. db reset) — drop it silently.
        }
      }
      if (!cancelled) hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount — attachStream/patchTask are stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginDownload = useCallback(async (url: string, formatId: string | null, title: string | null) => {
    const result = await api.startDownload(url, formatId);
    if (!result) throw new Error("No response from server");
    setTasks((prev) => ({
      ...prev,
      [result.task_id]: {
        url,
        title,
        status: "pending",
        completed: 0,
        speed: "--",
        formatId,
        outputPath: null,
      },
    }));
    attachStream(result.task_id);
    return result.task_id;
  }, [attachStream]);

  const cancel = useCallback((taskId: string) => api.cancelTask(taskId).catch(() => {
    // 409 means it already finished naturally — the stream delivers the
    // real terminal status shortly; nothing to do.
  }), []);

  const pause = useCallback((taskId: string) => api.pauseTask(taskId), []);
  const resume = useCallback((taskId: string) => api.resumeTask(taskId), []);

  return { tasks, beginDownload, cancel, pause, resume };
}
