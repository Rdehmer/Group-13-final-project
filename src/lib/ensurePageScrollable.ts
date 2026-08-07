/** Sticky top bar height + small gap (matches scroll-padding-top in globals.css). */
export const PAGE_SCROLL_TOP_OFFSET = 72;

/**
 * Clear inline scroll locks left behind by modals/overlays after navigation.
 * DaisyUI also locks `:root` via `:has(.modal-open)` — that clears automatically
 * when modal nodes unmount; inline `body.style.overflow` does not.
 */
export function ensurePageScrollable() {
  if (typeof document === "undefined") return;

  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.paddingRight = "";
  document.documentElement.style.overflow = "";
  document.documentElement.style.paddingRight = "";
  document.body.classList.remove("modal-open");
  document.documentElement.classList.remove("modal-open");

  const openDrawer = document.getElementById("app-drawer") as HTMLInputElement | null;
  if (openDrawer?.checked) {
    openDrawer.checked = false;
  }
}
