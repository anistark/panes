type PanesCommand =
  | { type: "panes:back" }
  | { type: "panes:forward" }
  | { type: "panes:reload" };

type Mods = {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

function isPanesShortcut(code: string, mods: Mods): boolean {
  const cmd = mods.meta || mods.ctrl;
  if (cmd && mods.shift && (code === "Digit2" || code === "Digit4")) return true;
  if (cmd && !mods.shift && code === "Backslash") return true;
  if (mods.alt && /^Digit[1-4]$/.test(code)) return true;
  if (cmd && mods.shift && code === "KeyO") return true;
  return false;
}

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

    document.addEventListener("click", handleLinkClick, true);
    document.addEventListener("auxclick", handleLinkClick, true);

    document.addEventListener(
      "keydown",
      (event) => {
        const mods: Mods = {
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
        };
        if (!isPanesShortcut(event.code, mods)) return;
        event.preventDefault();
        event.stopPropagation();
        window.parent.postMessage(
          {
            type: "panes:keydown",
            code: event.code,
            metaKey: mods.meta,
            ctrlKey: mods.ctrl,
            altKey: mods.alt,
            shiftKey: mods.shift,
          },
          "*",
        );
      },
      true,
    );

    window.addEventListener("message", (event) => {
      // Only accept commands from a chrome-extension parent (our split page).
      // Sandboxed iframes embedded by random sites won't pass this check.
      if (!event.origin.startsWith("chrome-extension://")) return;
      if (event.source !== window.parent) return;

      const data = event.data as Partial<PanesCommand> | null;
      if (!data || typeof data.type !== "string") return;

      switch (data.type) {
        case "panes:back":
          history.back();
          break;
        case "panes:forward":
          history.forward();
          break;
        case "panes:reload":
          location.reload();
          break;
      }
    });

    console.log("[panes] framebust-guard installed in", window.location.href);
  },
});

function handleLinkClick(event: MouseEvent): void {
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;

  const isMiddleClick = event.button === 1;
  const isModifierClick = event.metaKey || event.ctrlKey;

  if (isMiddleClick || isModifierClick) {
    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage(
      { type: "panes:open-as-tab", url: resolveUrl(href) },
      "*",
    );
    return;
  }

  const target = anchor.getAttribute("target");
  if (target === "_blank" || target === "_top" || target === "_parent") {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = href;
  }
}

function resolveUrl(href: string): string {
  try {
    return new URL(href, document.baseURI).href;
  } catch {
    return href;
  }
}

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
