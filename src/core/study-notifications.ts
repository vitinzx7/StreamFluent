/** Storage is restricted to trusted extension contexts to keep session tokens private.
 * Players receive invalidations, then read the allowed study snapshot via the worker.
 */
export function onStudyInvalidated(key: "settings" | "vocabulary", reload: () => void): () => void {
  const events = chrome.runtime.onMessage;
  if (!events) return () => {};
  const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !message || typeof message !== "object") return;
    const value = message as { type?: unknown; keys?: unknown };
    if (value.type === "sf:study-invalidated" && Array.isArray(value.keys) && value.keys.includes(key)) reload();
  };
  events.addListener(listener);
  return () => events.removeListener(listener);
}

export async function broadcastStudyChanges(changes: Record<string, chrome.storage.StorageChange>, area: string): Promise<void> {
  if (area !== "local") return;
  const keys = ["settings", "vocabulary"].filter(key => Object.prototype.hasOwnProperty.call(changes, key));
  if (!keys.length) return;
  // No tabs permission: only IDs are needed, and sendMessage reaches our content scripts.
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.flatMap(tab => typeof tab.id === "number"
    ? [chrome.tabs.sendMessage(tab.id, { type: "sf:study-invalidated", keys })] : []));
}
