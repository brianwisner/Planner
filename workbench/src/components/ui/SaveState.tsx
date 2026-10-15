"use client";
import { useEffect, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function SaveIndicator({ status, message }: { status: SaveStatus; message?: string }) {
  const online = useOnline();
  if (!online) return <span className="badge bg-warn-soft text-warn">Offline — changes will not save</span>;
  if (status === "saving") return <span className="badge bg-info-soft text-info">Saving…</span>;
  if (status === "saved") return <span className="badge bg-ok-soft text-ok">Saved</span>;
  if (status === "error") return <span className="badge bg-danger-soft text-danger">{message ?? "Not saved"}</span>;
  if (status === "offline") return <span className="badge bg-warn-soft text-warn">{message ?? "Offline — not saved"}</span>;
  return null;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="bg-warn-soft text-warn text-sm px-4 py-2 text-center border-b border-warn/20">
      You are offline. You can read what is already loaded; changes cannot be saved until you reconnect.
    </div>
  );
}
