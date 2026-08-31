function nearestScrollContainer(element, view) {
  for (let current = element?.parentElement; current; current = current.parentElement) {
    const overflowY = String(view?.getComputedStyle?.(current)?.overflowY || "");
    if (
      /^(?:auto|overlay|scroll)$/.test(overflowY) &&
      current.scrollHeight > current.clientHeight &&
      typeof current.scrollBy === "function"
    ) return current;
  }
  return typeof view?.scrollBy === "function" ? view : null;
}

export function preserveElementViewportPosition({
  element,
  mutate,
  scrollContainer = null,
  requestFrame = null,
} = {}) {
  if (typeof mutate !== "function") return undefined;
  const view = element?.ownerDocument?.defaultView || null;
  const connected = element?.isConnected !== false;
  const beforeTop = connected
    ? Number(element?.getBoundingClientRect?.().top)
    : Number.NaN;
  const resolvedScrollContainer = scrollContainer || nearestScrollContainer(element, view);
  const frame = requestFrame || view?.requestAnimationFrame?.bind(view);
  const reduceMotion = view?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const result = mutate();

  if (
    !connected ||
    !Number.isFinite(beforeTop) ||
    !resolvedScrollContainer ||
    typeof resolvedScrollContainer.scrollBy !== "function" ||
    typeof frame !== "function" ||
    reduceMotion
  ) return result;

  frame(() => {
    if (element?.isConnected === false) return;
    const afterTop = Number(element?.getBoundingClientRect?.().top);
    if (!Number.isFinite(afterTop)) return;
    const delta = afterTop - beforeTop;
    if (Math.abs(delta) < 0.01) return;
    resolvedScrollContainer.scrollBy(0, delta);
  });
  return result;
}
