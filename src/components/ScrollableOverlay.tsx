"use client";

/**
 * Fixed overlay panel that scrolls reliably inside the app drawer
 * (DaisyUI modal scroll-lock breaks submit on long forms).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ScrollableOverlay({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scrollable-overlay-title"
    >
      <button
        type="button"
        className="fixed inset-0 z-0 cursor-default"
        aria-label="Close dialog"
        onClick={() => onCloseRef.current()}
      />
      <div className="relative z-10 my-auto w-full max-w-lg rounded-2xl border border-base-300 bg-base-100 shadow-xl">
        <div className="border-b border-base-300 px-4 py-4 sm:px-6">
          <h2 id="scrollable-overlay-title" className="text-xl font-bold">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm opacity-70">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
