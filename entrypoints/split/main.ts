import "./styles.css";
import {
  createControlPanel,
  type ControlPanel,
  type Layout,
} from "./control-panel";
import { showCollapseModal } from "./collapse-modal";
import { showUndoToast } from "./toast";

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

type PanesCommand =
  | { type: "panes:back" }
  | { type: "panes:forward" }
  | { type: "panes:reload" };

type State = {
  rootSplit: HTMLElement;
  panel: ControlPanel;
  layout: Layout;
  focusedIndex: number;
};

function readLayoutFromQuery(): Layout {
  const raw = new URLSearchParams(window.location.search).get("layout");
  return raw === "2" ? 2 : 4;
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
  iframe.src = url;

  pane.appendChild(iframe);
  return pane;
}

function renderLayout(
  rootSplit: HTMLElement,
  layout: Layout,
  urls: string[],
): void {
  rootSplit.dataset.layout = String(layout);
  rootSplit.replaceChildren();
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

function applyLayout(state: State, layout: Layout, urls: string[]): void {
  state.layout = layout;
  renderLayout(state.rootSplit, layout, urls);
  state.panel.setLayout(layout);
  setFocusedPane(state, Math.min(state.focusedIndex, layout - 1));
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

function main(): void {
  const rootSplit = document.getElementById("split");
  const panelEl = document.getElementById("control-panel");
  if (!rootSplit || !panelEl) throw new Error("missing root elements");

  const layout = readLayoutFromQuery();
  const initialUrls = Array.from({ length: layout }, (_, i) =>
    initialUrlForPane(i),
  );
  renderLayout(rootSplit, layout, initialUrls);

  const state: State = {
    rootSplit,
    panel: undefined as unknown as ControlPanel,
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
}

main();
