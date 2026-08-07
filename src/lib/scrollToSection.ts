import { PAGE_SCROLL_TOP_OFFSET } from "@/lib/ensurePageScrollable";

type ScrollToSectionOptions = {
  behavior?: ScrollBehavior;
  /** Extra pixels above the target (defaults to sticky header offset). */
  offset?: number;
};

/** Smooth-scroll the page to an element by id (or a live element). */
export function scrollToSection(
  target: string | Element | null | undefined,
  options?: ScrollToSectionOptions,
) {
  if (typeof window === "undefined" || target == null) return;
  const el = typeof target === "string" ? document.getElementById(target) : target;
  if (!el) return;

  const offset = options?.offset ?? PAGE_SCROLL_TOP_OFFSET;
  const behavior = options?.behavior ?? "smooth";
  const top =
    el.getBoundingClientRect().top +
    (window.scrollY || document.documentElement.scrollTop) -
    offset;

  window.scrollTo({ top: Math.max(0, top), behavior });
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
