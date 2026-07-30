(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadCollaboration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Modes collapsed to two: independent (default) and agent collaboration.
  // The old debate/review board harness (proposal→verdict→resolve→decision)
  // is gone — an adversarial second opinion is now the per-message #검토 tag,
  // which runs the other agent as a reviewer over the finished answer.
  function rolesFor(lead) {
    const owner = lead === 'claude' ? 'claude' : 'codex';
    return { owner, reviewer: owner === 'codex' ? 'claude' : 'codex' };
  }

  // A missing orchestration is the normal independent-run state.  Optional
  // chaining with `!==` turns that absence into true, so keep this predicate
  // explicit at the native-process boundary.
  function shouldEnableMcp(orchestration, sharedContext) {
    // An independent run can have a shared document too.  It never receives
    // ask_agent, but it does receive the narrow read/contribution tools.
    // Dialogue (#대화) turns are plain talk — no board, no broker.
    return !!sharedContext || (!!orchestration && orchestration.mode === 'agent');
  }

  function documentTitleFromObjective(value, fallback = '새 공유 문서') {
    const firstLine = String(value || '').split(/\r?\n/u).map(line => line.trim()).find(Boolean) || '';
    const normalized = firstLine.replace(/\s+/gu, ' ').trim();
    if (!normalized) return fallback;
    return normalized.length > 48 ? `${normalized.slice(0, 47)}…` : normalized;
  }

  function documentIdOf(document) {
    return typeof document?.documentId === 'string' && document.documentId
      ? document.documentId
      : (typeof document?.id === 'string' ? document.id : '');
  }

  function sortDocuments(documents) {
    return [...(Array.isArray(documents) ? documents : [])].sort((left, right) => {
      const rightTime = Date.parse(right?.updatedAt || '') || 0;
      const leftTime = Date.parse(left?.updatedAt || '') || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return documentIdOf(left).localeCompare(documentIdOf(right));
    });
  }

  function upsertDocument(documents, document) {
    const documentId = documentIdOf(document);
    if (!documentId) return sortDocuments(documents);
    const next = (Array.isArray(documents) ? documents : []).filter(item => documentIdOf(item) !== documentId);
    next.push(document);
    return sortDocuments(next);
  }

  function selectedDocument(documents, activeDocumentId) {
    return (Array.isArray(documents) ? documents : []).find(document => documentIdOf(document) === activeDocumentId) || null;
  }

  // A document run is deliberately represented by fresh IDs and objective
  // input.  The storage layer's continueBoard resets proposal/verdict/decision
  // for this run while retaining durable decisions/history from earlier runs.
  function continuationInput(input = {}) {
    return {
      conversationId: String(input.conversationId || ''),
      runId: String(input.runId || ''),
      objective: String(input.objective || ''),
      owner: input.owner === 'claude' ? 'claude' : 'codex'
    };
  }

  function extractHandoff(text, from) {
    const source = String(text || '');
    const match = source.match(/\[\[TRIAD_HANDOFF\]\]\s*([\s\S]*?)\s*\[\[\/TRIAD_HANDOFF\]\]/u);
    if (!match) return { text: source, handoff: null, error: null };
    const cleaned = `${source.slice(0, match.index)}${source.slice(match.index + match[0].length)}`.trim();
    try {
      const value = JSON.parse(match[1]);
      const expected = from === 'codex' ? 'claude' : 'codex';
      if (value?.to !== expected) return { text: cleaned, handoff: null, error: `인계 대상은 ${expected}여야 합니다.` };
      if (typeof value.question !== 'string' || !value.question.trim()) return { text: cleaned, handoff: null, error: '인계 질문이 비어 있습니다.' };
      return {
        text: cleaned,
        handoff: { to: expected, question: value.question.trim(), reason: typeof value.reason === 'string' ? value.reason.trim() : '' },
        error: null
      };
    } catch (error) {
      return { text: cleaned, handoff: null, error: `인계 JSON 해석 실패: ${error.message}` };
    }
  }

  return {
    rolesFor, shouldEnableMcp, extractHandoff,
    documentTitleFromObjective, documentIdOf, sortDocuments, upsertDocument,
    selectedDocument, continuationInput
  };
});
