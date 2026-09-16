import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import { TERMINAL_STATUSES, type ProgressEvent, type Task } from "../types";

export function useTasks() {
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const streamsRef = useRef<Map<string, EventSource>>(new Map());

  const patchTask = useCallback((taskId: string, patch: Partial<Task>) => {
    setTasks((prev) => {
      const existing = prev[taskId];
      if (!existing) return prev;
      return { ...prev, [taskId]: { ...existing, ...patch } };
    });
  }, []);

  const attachStream = useCallback((taskId: string, streamToken: string) => {
    if (streamsRef.current.has(taskId)) return;
    // Token đi qua query string vì EventSource không gửi được header (B13).
    const url = `${api.getBaseUrl()}/downloads/${taskId}/stream?token=${encodeURIComponent(streamToken)}`;
    const es = new EventSource(url);
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

  const hydrate = useCallback(async () => {
    const res = await api.getActiveTasks();
    if (!res) return;
    for (const t of res.tasks) {
      setTasks((prev) => ({
        ...prev,
        [t.task_id]: {
          url: t.url,
          title: t.title,
          status: t.status,
          completed: t.progress,
          speed: t.avg_speed ?? "--",
          formatId: null,
          outputPath: t.output_path,
        },
      }));
      // Task này có thể do extension hoặc CLI khởi động, nên ta không có token.
      // Xin một cái mới — cơ chế đã có sẵn cho đường khôi phục sau khi mở lại app.
      const tok = await api.refreshStreamToken(t.task_id);
      if (tok?.stream_token) attachStream(t.task_id, tok.stream_token);
    }
  }, [attachStream]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onRefresh = () => void hydrate();
    window.addEventListener("streamloot:refresh", onRefresh);
    return () => window.removeEventListener("streamloot:refresh", onRefresh);
  }, [hydrate]);

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
    attachStream(result.task_id, result.stream_token);
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
