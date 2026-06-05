import type { Layout } from "./control-panel";

// Per-split-tab state lives in `chrome.storage.session`: it survives a tab
// reload (tab ids are stable within a browser session) and is wiped on browser
// restart, so a reused tab id can never inherit a previous tab's panes. Restart
// is therefore best-effort — a session-restored tab falls back to its URL query
// params.
const SCHEMA_VERSION = 1;

export type PaneTabSnapshot = {
  layout: Layout;
  urls: string[];
  focusedIndex: number;
  colRatio: number;
  rowRatio: number;
};

type StoredState = PaneTabSnapshot & { version: number };

function keyForTab(tabId: number): string {
  return `paneState:${tabId}`;
}

export async function currentTabId(): Promise<number | null> {
  try {
    const tab = await chrome.tabs.getCurrent();
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

export async function loadTabState(
  tabId: number,
): Promise<PaneTabSnapshot | null> {
  try {
    const key = keyForTab(tabId);
    const stored = await chrome.storage.session.get(key);
    const raw = stored[key];
    return isStoredState(raw) ? toSnapshot(raw) : null;
  } catch (error) {
    console.warn("[panes] tab state read failed", error);
    return null;
  }
}

export async function saveTabState(
  tabId: number,
  snapshot: PaneTabSnapshot,
): Promise<void> {
  try {
    const value: StoredState = { version: SCHEMA_VERSION, ...snapshot };
    await chrome.storage.session.set({ [keyForTab(tabId)]: value });
  } catch (error) {
    console.warn("[panes] tab state write failed", error);
  }
}

export async function clearTabState(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.remove(keyForTab(tabId));
  } catch {
    /* best-effort cleanup */
  }
}

function isStoredState(raw: unknown): raw is StoredState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  return (
    s.version === SCHEMA_VERSION &&
    (s.layout === 2 || s.layout === 4) &&
    Array.isArray(s.urls) &&
    s.urls.every((url) => typeof url === "string") &&
    typeof s.focusedIndex === "number" &&
    typeof s.colRatio === "number" &&
    typeof s.rowRatio === "number"
  );
}

function toSnapshot(stored: StoredState): PaneTabSnapshot {
  return {
    layout: stored.layout,
    urls: stored.urls,
    focusedIndex: stored.focusedIndex,
    colRatio: stored.colRatio,
    rowRatio: stored.rowRatio,
  };
}
