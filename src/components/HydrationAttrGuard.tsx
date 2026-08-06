import Script from "next/script";

/**
 * Strips attributes injected by browser tooling/extensions (e.g. Cursor's
 * data-cursor-ref) during the hydration window so React does not warn about
 * SSR HTML mismatches. Observer disconnects after load so tooling can annotate again.
 */
export function HydrationAttrGuard() {
  return (
    <Script id="hydration-attr-guard" strategy="beforeInteractive">{`
(function () {
  var ATTRS = [
    "data-cursor-ref",
    "cz-shortcut-listen",
    "data-gr-ext-installed",
    "data-new-gr-c-s-check-loaded",
    "data-gramm",
    "data-gramm_editor",
    "data-lt-installed"
  ];
  function clean(el) {
    if (!el || el.nodeType !== 1 || !el.removeAttribute) return;
    for (var i = 0; i < ATTRS.length; i++) {
      if (el.hasAttribute(ATTRS[i])) el.removeAttribute(ATTRS[i]);
    }
  }
  function walk(root) {
    if (!root) return;
    clean(root);
    if (!root.querySelectorAll) return;
    var nodes = root.querySelectorAll("[" + ATTRS.join("],[") + "]");
    for (var i = 0; i < nodes.length; i++) clean(nodes[i]);
  }
  walk(document.documentElement);
  var obs = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === "attributes") clean(m.target);
      var nodes = m.addedNodes;
      if (!nodes) continue;
      for (var j = 0; j < nodes.length; j++) walk(nodes[j]);
    }
  });
  obs.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ATTRS
  });
  function stop() {
    try { obs.disconnect(); } catch (e) {}
  }
  function scheduleStop() {
    setTimeout(stop, 3000);
  }
  if (document.readyState === "complete") scheduleStop();
  else window.addEventListener("load", scheduleStop, { once: true });
})();
`}</Script>
  );
}
