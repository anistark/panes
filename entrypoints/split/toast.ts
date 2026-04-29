const TOAST_DURATION_MS = 5000;

export function showUndoToast(message: string, onUndo: () => void): void {
  document.querySelectorAll(".toast").forEach((el) => el.remove());

  const toast = document.createElement("div");
  toast.className = "toast";

  const messageEl = document.createElement("span");
  messageEl.className = "toast-message";
  messageEl.textContent = message;

  const undoBtn = document.createElement("button");
  undoBtn.className = "toast-undo";
  undoBtn.type = "button";
  undoBtn.textContent = "Undo";

  toast.append(messageEl, undoBtn);
  document.body.appendChild(toast);

  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    toast.remove();
  };

  undoBtn.addEventListener("click", () => {
    dismiss();
    onUndo();
  });

  setTimeout(dismiss, TOAST_DURATION_MS);
}
