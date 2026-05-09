import "./styles.css";
import {
  createControlPanel,
  type ControlPanel,
  type Layout,
} from "./control-panel";
import { showCollapseModal } from "./collapse-modal";
import { showUndoToast } from "./toast";
import { attachSplitters, type SplitterController } from "./splitters";

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

type PaneMeta = {
  url: string;
  title: string;
};

type State = {
  rootSplit: HTMLElement;
  panel: ControlPanel;
  splitters: SplitterController;
  layout: Layout;
  focusedIndex: number;
  paneMeta: Map<number, PaneMeta>;
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

function initialUrlForPane(index: number): string {
  return readPaneUrlOverride(index) ?? "";
}

function buildPane(index: number, url: string): HTMLDivElement {
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.dataset.paneIndex = String(index);
  pane.dataset.paneUrl = url;

  if (url) {
    const iframe = buildIframe(index, url);
    pane.append(iframe, buildLoadingOverlay());
    attachLoadingState(pane, iframe);
  } else {
    pane.classList.add("pane--empty");
    pane.append(buildEmptyState(index));
  }
  return pane;
}

function buildIframe(index: number, url: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", PANE_SANDBOX);
  iframe.dataset.paneIndex = String(index);
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.src = url;
  return iframe;
}

function buildLoadingOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "pane-loading";
  overlay.textContent = "Loading…";
  return overlay;
}

function buildEmptyState(index: number): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "pane-empty";

  const logo = document.createElement("img");
  logo.className = "pane-empty-logo";
  logo.src = chrome.runtime.getURL("/icon/icon-128.png");
  logo.alt = "";

  const brand = document.createElement("div");
  brand.className = "pane-empty-brand";
  brand.textContent = "Panes";

  const label = document.createElement("div");
  label.className = "pane-empty-label";
  label.textContent = `Pane ${index + 1}`;

  const hint = document.createElement("div");
  hint.className = "pane-empty-hint";
  hint.textContent =
    "Click a pane, type a URL above, and press Enter. Switch between 2 and 4 panes anytime.";

  wrap.append(logo, brand, label, hint);
  return wrap;
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
    rootSplit.appendChild(buildPane(i, urls[i] ?? ""));
  }
}

function readPaneUrls(rootSplit: HTMLElement): string[] {
  const panes = rootSplit.querySelectorAll<HTMLElement>(".pane");
  return Array.from(panes).map((pane) => pane.dataset.paneUrl ?? "");
}

function focusedIframe(state: State): HTMLIFrameElement | null {
  return state.rootSplit.querySelector<HTMLIFrameElement>(
    `iframe[data-pane-index="${state.focusedIndex}"]`,
  );
}

function liveUrlForPane(state: State, index: number): string {
  const meta = state.paneMeta.get(index);
  if (meta?.url) return meta.url;
  const pane = state.rootSplit.querySelector<HTMLElement>(
    `.pane[data-pane-index="${index}"]`,
  );
  return pane?.dataset.paneUrl ?? "";
}

function focusedUrl(state: State): string {
  return liveUrlForPane(state, state.focusedIndex);
}

function setFocusedPane(state: State, index: number): void {
  state.focusedIndex = index;
  for (const pane of state.rootSplit.querySelectorAll<HTMLElement>(".pane")) {
    pane.classList.toggle(
      "pane--focused",
      Number(pane.dataset.paneIndex) === index,
    );
  }
  state.panel.bindToPane(index, liveUrlForPane(state, index));
  syncBrowserChrome(state);
}

