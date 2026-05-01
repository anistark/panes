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
    // Capture the real parent BEFORE spoofing — we still need to post messages
    // to the actual split page, even after `window.parent` has been redirected
    // to `selfRef` to fool framebust checks.
    const realParent = window.parent;

    // `window.top` and `window.parent` are [Replaceable] attributes per
    // WebIDL — direct assignment is the canonical way to convert the
    // browser-provided getter into a data property holding our value.
    // `Object.defineProperty` is unreliable here on Chrome.
    spoofWindowReference("top", selfRef);
    spoofWindowReference("parent", selfRef);

    const onLinkClick = (event: MouseEvent): void =>
      handleLinkClick(event, realParent);
    document.addEventListener("click", onLinkClick, true);
    document.addEventListener("auxclick", onLinkClick, true);

    // Notify the split page when the user interacts with this pane so the
    // focus highlight follows the click. Capture-phase + `pointerdown` fires
    // before the page's own handlers and even when something inside the page
    // calls `stopPropagation` on later events.
    document.addEventListener(
      "pointerdown",
      () => {
        realParent.postMessage({ type: "panes:focus" }, "*");
      },
      true,
    );

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
        realParent.postMessage(
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
      if (event.source !== realParent) return;

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

    installMetaTracking(realParent);

    console.log("[panes] framebust-guard installed in", window.location.href);
  },
});

// Send the iframe's current URL + title to the split page, and keep doing so
// whenever either changes. The split page uses this to update the browser
// address bar (via hash) and tab title to reflect the focused pane.
function installMetaTracking(realParent: Window): void {
  let lastUrl = "";
  let lastTitle = "";

  const send = (): void => {
    const url = location.href;
    const title = document.title;
    if (url === lastUrl && title === lastTitle) return;
    lastUrl = url;
    lastTitle = title;
    realParent.postMessage({ type: "panes:meta", url, title }, "*");
  };

  // History API doesn't fire `popstate` for pushState/replaceState, so wrap
  // them. SPAs (most modern sites) rely on these for client-side routing.
  const wrap = (method: "pushState" | "replaceState"): void => {
    const original = history[method];
    history[method] = function (
      this: History,
      ...args: Parameters<History[typeof method]>
    ): void {
      original.apply(this, args);
      queueMicrotask(send);
    };
  };
  wrap("pushState");
  wrap("replaceState");

  window.addEventListener("popstate", send);
  window.addEventListener("hashchange", send);
  // `pageshow` fires on initial load and on bfcache restore; cheaper than
  // gating on DOMContentLoaded vs. load distinctions.
  window.addEventListener("pageshow", send);

  // Title can be set declaratively (initial `<title>` parsed from HTML) or
  // imperatively (`document.title = ...`, often well after load). Observe
  // <head> so we catch both, including SPA route-driven title updates.
  const startTitleObserver = (): void => {
    const head = document.head;
    if (!head) return;
    new MutationObserver(send).observe(head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  };
  if (document.head) {
    startTitleObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startTitleObserver, {
      once: true,
    });
  }

  send();
}

function handleLinkClick(event: MouseEvent, realParent: Window): void {
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;

  const isMiddleClick = event.button === 1;
  const isModifierClick = event.metaKey || event.ctrlKey;

  if (isMiddleClick || isModifierClick) {
    event.preventDefault();
    event.stopPropagation();
    realParent.postMessage(
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
