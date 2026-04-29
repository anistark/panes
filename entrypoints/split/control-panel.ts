export type Layout = 2 | 4;

export type ControlPanelHandlers = {
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSwitchLayout: (target: Layout) => void;
  onPopOut: () => void;
  onClose: () => void;
  onNavigate: (url: string) => void;
};

export type ControlPanel = {
  bindToPane: (index: number, url: string) => void;
  setLayout: (layout: Layout) => void;
};

type Internals = {
  indicator: HTMLElement;
  indicatorCells: HTMLElement[];
  urlInput: HTMLInputElement;
  layoutButtons: { layout: Layout; el: HTMLButtonElement }[];
  closeButton: HTMLButtonElement;
  layout: Layout;
  focusedIndex: number;
};

export function createControlPanel(
  container: HTMLElement,
  initialLayout: Layout,
  handlers: ControlPanelHandlers,
): ControlPanel {
  container.replaceChildren();

  const indicator = el("span", { class: "indicator" });
  const navGroup = el("div", { class: "bar-group" });
  const backBtn = barButton("←", "Back", () => handlers.onBack());
  const fwdBtn = barButton("→", "Forward", () => handlers.onForward());
  const reloadBtn = barButton("↻", "Reload", () => handlers.onReload());
  navGroup.append(backBtn, fwdBtn, reloadBtn);

  const urlInput = el("input", {
    class: "url-input",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  urlInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handlers.onNavigate(urlInput.value);
    urlInput.blur();
  });

  const layoutGroup = el("div", { class: "bar-group" });
  const layout2Btn = barButton("[2]", "2-pane layout", () =>
    handlers.onSwitchLayout(2),
  );
  const layout4Btn = barButton("[4]", "4-pane layout", () =>
    handlers.onSwitchLayout(4),
  );
  layout2Btn.classList.add("layout-btn");
  layout4Btn.classList.add("layout-btn");
  layoutGroup.append(layout2Btn, layout4Btn);

  const popOutBtn = barButton("⤴", "Pop out as a tab", () =>
    handlers.onPopOut(),
  );
  const closeBtn = barButton("✕", "Close pane", () => handlers.onClose());

  container.append(
    indicator,
    navGroup,
    urlInput,
    layoutGroup,
    popOutBtn,
    closeBtn,
  );

  const internals: Internals = {
    indicator,
    indicatorCells: [],
    urlInput,
    layoutButtons: [
      { layout: 2, el: layout2Btn },
      { layout: 4, el: layout4Btn },
    ],
    closeButton: closeBtn,
    layout: initialLayout,
    focusedIndex: 0,
  };

  applyLayout(internals, initialLayout);

  return {
    bindToPane(index: number, url: string): void {
      internals.focusedIndex = index;
      for (const [i, cell] of internals.indicatorCells.entries()) {
        cell.classList.toggle("indicator-cell--focused", i === index);
      }
      if (document.activeElement !== urlInput) {
        urlInput.value = url;
      }
    },
    setLayout(layout: Layout): void {
      applyLayout(internals, layout);
    },
  };
}

function applyLayout(internals: Internals, layout: Layout): void {
  internals.layout = layout;

  internals.indicator.dataset.layout = String(layout);
  internals.indicator.replaceChildren();
  internals.indicatorCells = [];
  for (let i = 0; i < layout; i++) {
    const cell = el("span", { class: "indicator-cell" });
    if (i === internals.focusedIndex) {
      cell.classList.add("indicator-cell--focused");
    }
    internals.indicator.appendChild(cell);
    internals.indicatorCells.push(cell);
  }

  for (const { layout: btnLayout, el: btn } of internals.layoutButtons) {
    btn.classList.toggle("layout-btn--active", btnLayout === layout);
  }

  // Closing a pane drops to a smaller layout. With only 2- and 4-pane support,
  // closing only makes sense from 4-pane (collapses to 2). 2-pane has no
  // smaller layout to drop to.
  internals.closeButton.disabled = layout === 2;
}

function barButton(
  glyph: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = el("button", {
    class: "bar-btn",
    type: "button",
    title,
  }) as HTMLButtonElement;
  btn.textContent = glyph;
  btn.addEventListener("click", onClick);
  return btn;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  return node;
}
