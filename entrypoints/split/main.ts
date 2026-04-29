import "./styles.css";

type Layout = 2 | 4;

const DEFAULT_PANE_URLS = [
  "https://news.ycombinator.com/",
  "https://github.com/",
  "https://en.wikipedia.org/wiki/Mosaic_(web_browser)",
  "https://stackoverflow.com/",
] as const;

// Sandbox tokens permit normal site behavior (scripts, cookies, forms, popups,
// modals) while withholding `allow-top-navigation` and its variants. The
// browser blocks any top-frame navigation attempt at the platform level —
// rock-solid against JS framebusters that beat content-script timing.
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

function readLayoutFromQuery(): Layout {
  const raw = new URLSearchParams(window.location.search).get("layout");
  return raw === "2" ? 2 : 4;
}

function urlForPane(index: number): string {
  return DEFAULT_PANE_URLS[index] ?? "about:blank";
}

function buildPane(index: number): HTMLDivElement {
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.dataset.paneIndex = String(index);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", PANE_SANDBOX);
  iframe.dataset.paneIndex = String(index);
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.src = urlForPane(index);

  pane.appendChild(iframe);
  return pane;
}

function render(root: HTMLElement, layout: Layout): void {
  root.dataset.layout = String(layout);
  root.replaceChildren();
  for (let i = 0; i < layout; i++) {
    root.appendChild(buildPane(i));
  }
}

function setFocusedPane(root: HTMLElement, index: number): void {
  for (const pane of root.querySelectorAll<HTMLElement>(".pane")) {
    const isFocused = Number(pane.dataset.paneIndex) === index;
    pane.classList.toggle("pane--focused", isFocused);
  }
}

function wireFocusTracking(root: HTMLElement): void {
  root.addEventListener("pointerdown", (event) => {
    const pane = (event.target as HTMLElement).closest<HTMLElement>(".pane");
    if (!pane) return;
    setFocusedPane(root, Number(pane.dataset.paneIndex));
  });

  // Click inside an iframe focuses the iframe and blurs the parent window.
  // After the blur, document.activeElement points at the iframe — read it on
  // the next tick to identify which pane the user interacted with.
  window.addEventListener("blur", () => {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLIFrameElement)) return;
      const index = Number(active.dataset.paneIndex);
      if (Number.isFinite(index)) setFocusedPane(root, index);
    });
  });
}

function main(): void {
  const root = document.getElementById("split");
  if (!root) throw new Error("missing #split root");

  render(root, readLayoutFromQuery());
  setFocusedPane(root, 0);
  wireFocusTracking(root);
}

main();
