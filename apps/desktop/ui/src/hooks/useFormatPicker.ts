import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";

const DEBOUNCE_MS = 700;

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

interface FormatPickerState {
  heights: number[];
  statusText: string | null; // e.g. "Loading formats…" or an error — null when idle/ready
  lastFetched: { url: string; title: string } | null;
}

export function useFormatPicker() {
  const [state, setState] = useState<FormatPickerState>({ heights: [], statusText: null, lastFetched: null });
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    seqRef.current += 1; // invalidate any in-flight request
    setState({ heights: [], statusText: null, lastFetched: null });
  }, []);

  const fetchFormats = useCallback(async (url: string) => {
    const seq = ++seqRef.current;
    setState((s) => ({ ...s, statusText: "Loading formats…", heights: [] }));
    try {
      const result = await api.getFormats(url);
      if (seq !== seqRef.current || !result) return; // superseded by a newer request

      const heights = Array.from(new Set(result.formats.filter((f) => f.height).map((f) => f.height as number)))
        .sort((a, b) => b - a);

      setState({ heights, statusText: null, lastFetched: { url, title: result.title } });
    } catch {
      if (seq !== seqRef.current) return;
      // Non-fatal: formats just aren't available for preview (site blocked
      // it, timed out, etc.) — download can still proceed at "Best".
      setState((s) => ({ ...s, statusText: "Couldn't load formats — will use best quality" }));
    }
  }, []);

  const onUrlChange = useCallback((url: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!looksLikeUrl(url)) {
      reset();
      return;
    }
    timerRef.current = setTimeout(() => fetchFormats(url), DEBOUNCE_MS);
  }, [fetchFormats, reset]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { ...state, onUrlChange, reset };
}

// Matches InteractivePrompt.to_ytdlp_format's convention (ui/interactive.py)
// so a picked resolution merges video+audio the same way the CLI does,
// rather than downloading a silent video-only track.
export function formatSelectorForHeight(height: number): string {
  return `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
}
