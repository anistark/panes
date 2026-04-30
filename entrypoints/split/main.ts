import "./styles.css";
import {
  createControlPanel,
  type ControlPanel,
  type Layout,
} from "./control-panel";
import { showCollapseModal } from "./collapse-modal";
import { showUndoToast } from "./toast";
import { attachSplitters, type SplitterController } from "./splitters";

const DEFAULT_PANE_URLS = [
  "https://news.ycombinator.com/",
  "https://github.com/",
  "https://en.wikipedia.org/wiki/Mosaic_(web_browser)",
  "https://stackoverflow.com/",
] as const;

const PANE_SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-modals",
  "allow-downloads",
  "allow-presentation",
  "allow-storage-access-by-user-activation",
].join(" ");

const STORAGE_KEY_LAST_LAYOUT = "lastLayout";

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

type State = {
  rootSplit: HTMLElement;
  panel: ControlPanel;
  splitters: SplitterController;
  layout: Layout;
  focusedIndex: number;
};

function readLayoutFromQuery(): Layout | null {
  const raw = new URLSearchParams(window.location.search).get("layout");
  if (raw === "2") return 2;
  if (raw === "4") return 4;
  return null;
}

async function readInitialLayout(): Promise<Layout> {
  const fromQuery = readLayoutFromQuery();
  if (fromQuery !== null) return fromQuery;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_LAST_LAYOUT);
    return stored[STORAGE_KEY_LAST_LAYOUT] === 2 ? 2 : 4;
  } catch (error) {
    console.warn("[panes] storage read failed; defaulting to 4-pane", error);
    return 4;
  }
}

function persistLayout(layout: Layout): void {
  try {
    void chrome.storage.local.set({ [STORAGE_KEY_LAST_LAYOUT]: layout });
  } catch (error) {
    console.warn("[panes] storage write failed", error);
  }
}

function readPaneUrlOverride(index: number): string | undefined {
  const param = new URLSearchParams(window.location.search).get(
    `pane${index + 1}`,
  );
  return param ?? undefined;
}

function defaultUrlForPane(index: number): string {
  return DEFAULT_PANE_URLS[index] ?? "about:blank";
}

function initialUrlForPane(index: number): string {
  return readPaneUrlOverride(index) ?? defaultUrlForPane(index);
}

function buildPane(index: number, url: string): HTMLDivElement {
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.dataset.paneIndex = String(index);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", PANE_SANDBOX);
  iframe.dataset.paneIndex = String(index);
  iframe.referrerPolicy = "no-referrer-when-downgrade";

  const overlay = document.createElement("div");
  overlay.className = "pane-loading";
  overlay.textContent = "Loading…";

  pane.append(iframe, overlay);
  attachLoadingState(pane, iframe);
  iframe.src = url;
  return pane;
}

// Cross-origin iframes don't expose a reliable error event, so we treat
// `load` as the universal "page reached a final state" signal — including
// browser error pages — and just stop showing the overlay. The 300ms delay
// avoids flashing the overlay on fast loads.
function attachLoadingState(
  pane: HTMLElement,
  iframe: HTMLIFrameElement,
): void {
  const timer = window.setTimeout(() => {
    pane.classList.add("pane--loading");
  }, 300);
  const onLoad = (): void => {
    window.clearTimeout(timer);
    pane.classList.remove("pane--loading");
    iframe.removeEventListener("load", onLoad);
  };
  iframe.addEventListener("load", onLoad);
}

function renderLayout(
  rootSplit: HTMLElement,
  layout: Layout,
  urls: string[],
): void {
  rootSplit.dataset.layout = String(layout);
  // Remove only `.pane` children — splitters live alongside panes inside
  // `#split` and must survive a re-render.
  rootSplit.querySelectorAll(".pane").forEach((pane) => pane.remove());
  for (let i = 0; i < layout; i++) {
    const url = urls[i] ?? defaultUrlForPane(i);
    rootSplit.appendChild(buildPane(i, url));
  }
}

function readPaneUrls(rootSplit: HTMLElement): string[] {
  const iframes = rootSplit.querySelectorAll<HTMLIFrameElement>("iframe");
  return Array.from(iframes).map((iframe) => iframe.src);
}

