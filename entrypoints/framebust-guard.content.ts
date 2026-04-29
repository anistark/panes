export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",

  main() {
    if (window.self === window.top) return;

    const selfRef = window.self;

    // `window.top` and `window.parent` are [Replaceable] attributes per
    // WebIDL — direct assignment is the canonical way to convert the
    // browser-provided getter into a data property holding our value.
    // `Object.defineProperty` is unreliable here on Chrome.
    spoofWindowReference("top", selfRef);
    spoofWindowReference("parent", selfRef);

    document.addEventListener(
      "click",
      (event) => {
        const anchor = (event.target as Element | null)?.closest?.("a");
        if (!anchor) return;
        const target = anchor.getAttribute("target");
        if (target !== "_top" && target !== "_parent") return;
        event.preventDefault();
        event.stopPropagation();
        const href = anchor.getAttribute("href");
        if (href) window.location.href = href;
      },
      true,
    );

    console.debug("[panes] framebust-guard installed in", window.location.href);
  },
});

function spoofWindowReference(name: "top" | "parent", ref: Window): void {
  try {
    (window as unknown as Record<string, Window>)[name] = ref;
    if (window[name] === ref) return;
  } catch {
    /* fall through to defineProperty */
  }
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => ref,
    });
  } catch {
    /* property is locked down on this page; nothing more we can do */
  }
}
