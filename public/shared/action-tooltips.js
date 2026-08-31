const GAP = 8;
const VIEWPORT_PADDING = 8;
const controllerKey = Symbol.for("chewy.actionTooltips.controller");

export function tooltipPosition(anchorRect, tooltipRect, viewport) {
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    viewport.width - tooltipRect.width - VIEWPORT_PADDING,
  );
  const left = Math.min(
    maxLeft,
    Math.max(
      VIEWPORT_PADDING,
      anchorRect.left + ((anchorRect.width - tooltipRect.width) / 2),
    ),
  );
  const above = anchorRect.top - tooltipRect.height - GAP;
  const placement = above >= VIEWPORT_PADDING ? "top" : "bottom";
  const requestedTop = placement === "top" ? above : anchorRect.bottom + GAP;
  const top = Math.min(
    Math.max(VIEWPORT_PADDING, requestedTop),
    Math.max(VIEWPORT_PADDING, viewport.height - tooltipRect.height - VIEWPORT_PADDING),
  );
  return { left, top, placement };
}

function controlFor(target) {
  return typeof target?.closest === "function"
    ? target.closest("[data-tooltip]")
    : null;
}

export function installActionTooltips({ documentRef, windowRef } = {}) {
  const doc = documentRef;
  const win = windowRef;
  if (!doc || !win) {
    throw new TypeError("installActionTooltips requires documentRef and windowRef.");
  }
  if (doc[controllerKey]) return doc[controllerKey];

  const root = doc.body;
  if (!root) return null;
  const overlay = doc.createElement("div");
  overlay.className = "action-tooltip-overlay";
  overlay.dataset.actionTooltipOverlay = "";
  overlay.setAttribute("role", "tooltip");
  overlay.hidden = true;
  root.append(overlay);

  const requestFrame = win.requestAnimationFrame.bind(win);
  const cancelFrame = win.cancelAnimationFrame.bind(win);
  let activeControl = null;
  let frameId = null;

  function hide() {
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    activeControl = null;
    overlay.hidden = true;
  }

  function show(control) {
    if (frameId !== null) cancelFrame(frameId);
    activeControl = control;
    overlay.textContent = control.dataset.tooltip;
    overlay.style.maxWidth = `${Math.max(1, win.innerWidth - (VIEWPORT_PADDING * 2))}px`;
    overlay.hidden = false;
    frameId = requestFrame(() => {
      frameId = null;
      if (activeControl !== control || !control.isConnected) {
        hide();
        return;
      }
      const position = tooltipPosition(
        control.getBoundingClientRect(),
        overlay.getBoundingClientRect(),
        { width: win.innerWidth, height: win.innerHeight },
      );
      overlay.style.left = `${position.left}px`;
      overlay.style.top = `${position.top}px`;
      overlay.dataset.placement = position.placement;
    });
  }

  function onPointerOver(event) {
    const control = controlFor(event.target);
    if (control && control !== activeControl) show(control);
  }

  function onPointerOut(event) {
    const control = controlFor(event.target);
    if (control && control === activeControl && !control.contains(event.relatedTarget)) hide();
  }

  function onFocusIn(event) {
    const control = controlFor(event.target);
    if (control?.matches(":focus-visible") && control !== activeControl) show(control);
  }

  function onFocusOut(event) {
    const control = controlFor(event.target);
    if (control && control === activeControl && !control.contains(event.relatedTarget)) hide();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      hide();
      return;
    }
    const control = controlFor(event.target);
    if (["Enter", " "].includes(event.key) && control === activeControl) hide();
  }

  function onClick(event) {
    if (controlFor(event.target) === activeControl) hide();
  }

  const observer = new win.MutationObserver(() => {
    if (activeControl && !root.contains(activeControl)) hide();
  });
  observer.observe(root, { childList: true, subtree: true });

  doc.addEventListener("pointerover", onPointerOver);
  doc.addEventListener("pointerout", onPointerOut);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("click", onClick);
  doc.addEventListener("scroll", hide, true);
  win.addEventListener("scroll", hide);
  win.addEventListener("resize", hide);
  win.addEventListener("pagehide", hide);

  let destroyed = false;
  const controller = {
    hide,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hide();
      observer.disconnect();
      doc.removeEventListener("pointerover", onPointerOver);
      doc.removeEventListener("pointerout", onPointerOut);
      doc.removeEventListener("focusin", onFocusIn);
      doc.removeEventListener("focusout", onFocusOut);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("scroll", hide, true);
      win.removeEventListener("scroll", hide);
      win.removeEventListener("resize", hide);
      win.removeEventListener("pagehide", hide);
      overlay.remove();
      if (doc[controllerKey] === controller) delete doc[controllerKey];
    },
  };
  doc[controllerKey] = controller;
  return controller;
}

if (typeof document !== "undefined") {
  if (document.body) {
    installActionTooltips({ documentRef: document, windowRef: window });
  } else {
    document.addEventListener("DOMContentLoaded", () => installActionTooltips({
      documentRef: document,
      windowRef: window,
    }), { once: true });
  }
}