function syncBrowserChrome(state: State): void {
  const meta = state.paneMeta.get(state.focusedIndex);
  const url = meta?.url || liveUrlForPane(state, state.focusedIndex);
  const title = meta?.title?.trim() ?? "";
  const label = title || hostnameOf(url);
  document.title = label ? `Panes — ${label}` : "Panes";

  // Address bar can only be rewritten same-origin, so we encode the focused
  // pane's URL into the hash. The chrome-extension://…/split.html prefix
  // stays, but the visible URL now hints at what's in the focused pane.
  const targetHash = url ? "#" + encodeURI(url) : "";
  if (window.location.hash !== targetHash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${targetHash}`);
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
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

function wireIframeBridge(state: State): void {
  window.addEventListener("message", (event) => {
    const data = event.data as
      | { type?: unknown; url?: unknown; title?: unknown }
      | null;
    if (!data || typeof data.type !== "string") return;
    const paneIndex = paneIndexForSource(state, event.source);
    if (paneIndex === null) return;

    switch (data.type) {
      case "panes:focus":
        setFocusedPane(state, paneIndex);
        break;
      case "panes:open-as-tab":
        if (typeof data.url === "string") {
          void chrome.tabs.create({ url: data.url });
        }
        break;
      case "panes:meta":
        if (typeof data.url !== "string" || typeof data.title !== "string") {
          break;
        }
        state.paneMeta.set(paneIndex, { url: data.url, title: data.title });
        const pane = state.rootSplit.querySelector<HTMLElement>(
          `.pane[data-pane-index="${paneIndex}"]`,
        );
        if (pane) pane.dataset.paneUrl = data.url;
        if (paneIndex === state.focusedIndex) {
          state.panel.bindToPane(paneIndex, data.url);
          syncBrowserChrome(state);
        }
        break;
    }
  });
}

function paneIndexForSource(
  state: State,
  source: MessageEventSource | null,
): number | null {
  if (!source) return null;
  const iframes = state.rootSplit.querySelectorAll<HTMLIFrameElement>("iframe");
  for (const iframe of iframes) {
    if (iframe.contentWindow === source) {
      const idx = Number(iframe.dataset.paneIndex);
      return Number.isFinite(idx) ? idx : null;
    }
  }
  return null;
}

function isMessageFromOurPane(
  state: State,
  source: MessageEventSource | null,
): boolean {
  return paneIndexForSource(state, source) !== null;
}

function applyLayout(state: State, layout: Layout, urls: string[]): void {
  state.layout = layout;
  renderLayout(state.rootSplit, layout, urls);
  state.splitters.setLayout(layout);
  state.panel.setLayout(layout);
  // Iframes are recreated on render — drop stale meta and let the content
  // script re-announce on load. Pre-seed with the URL we're loading so the
  // address bar/title don't flash empty during the gap.
  state.paneMeta.clear();
  for (let i = 0; i < layout; i++) {
    state.paneMeta.set(i, { url: urls[i] ?? "", title: "" });
  }
  setFocusedPane(state, Math.min(state.focusedIndex, layout - 1));
  persistLayout(layout);
}

async function switchLayout(state: State, target: Layout): Promise<void> {
  if (target === state.layout) return;

  if (target === 4 && state.layout === 2) {
    // 2 → 4 is non-destructive; preserve current panes and leave the rest empty.
    const currentUrls = readPaneUrls(state.rootSplit);
    const nextUrls = Array.from({ length: 4 }, (_, i) => currentUrls[i] ?? "");
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

  const keptUrls = result.keptIndices.map((i) => urls[i] ?? "");
  const discardedUrls = urls.filter(
    (_, i) => !result.keptIndices.includes(i),
  );

  const previous = { layout: state.layout, urls: [...urls] };

  applyLayout(state, 2, keptUrls);

  if (result.openDiscardedAsTabs) {
    for (const url of discardedUrls) {
      if (url) void chrome.tabs.create({ url, active: false });
    }
  }

  showUndoToast("Collapsed to 2 panes", () => {
    applyLayout(state, previous.layout, previous.urls);
  });
}

function navigateFocused(state: State, rawInput: string): void {
  const url = normalizeUrl(rawInput);
  if (!url) return;
  const pane = state.rootSplit.querySelector<HTMLElement>(
    `.pane[data-pane-index="${state.focusedIndex}"]`,
  );
  if (!pane) return;

  pane.dataset.paneUrl = url;
  const existingIframe = pane.querySelector<HTMLIFrameElement>("iframe");
  if (existingIframe) {
    attachLoadingState(pane, existingIframe);
    existingIframe.src = url;
  } else {
    pane.classList.remove("pane--empty");
    pane.querySelector(".pane-empty")?.remove();
    const iframe = buildIframe(state.focusedIndex, url);
    pane.append(iframe, buildLoadingOverlay());
    attachLoadingState(pane, iframe);
  }
  // Pre-seed meta so the address bar/title update immediately; the content
  // script will refresh title/url once the page loads.
  state.paneMeta.set(state.focusedIndex, { url, title: "" });
  state.panel.bindToPane(state.focusedIndex, url);
  syncBrowserChrome(state);
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

  const paneMeta = new Map<number, PaneMeta>();
  for (let i = 0; i < layout; i++) {
    paneMeta.set(i, { url: initialUrls[i] ?? "", title: "" });
  }

  const state: State = {
    rootSplit,
    panel: undefined as unknown as ControlPanel,
    splitters,
    layout,
    focusedIndex: 0,
    paneMeta,
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
  wireIframeBridge(state);
  wireKeyboardShortcuts(state);

  persistLayout(layout);
}

void main();
