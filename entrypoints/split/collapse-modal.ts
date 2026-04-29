export type CollapseRequest = {
  paneUrls: string[];
  preCheckedIndices: number[];
  excludedIndex?: number;
};

export type CollapseResult = {
  keptIndices: number[];
  openDiscardedAsTabs: boolean;
};

export function showCollapseModal(
  request: CollapseRequest,
): Promise<CollapseResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent =
      request.excludedIndex === undefined
        ? "Keep which 2 panes?"
        : `Closing pane ${request.excludedIndex + 1}. Keep which 2 of the rest?`;

    const grid = document.createElement("div");
    grid.className = "modal-panes";

    const checkboxes: HTMLInputElement[] = [];

    request.paneUrls.forEach((url, index) => {
      const card = document.createElement("label");
      card.className = "modal-pane-card";
      if (request.excludedIndex === index) card.classList.add("modal-pane-card--excluded");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = request.preCheckedIndices.includes(index);
      checkbox.disabled = request.excludedIndex === index;

      const indexLabel = document.createElement("span");
      indexLabel.className = "modal-pane-index";
      indexLabel.textContent = String(index + 1);

      const urlLabel = document.createElement("span");
      urlLabel.className = "modal-pane-url";
      urlLabel.textContent = url;

      card.append(checkbox, indexLabel, urlLabel);
      grid.appendChild(card);
      checkboxes.push(checkbox);
    });

    const optionRow = document.createElement("label");
    optionRow.className = "modal-option";
    const openTabsCheckbox = document.createElement("input");
    openTabsCheckbox.type = "checkbox";
    openTabsCheckbox.checked = true;
    const optionText = document.createElement("span");
    optionText.textContent = "Open discarded panes as regular tabs";
    optionRow.append(openTabsCheckbox, optionText);

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn modal-btn--cancel";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "modal-btn modal-btn--confirm";
    confirmBtn.type = "button";
    confirmBtn.textContent = "Keep selected";

    actions.append(cancelBtn, confirmBtn);

    modal.append(title, grid, optionRow, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const updateConfirmEnabled = (): void => {
      const checkedCount = checkboxes.filter((cb) => cb.checked).length;
      confirmBtn.disabled = checkedCount !== 2;
    };

    for (const cb of checkboxes) {
      cb.addEventListener("change", () => {
        const checkedCount = checkboxes.filter((c) => c.checked).length;
        if (checkedCount > 2 && cb.checked) {
          // Cap at 2 — uncheck the earliest other checked box.
          const firstOther = checkboxes.find((c) => c !== cb && c.checked);
          if (firstOther) firstOther.checked = false;
        }
        updateConfirmEnabled();
      });
    }
    updateConfirmEnabled();

    const cleanup = (): void => {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
    };

    const close = (result: CollapseResult | null): void => {
      cleanup();
      resolve(result);
    };

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close(null);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    cancelBtn.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => {
      const keptIndices = checkboxes
        .map((cb, i) => (cb.checked ? i : -1))
        .filter((i) => i !== -1);
      if (keptIndices.length !== 2) return;
      close({
        keptIndices,
        openDiscardedAsTabs: openTabsCheckbox.checked,
      });
    });
    document.addEventListener("keydown", onKeydown);

    confirmBtn.focus();
  });
}
