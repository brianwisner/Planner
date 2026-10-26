"use client";
import { useCallback, useState } from "react";
import { ClientApiError } from "@/lib/client/api";
import type { SaveStatus } from "@/components/ui/SaveState";

/** Tracks saving / saved / error / offline / conflict state for a form. */
export function useSave() {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | undefined>();
  const [conflict, setConflict] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setStatus("saving");
    setMessage(undefined);
    setConflict(null);
    try {
      const r = await fn();
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2500);
      return r;
    } catch (e) {
      const err = e as ClientApiError;
      if (err.status === 0) {
        setStatus("offline");
        setMessage(err.message);
      } else if (err.status === 409 && err.body?.current) {
        setStatus("error");
        setMessage(err.message);
        setConflict(err.body.current);
      } else {
        setStatus("error");
        setMessage(err.message);
      }
      return undefined;
    }
  }, []);
  return { status, message, conflict, run, reset: () => { setStatus("idle"); setMessage(undefined); setConflict(null); } };
}
