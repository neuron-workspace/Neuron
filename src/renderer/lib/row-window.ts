export function rowWindow({ scrollTop, viewportHeight, rowHeight, count, overscan, pinned }: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan: number;
  pinned?: number;
}): { start: number; end: number; padTop: number; padBottom: number } {
  const height = rowHeight > 0 ? rowHeight : 36;
  const extra = Math.max(0, Math.floor(overscan));
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, count * height - viewportHeight)));
  let start = Math.max(0, Math.floor(top / height) - extra);
  let end = Math.min(count, Math.ceil((top + Math.max(0, viewportHeight)) / height) + extra);
  if (pinned !== undefined && pinned >= 0 && pinned < count) {
    start = Math.min(start, pinned);
    end = Math.max(end, pinned + 1);
  }
  return { start, end, padTop: start * height, padBottom: (count - end) * height };
}
