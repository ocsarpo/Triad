(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadCollaboration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function tasksFor(config) {
    const mode = config.mode || 'independent';
    const lead = config.lead === 'claude' ? 'claude' : 'codex';
    const other = lead === 'codex' ? 'claude' : 'codex';
    const rounds = Math.max(1, Math.min(5, Number(config.rounds) || 1));
    const tasks = [];

    if (mode === 'debate') {
      for (let round = 1; round <= rounds; round += 1) {
        tasks.push({ agent: lead, kind: 'debate', round });
        tasks.push({ agent: other, kind: 'debate', round });
      }
      if (config.finalizer === 'codex' || config.finalizer === 'claude') {
        tasks.push({ agent: config.finalizer, kind: 'synthesize', round: rounds + 1 });
      }
    } else if (mode === 'review') {
      tasks.push({ agent: lead, kind: 'draft', round: 0 });
      for (let round = 1; round <= rounds; round += 1) {
        tasks.push({ agent: other, kind: 'critique', round });
        tasks.push({ agent: lead, kind: 'revise', round });
      }
    }
    return tasks;
  }

  // The shared-board protocol deliberately has no provider preference.  The
  // configured (or tagged) lead owns the proposal and final decision; the
  // other provider is the reviewer.  A resolution turn is only needed after
  // an actual disagreement, not as an expensive "I agree" confirmation.
  function rolesFor(lead) {
    const owner = lead === 'claude' ? 'claude' : 'codex';
    return { owner, reviewer: owner === 'codex' ? 'claude' : 'codex' };
  }

  function harnessTasks(lead) {
    const roles = rolesFor(lead);
    return [
      { agent: roles.owner, kind: 'proposal', phase: 'proposal' },
      { agent: roles.reviewer, kind: 'verdict', phase: 'review' },
      { agent: roles.owner, kind: 'resolve', phase: 'resolve', conditional: true },
      { agent: roles.owner, kind: 'decision', phase: 'complete' }
    ];
  }

  function shouldRunResolution(verdict) {
    return verdict === 'disagree' || verdict === 'conditional';
  }

  // A missing orchestration is the normal independent-run state.  Optional
  // chaining with `!==` turns that absence into true, so keep this predicate
  // explicit at the native-process boundary.
  function shouldEnableMcp(orchestration, sharedContext) {
    // An independent run can have a shared document too.  It never receives
    // ask_agent, but it does receive the narrow read/contribution tools.
    return !!sharedContext || (!!orchestration && orchestration.mode !== 'independent');
  }

  function requiredBoardField(task) {
    const kind = typeof task === 'string' ? task : task?.kind;
    return ({ proposal: 'proposal', verdict: 'verdict', decision: 'decision' })[kind] || null;
  }

  function boardStageError(task, board) {
    const field = requiredBoardField(task);
    if (!field) return null;
    const value = board?.[field];
    if (field === 'verdict') return ['agree', 'disagree', 'conditional'].includes(value) ? null : '검토자는 shared board에 verdict를 기록해야 합니다.';
    return typeof value === 'string' && value.trim() ? null : `shared board의 ${field} 기록이 필요합니다.`;
  }

  function promptEnvelope(input = {}) {
    const roles = rolesFor(input.lead);
    const task = input.task || {};
    const board = input.board || {};
    const sections = Array.isArray(input.sections) ? input.sections : [];
    const manifest = board.manifest || board;
    return {
      objective: String(input.objective || ''),
      role: task.agent === roles.reviewer ? 'reviewer' : 'owner',
      phase: task.phase || task.kind || 'proposal',
      owner: roles.owner,
      reviewer: roles.reviewer,
      manifest,
      sections,
      // This is intentionally a boolean rather than a transcript field.  It
      // makes the no-transcript contract observable in unit tests.
      includesTranscript: false
    };
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
    tasksFor, rolesFor, harnessTasks, shouldRunResolution, shouldEnableMcp,
    requiredBoardField, boardStageError, promptEnvelope, extractHandoff,
    documentTitleFromObjective, documentIdOf, sortDocuments, upsertDocument,
    selectedDocument, continuationInput
  };
});
