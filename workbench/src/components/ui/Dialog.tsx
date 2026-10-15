"use client";
import { useEffect, useRef } from "react";

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto rounded-xl border border-line bg-surface text-ink p-0 shadow-xl w-[calc(100vw-2rem)] ${wide ? "max-w-3xl" : "max-w-lg"} backdrop:bg-black/30 max-h-[90dvh]`}
    >
      <div className="p-5 overflow-y-auto max-h-[90dvh]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="h2">{title}</h2>
          <button onClick={onClose} className="btn btn-sm" aria-label="Close">✕</button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Continue", danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="text-sm mb-4">{message}</div>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