function focusedIframe(state: State): HTMLIFrameElement | null {
  return state.rootSplit.querySelector<HTMLIFrameElement>(
    `iframe[data-pane-index="${state.focusedIndex}"]`,
  );
}

function focusedUrl(state: State): string {
  return focusedIframe(state)?.src ?? "";
}

function setFocusedPane(state: State, index: number): void {
  state.focusedIndex = index;
  for (const pane of state.rootSplit.querySelectorAll<HTMLElement>(".pane")) {
    pane.classList.toggle(
      "pane--focused",
      Number(pane.dataset.paneIndex) === index,
    );
  }
  state.panel.bindToPane(index, focusedUrl(state));
}

function wireFocusTracking(state: State): void {
  state.rootSplit.addEventListener("pointerdown", (event) => {
    const pane = (event.target as HTMLElement).closest<HTMLElement>(".pane");
    if (!pane) return;
    setFocusedPane(state, Number(pane.dataset.paneIndex));
  });

  // Click inside an iframe focuses the iframe and blurs the parent window.
  // After the blur, document.activeElement points at the iframe — read it on
  // the next tick to identify which pane the user interacted with.
  window.addEventListener("blur", () => {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLIFrameElement)) return;
      const index = Number(active.dataset.paneIndex);
      if (Number.isFinite(index)) setFocusedPane(state, index);
    });
  });
}

function sendToFocusedPane(state: State, command: PanesCommand): void {
  focusedIframe(state)?.contentWindow?.postMessage(command, "*");
}

function wireOpenAsTabBridge(state: State): void {
  window.addEventListener("message", (event) => {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (!data || data.type !== "panes:open-as-tab") return;
    if (typeof data.url !== "string") return;
    if (!isMessageFromOurPane(state, event.source)) return;
    void chrome.tabs.create({ url: data.url });
  });
}

function isMessageFromOurPane(
  state: State,
  source: MessageEventSource | null,
): boolean {
  if (!source) return false;
  const iframes = state.rootSplit.querySelectorAll<HTMLIFrameElement>("iframe");
  for (const iframe of iframes) {
    if (iframe.contentWindow === source) return true;
  }
  return false;
}

function applyLayout(state: State, layout: Layout, urls: string[]): void {
  state.layout = layout;
  renderLayout(state.rootSplit, layout, urls);
  state.splitters.setLayout(layout);
  state.panel.setLayout(layout);
  setFocusedPane(state, Math.min(state.focusedIndex, layout - 1));
  persistLayout(layout);
}

async function switchLayout(state: State, target: Layout): Promise<void> {
  if (target === state.layout) return;

  if (target === 4 && state.layout === 2) {
    // 2 → 4 is non-destructive; preserve current panes and add defaults.
    const currentUrls = readPaneUrls(state.rootSplit);
    const nextUrls = Array.from({ length: 4 }, (_, i) =>
      currentUrls[i] ?? defaultUrlForPane(i),
    );
    applyLayout(state, 4, nextUrls);
    return;
  }

  // 4 → 2 needs the user to choose which two panes survive.
  await collapseTo2(state, [0, 1]);
}

async function closeFocusedPane(state: State): Promise<void> {
  if (state.layout !== 4) return;
  const focused = state.focusedIndex;
  const preChecked = [0, 1, 2, 3].filter((i) => i !== focused).slice(0, 2);
  await collapseTo2(state, preChecked, focused);
}

async function collapseTo2(
  state: State,
  preCheckedIndices: number[],
  excludedIndex?: number,
): Promise<void> {
  const urls = readPaneUrls(state.rootSplit);
  const result = await showCollapseModal({
    paneUrls: urls,
    preCheckedIndices,
    excludedIndex,
  });
  if (!result) return;

  const keptUrls = result.keptIndices.map(
    (i) => urls[i] ?? defaultUrlForPane(i),
  );
  const discardedUrls = urls.filter(
    (_, i) => !result.keptIndices.includes(i),
  );

  const previous = { layout: state.layout, urls: [...urls] };

  applyLayout(state, 2, keptUrls);

  if (result.openDiscardedAsTabs) {
    for (const url of discardedUrls) {
      void chrome.tabs.create({ url, active: false });
    }
  }

  showUndoToast("Collapsed to 2 panes", () => {
    applyLayout(state, previous.layout, previous.urls);
  });
}

