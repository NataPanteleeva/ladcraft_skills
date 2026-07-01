/** Read vertical scroll offset from a container (0 when missing). */
export function readScrollTop(container: Element | null): number {
  return container instanceof HTMLElement ? container.scrollTop : 0;
}

/** Restore scrollTop after layout (double rAF for markdown/widgets). */
export function restoreScrollTop(container: HTMLElement, scrollTop: number): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.scrollTop = scrollTop;
    });
  });
}

/** Scroll container to bottom after layout. */
export function scrollToBottom(container: HTMLElement): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  });
}

/** True when the viewport is near the bottom of a scroll container. */
export function isNearBottom(container: HTMLElement, threshold = 80): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  );
}
