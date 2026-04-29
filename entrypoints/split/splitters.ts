import type { Layout } from "./control-panel";

export type SplitterController = {
  setLayout: (layout: Layout) => void;
  refresh: () => void;
  destroy: () => void;
};

const DEFAULT_MIN_PANE_PX = 240;

export function attachSplitters(
  rootSplit: HTMLElement,
  initialLayout: Layout,
  minPaneSizePx: number = DEFAULT_MIN_PANE_PX,
): SplitterController {
  let layout: Layout = initialLayout;
  let colRatio = 0.5;
  let rowRatio = 0.5;
  let colSplitter: HTMLElement | null = null;
  let rowSplitter: HTMLElement | null = null;
  let dragOverlay: HTMLElement | null = null;

  // Splitters are absolutely positioned overlays; the parent must establish
  // the containing block for them.
  rootSplit.style.position = "relative";

  const observer = new ResizeObserver(() => refresh());
  observer.observe(rootSplit);

  ensureSplitters();
  applyGrid();
  refresh();

  return {
    setLayout(newLayout: Layout): void {
      layout = newLayout;
      ensureSplitters();
      applyGrid();
      refresh();
    },
    refresh,
    destroy(): void {
      observer.disconnect();
      colSplitter?.remove();
      rowSplitter?.remove();
      dragOverlay?.remove();
      colSplitter = null;
      rowSplitter = null;
      dragOverlay = null;
    },
  };

  function ensureSplitters(): void {
    if (!colSplitter) {
      colSplitter = createSplitter("col");
      rootSplit.appendChild(colSplitter);
    }
    if (layout === 4 && !rowSplitter) {
      rowSplitter = createSplitter("row");
      rootSplit.appendChild(rowSplitter);
    }
    if (layout === 2 && rowSplitter) {
      rowSplitter.remove();
      rowSplitter = null;
    }
  }

  function createSplitter(axis: "col" | "row"): HTMLElement {
    const splitter = document.createElement("div");
    splitter.className = `splitter splitter--${axis}`;
    splitter.dataset.axis = axis;
    splitter.addEventListener("pointerdown", (event) =>
      onPointerDown(event, axis),
    );
    splitter.addEventListener("dblclick", () => resetRatio(axis));
    return splitter;
  }

  function applyGrid(): void {
    rootSplit.style.gridTemplateColumns = `${colRatio}fr ${1 - colRatio}fr`;
    if (layout === 4) {
      rootSplit.style.gridTemplateRows = `${rowRatio}fr ${1 - rowRatio}fr`;
    } else {
      rootSplit.style.removeProperty("grid-template-rows");
    }
  }

  function refresh(): void {
    const { padding, gap } = readSpacing(rootSplit);
    if (colSplitter) {
      const innerWidth = rootSplit.clientWidth - 2 * padding - gap;
      const x = padding + colRatio * innerWidth + gap / 2;
      colSplitter.style.left = `${x}px`;
    }
    if (rowSplitter && layout === 4) {
      const innerHeight = rootSplit.clientHeight - 2 * padding - gap;
      const y = padding + rowRatio * innerHeight + gap / 2;
      rowSplitter.style.top = `${y}px`;
    }
  }

  function onPointerDown(event: PointerEvent, axis: "col" | "row"): void {
    event.preventDefault();
    const splitter = event.currentTarget as HTMLElement;
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("splitter--dragging");

    // The drag-overlay covers the whole viewport (including iframes) so the
    // pointer keeps emitting move events to us instead of being captured by
    // an iframe's content document mid-drag.
    dragOverlay = document.createElement("div");
    dragOverlay.className = `splitter-drag-overlay splitter-drag-overlay--${axis}`;
    document.body.appendChild(dragOverlay);

    const onMove = (moveEvent: PointerEvent): void => {
      const rect = rootSplit.getBoundingClientRect();
      const { padding, gap } = readSpacing(rootSplit);
      if (axis === "col") {
        const innerWidth = rect.width - 2 * padding - gap;
        const raw =
          (moveEvent.clientX - rect.left - padding - gap / 2) / innerWidth;
        colRatio = clampRatio(raw, innerWidth);
      } else {
        const innerHeight = rect.height - 2 * padding - gap;
        const raw =
          (moveEvent.clientY - rect.top - padding - gap / 2) / innerHeight;
        rowRatio = clampRatio(raw, innerHeight);
      }
      applyGrid();
      refresh();
    };

    const onUp = (upEvent: PointerEvent): void => {
      splitter.releasePointerCapture(upEvent.pointerId);
      splitter.classList.remove("splitter--dragging");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      dragOverlay?.remove();
      dragOverlay = null;
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  }

  function clampRatio(rawRatio: number, innerSize: number): number {
    // If the container is too small for both panes to meet the minimum,
    // give up on enforcement and pin the ratio to 0.5 so neither side
    // wins arbitrarily.
    const minRatio = Math.min(0.5, minPaneSizePx / Math.max(innerSize, 1));
    return Math.max(minRatio, Math.min(1 - minRatio, rawRatio));
  }

  function resetRatio(axis: "col" | "row"): void {
    if (axis === "col") colRatio = 0.5;
    else rowRatio = 0.5;
    applyGrid();
    refresh();
  }
}

function readSpacing(el: HTMLElement): { padding: number; gap: number } {
  const styles = getComputedStyle(el);
  return {
    padding: parseFloat(styles.padding) || 0,
    gap: parseFloat(styles.gap) || 0,
  };
}
