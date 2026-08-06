"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { LoginCard } from "@/components/login/LoginCard";

type AuthMode = "login" | "signup";

type Props = {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
};

export function AuthModal({ open, mode, onModeChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box max-w-md border border-base-300/60 p-0 shadow-2xl">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3 z-10"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <LoginCard mode={mode} onModeChange={onModeChange} embedded />
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label="Close dialog" />
      </form>
    </dialog>
  );
}