function navigateFocused(state: State, rawInput: string): void {
  const url = normalizeUrl(rawInput);
  if (!url) return;
  const iframe = focusedIframe(state);
  if (!iframe) return;
  const pane = iframe.closest<HTMLElement>(".pane");
  if (pane) attachLoadingState(pane, iframe);
  iframe.src = url;
  state.panel.bindToPane(state.focusedIndex, url);
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function popOutFocused(state: State): void {
  const url = focusedUrl(state);
  if (!url) return;
  void chrome.tabs.create({ url });
}

function cycleFocus(state: State): void {
  const next = (state.focusedIndex + 1) % state.layout;
  setFocusedPane(state, next);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

function isModalOpen(): boolean {
  return !!document.querySelector(".modal-overlay");
}

function handleShortcut(state: State, code: string, mods: Mods): boolean {
  if (isModalOpen()) return false;
  const cmd = mods.meta || mods.ctrl;

  if (cmd && mods.shift && code === "Digit2") {
    void switchLayout(state, 2);
    return true;
  }
  if (cmd && mods.shift && code === "Digit4") {
    void switchLayout(state, 4);
    return true;
  }
  if (cmd && !mods.shift && code === "Backslash") {
    cycleFocus(state);
    return true;
  }
  if (mods.alt && /^Digit[1-4]$/.test(code)) {
    const index = Number(code.replace("Digit", "")) - 1;
    if (index >= 0 && index < state.layout) setFocusedPane(state, index);
    return true;
  }
  if (cmd && mods.shift && code === "KeyO") {
    popOutFocused(state);
    return true;
  }
  return false;
}

function wireKeyboardShortcuts(state: State): void {
  console.log("[panes] keyboard shortcuts wired");
  window.addEventListener(
    "keydown",
    (event) => {
      if (isEditableTarget(event.target)) return;
      const handled = handleShortcut(state, event.code, {
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
      });
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  // Iframes can't deliver keydown events to us directly; the framebust-guard
  // in MAIN world catches our shortcut combos and forwards them as messages.
  window.addEventListener("message", (event) => {
    const data = event.data as
      | {
          type?: unknown;
          code?: unknown;
          metaKey?: unknown;
          ctrlKey?: unknown;
          altKey?: unknown;
          shiftKey?: unknown;
        }
      | null;
    if (!data || data.type !== "panes:keydown") return;
    if (typeof data.code !== "string") return;
    if (!isMessageFromOurPane(state, event.source)) return;
    handleShortcut(state, data.code, {
      meta: !!data.metaKey,
      ctrl: !!data.ctrlKey,
      alt: !!data.altKey,
      shift: !!data.shiftKey,
    });
  });
}

async function main(): Promise<void> {
  console.log("[panes] split page boot");
  const rootSplit = document.getElementById("split");
  const panelEl = document.getElementById("control-panel");
  if (!rootSplit || !panelEl) throw new Error("missing root elements");

  const layout = await readInitialLayout();
  const initialUrls = Array.from({ length: layout }, (_, i) =>
    initialUrlForPane(i),
  );
  renderLayout(rootSplit, layout, initialUrls);

  const splitters = attachSplitters(rootSplit, layout);

  const state: State = {
    rootSplit,
    panel: undefined as unknown as ControlPanel,
    splitters,
    layout,
    focusedIndex: 0,
  };

  state.panel = createControlPanel(panelEl, layout, {
    onBack: () => sendToFocusedPane(state, { type: "panes:back" }),
    onForward: () => sendToFocusedPane(state, { type: "panes:forward" }),
    onReload: () => sendToFocusedPane(state, { type: "panes:reload" }),
    onSwitchLayout: (target) => void switchLayout(state, target),
    onPopOut: () => popOutFocused(state),
    onClose: () => void closeFocusedPane(state),
    onNavigate: (url) => navigateFocused(state, url),
  });

  setFocusedPane(state, 0);
  wireFocusTracking(state);
  wireOpenAsTabBridge(state);
  wireKeyboardShortcuts(state);

  persistLayout(layout);
}

void main();
