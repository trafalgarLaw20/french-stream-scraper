import { useEffect, useRef, useState, useCallback } from "react";
import type { ScrapeEvent } from "../types.js";

export type SSEStatus = "idle" | "running" | "done" | "error";

export interface SSEState {
  status: SSEStatus;
  events: ScrapeEvent[];
  result: ScrapeEvent & { type: "done" } | null;
  error: string | null;
}

export function useSSE(jobId: string | null): SSEState & {
  reset: () => void;
} {
  const [state, setState] = useState<SSEState>({
    status: "idle",
    events: [],
    result: null,
    error: null,
  });
  const sourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setState({ status: "idle", events: [], result: null, error: null });
  }, []);

  useEffect(() => {
    if (!jobId) {
      reset();
      return;
    }
    setState({ status: "running", events: [], result: null, error: null });

    const source = new EventSource(`/api/events/${jobId}`);
    sourceRef.current = source;

    source.addEventListener("__final__", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { status: string };
      setState((prev) => ({
        ...prev,
        status: data.status === "done" ? "done" : "error",
      }));
      source.close();
    });

    source.addEventListener("error", () => {
      setState((prev) =>
        prev.status === "running" ? { ...prev, status: "error", error: "Connexion SSE perdue" } : prev,
      );
    });

    const knownTypes: ScrapeEvent["type"][] = [
      "start",
      "fetch:start",
      "fetch:cf",
      "fetch:retry",
      "fetch:done",
      "players:start",
      "players:click",
      "iframe:found",
      "players:done",
      "parse:done",
      "resolve:start",
      "resolve:candidate",
      "resolve:done",
      "resolve:all:done",
      "done",
      "error",
    ];
    for (const t of knownTypes) {
      source.addEventListener(t, (e) => {
        const event = JSON.parse((e as MessageEvent).data) as ScrapeEvent;
        setState((prev) => {
          const next: SSEState = { ...prev, events: [...prev.events, event] };
          if (event.type === "done") {
            next.status = "done";
            next.result = event;
          } else if (event.type === "error") {
            next.status = "error";
            next.error = event.message;
          }
          return next;
        });
      });
    }

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [jobId, reset]);

  return { ...state, reset };
}
