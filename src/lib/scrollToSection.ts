/** Smooth-scroll to an element by id (or a live element). */
export function scrollToSection(
  target: string | Element | null | undefined,
  options?: ScrollIntoViewOptions,
) {
  if (typeof window === "undefined" || target == null) return;
  const el =
    typeof target === "string" ? document.getElementById(target) : target;
  if (!el) return;
  el.scrollIntoView({
    behavior: "smooth",
    block: "start",
    ...options,
  });
}

/**
 * Run a state update, then scroll after paint so new tab/filter content is visible.
 */
export function jumpToSection(
  target: string | Element | null | undefined,
  update?: () => void,
  delayMs = 50,
) {
  update?.();
  if (typeof window === "undefined") return;
  window.setTimeout(() => scrollToSection(target), delayMs);
}
