(function (root) {
  function targetKey(item) {
    return item.kind === 'collaboration' ? 'collaboration' : item.agent;
  }

  function positionFor(queue, item) {
    const index = queue.findIndex(candidate => candidate.id === item.id);
    if (index < 0) return 0;
    const key = targetKey(item);
    return queue.slice(0, index + 1).filter(candidate => targetKey(candidate) === key).length;
  }

  function nextIndex(queue, kind, agent) {
    return queue.findIndex(item => item.kind === kind && (kind === 'collaboration' || item.agent === agent));
  }

  function canRemoveMessage(queue, removedItem, message) {
    if (!removedItem?.messageId || !message || message.workStarted) return false;
    return !queue.some(item => item.messageId === removedItem.messageId);
  }

  // Queue entries themselves are deliberately ephemeral.  A deferred user
  // bubble therefore needs a small, explicit lifecycle so a persisted chat
  // cannot leave an invisible message behind after the app is restarted.
  function shouldRenderMessage(message) {
    return !(message?.deferred && !message?.workStarted);
  }

  function removeDeferredOrphans(messages) {
    return (Array.isArray(messages) ? messages : []).filter(shouldRenderMessage);
  }

  const api = { targetKey, positionFor, nextIndex, canRemoveMessage, shouldRenderMessage, removeDeferredOrphans };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TriadQueue = api;
})(typeof window !== 'undefined' ? window : globalThis);
