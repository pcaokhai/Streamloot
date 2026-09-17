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
    let res;
    try {
      res = await api.getActiveTasks();
    } catch (err) {
      // request() ném khi backend trả lỗi. Không bắt ở đây thì promise bị từ
      // chối lặng lẽ và hydrate chết giữa chừng — cửa sổ trống trơn mà console
      // là nơi duy nhất biết chuyện.
      console.error("Không lấy được danh sách task đang chạy:", err);
      return;
    }
    if (!res) return;
    // MERGE với state hiện có, không thay hoàn toàn: hydrate() chạy lại mỗi lần
    // cửa sổ được show (streamloot:refresh), và snapshot REST không mang theo
    // formatId (client chọn lúc bấm tải, server không lưu/trả lại field này).
    // Ghi đè toàn bộ như trước sẽ xoá mất formatId của mọi task đang chạy mỗi
    // lần ẩn/hiện cửa sổ, khiến nút Retry sau đó âm thầm mất lựa chọn chất
    // lượng — đây là field client sở hữu, phải giữ nguyên qua các lần hydrate.
    await Promise.all(res.tasks.map(async (t) => {
      setTasks((prev) => {
        const existing = prev[t.task_id];
        return {
          ...prev,
          [t.task_id]: {
            ...existing,
            formatId: existing?.formatId ?? null,
            url: t.url,
            title: t.title,
            status: t.status,
            completed: t.progress,
            speed: t.avg_speed ?? "--",
            outputPath: t.output_path,
          },
        };
      });
      // Đang stream rồi thì thôi: attachStream sẽ no-op, nên xin token chỉ tổ
      // cấp ra rồi vứt đi (token là dùng-một-lần).
      if (streamsRef.current.has(t.task_id)) return;
      // Task này có thể do extension hoặc CLI khởi động, nên ta không có token.
      // Xin một cái mới — cơ chế đã có sẵn cho đường khôi phục sau khi mở lại app.
      try {
        const tok = await api.refreshStreamToken(t.task_id);
        if (tok?.stream_token) attachStream(t.task_id, tok.stream_token);
      } catch {
        // 404 (task biến mất) hay 409 (đã ở trạng thái cuối) giữa lúc lấy
        // snapshot và lúc xin token — snapshot vừa set ở trên đã đủ chính xác,
        // không cần stream nữa.
      }
    }));
  }, [attachStream]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onRefresh = () => void hydrate();
    window.addEventListener("streamloot:refresh", onRefresh);
    return () => window.removeEventListener("streamloot:refresh", onRefresh);
  }, [hydrate]);

  // Hỏi lại định kỳ danh sách task đang chạy.
  //
  // Không có cái này thì cửa sổ chỉ biết những task nó tự khởi động, cộng với
  // một lần chụp ảnh lúc mở. Người dùng bấm tải từ EXTENSION trong khi cửa sổ
  // đang mở thì không có gì kích hoạt hydrate — task chạy xong từ đời nào cửa
  // sổ vẫn trống (D6 yêu cầu thấy được mọi nguồn). SSE chỉ đẩy tiến trình của
  // task ta đã biết, nó không báo "có task MỚI".
  //
  // Gọi localhost mỗi 2s là rẻ; dừng khi cửa sổ bị ẩn để không chạy vô ích.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      void hydrate();
    };
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
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
