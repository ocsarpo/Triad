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

  const api = { targetKey, positionFor, nextIndex, canRemoveMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TriadQueue = api;
})(typeof window !== 'undefined' ? window : globalThis);
