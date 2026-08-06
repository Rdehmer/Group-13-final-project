"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** Extra classes on the main (content) scroll viewport. */
  contentClassName?: string;
};

/**
 * Horizontal scroll for wide tables with synced scrollbars at top and bottom
 * so managers/admins can drag from either edge.
 */
export function DualHorizontalScroll({
  children,
  className = "",
  contentClassName = "",
}: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [needsScroll, setNeedsScroll] = useState(false);

  const measure = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    const overflow = main.scrollWidth > main.clientWidth + 1;
    setNeedsScroll(overflow);
    if (spacerRef.current) {
      spacerRef.current.style.width = `${main.scrollWidth}px`;
    }
    if (topRef.current && topRef.current.scrollLeft !== main.scrollLeft) {
      topRef.current.scrollLeft = main.scrollLeft;
    }
  }, []);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(main);
    if (main.firstElementChild) ro.observe(main.firstElementChild);

    const onWindow = () => measure();
    window.addEventListener("resize", onWindow);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindow);
    };
  }, [measure, children]);

  function syncFrom(source: "top" | "main") {
    return (e: UIEvent<HTMLDivElement>) => {
      if (syncing.current) return;
      syncing.current = true;
      const left = e.currentTarget.scrollLeft;
      if (source === "top" && mainRef.current) {
        mainRef.current.scrollLeft = left;
      } else if (source === "main" && topRef.current) {
        topRef.current.scrollLeft = left;
      }
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };
  }

  return (
    <div className={`dual-h-scroll ${className}`.trim()}>
      {needsScroll ? (
        <div
          ref={topRef}
          className="overflow-x-auto overflow-y-hidden border-b border-base-300/60"
          style={{ height: 14 }}
          onScroll={syncFrom("top")}
          aria-hidden="true"
        >
          <div ref={spacerRef} style={{ height: 1 }} />
        </div>
      ) : null}
      <div
        ref={mainRef}
        className={`overflow-x-auto ${contentClassName}`.trim()}
        onScroll={syncFrom("main")}
      >
        {children}
      </div>
    </div>
  );
}
