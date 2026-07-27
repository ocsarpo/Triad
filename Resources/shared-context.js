(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadSharedContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AGENTS = new Set(['codex', 'claude']);
  const SECTIONS = ['objective', 'constraints', 'proposal', 'evidence', 'verdict', 'disputes', 'decision', 'history', 'contributions'];
  const OWNER_SECTIONS = new Set(['constraints', 'proposal', 'evidence', 'decision']);
  const REVIEWER_SECTIONS = new Set(['verdict', 'disputes']);
  const TEXT_LIMIT = 8000;
  // The objective is the user's own task text (their message), so it gets a far
  // larger ceiling than agent-written board sections — 8000 was rejecting long
  // pasted tasks ("objective은(는) 8000자를 넘을 수 없습니다").
  const OBJECTIVE_LIMIT = 100000;
  const LIST_LIMIT = 10;
  const ITEM_LIMIT = 1000;
  const EVIDENCE_LIMIT = 20;
  const EVIDENCE_ITEM_LIMIT = 2000;
  const HISTORY_LIMIT = 20;
  const HISTORY_ITEM_LIMIT = 3000;
  const CONTRIBUTION_LIMIT = 20;
  const CONTRIBUTION_SUMMARY_LIMIT = 4000;
  const CONTRIBUTION_EVIDENCE_LIMIT = 5;
  const CONTRIBUTION_EVIDENCE_ITEM_LIMIT = 1000;
  const PACKET_LIMIT = 12000;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requireString(value, name, limit) {
    if (typeof value !== 'string') throw new TypeError(`${name}은(는) 문자열이어야 합니다.`);
    if (value.length > limit) throw new RangeError(`${name}은(는) ${limit}자를 넘을 수 없습니다.`);
    return value;
  }

  function requireAgent(value, name) {
    if (!AGENTS.has(value)) throw new TypeError(`${name}은(는) codex 또는 claude여야 합니다.`);
    return value;
  }

  function requireList(value, name, maxItems, itemLimit) {
    if (!Array.isArray(value)) throw new TypeError(`${name}은(는) 배열이어야 합니다.`);
    if (value.length > maxItems) throw new RangeError(`${name}은(는) 최대 ${maxItems}개까지 허용됩니다.`);
    return value.map((item, index) => requireString(item, `${name}[${index}]`, itemLimit));
  }

  function jsonLength(value, name) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new TypeError(`${name}은(는) JSON으로 저장할 수 있어야 합니다.`);
    }
    if (serialized === undefined) throw new TypeError(`${name}은(는) JSON으로 저장할 수 있어야 합니다.`);
    return serialized.length;
  }

  function requireEvidence(value) {
    if (!Array.isArray(value)) throw new TypeError('evidence은(는) 배열이어야 합니다.');
    if (value.length > EVIDENCE_LIMIT) throw new RangeError(`evidence은(는) 최대 ${EVIDENCE_LIMIT}개까지 허용됩니다.`);
    return value.map((item, index) => {
      const length = jsonLength(item, `evidence[${index}]`);
      if (length > EVIDENCE_ITEM_LIMIT) throw new RangeError(`evidence[${index}]은(는) ${EVIDENCE_ITEM_LIMIT}자를 넘을 수 없습니다.`);
      return clone(item);
    });
  }

  function now(value) {
    return typeof value === 'string' && value ? value : new Date().toISOString();
  }

  // Only used for the objective, so it carries the larger OBJECTIVE_LIMIT.
  function initialText(value, name) {
    return value === undefined || value === null ? '' : requireString(value, name, OBJECTIVE_LIMIT);
  }

  function documentIdFor(board) {
    return board.documentId === undefined || board.documentId === null || board.documentId === ''
      ? requireString(board.conversationId || '', 'conversationId', 512)
      : requireString(board.documentId, 'documentId', 512);
  }

  function titleFor(board) {
    return board.title === undefined || board.title === null || board.title === ''
      ? fallbackTitle(board.objective)
      : requireString(board.title, 'title', 512);
  }

  function fallbackTitle(objective) {
    return initialText(objective, 'objective').slice(0, 512);
  }

  function requireHistory(value) {
    if (!Array.isArray(value)) throw new TypeError('history은(는) 배열이어야 합니다.');
    if (value.length > HISTORY_LIMIT) throw new RangeError(`history은(는) 최대 ${HISTORY_LIMIT}개까지 허용됩니다.`);
    return value.map((item, index) => {
      const length = jsonLength(item, `history[${index}]`);
      if (length > HISTORY_ITEM_LIMIT) throw new RangeError(`history[${index}]은(는) ${HISTORY_ITEM_LIMIT}자를 넘을 수 없습니다.`);
      return clone(item);
    });
  }

  function historyFor(board) {
    return board.history === undefined || board.history === null ? [] : requireHistory(board.history);
  }

  function requireContributionEvidence(value) {
    if (!Array.isArray(value)) throw new TypeError('contribution evidence은(는) 배열이어야 합니다.');
    if (value.length > CONTRIBUTION_EVIDENCE_LIMIT) throw new RangeError(`contribution evidence은(는) 최대 ${CONTRIBUTION_EVIDENCE_LIMIT}개까지 허용됩니다.`);
    return value.map((item, index) => {
      const length = jsonLength(item, `contribution evidence[${index}]`);
      if (length > CONTRIBUTION_EVIDENCE_ITEM_LIMIT) throw new RangeError(`contribution evidence[${index}]은(는) ${CONTRIBUTION_EVIDENCE_ITEM_LIMIT}자를 넘을 수 없습니다.`);
      return clone(item);
    });
  }

  function requireContributionEntry(value, actor, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${actor} contribution[${index}]은(는) 객체여야 합니다.`);
    return {
      runId: requireString(value.runId || '', `contribution[${index}].runId`, 512),
      summary: requireString(value.summary, `contribution[${index}].summary`, CONTRIBUTION_SUMMARY_LIMIT),
      evidence: value.evidence === undefined ? [] : requireContributionEvidence(value.evidence),
      updatedAt: now(value.updatedAt)
    };
  }

  function requireContributions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('contributions은(는) 객체여야 합니다.');
    const result = {};
    for (const actor of AGENTS) {
      const entries = value[actor] === undefined || value[actor] === null ? [] : value[actor];
      if (!Array.isArray(entries)) throw new TypeError(`${actor} contributions은(는) 배열이어야 합니다.`);
      if (entries.length > CONTRIBUTION_LIMIT) throw new RangeError(`${actor} contributions은(는) 최대 ${CONTRIBUTION_LIMIT}개까지 허용됩니다.`);
      result[actor] = entries.map((entry, index) => requireContributionEntry(entry, actor, index));
    }
    return result;
  }

  function contributionsFor(board) {
    return board.contributions === undefined || board.contributions === null
      ? { codex: [], claude: [] } : requireContributions(board.contributions);
  }

  function historyContributionsFor(board) {
    const contributions = contributionsFor(board);
    const result = {};
    // A durable run record needs the outcome from each AI, not every interim
    // submission. Keep the latest small contribution per actor inside the
    // history item so the 20-item/3k cap remains a compact handoff index.
    for (const actor of AGENTS) {
      const latest = contributions[actor][contributions[actor].length - 1];
      if (!latest || !latest.summary.trim()) continue;
      result[actor] = [{
        summary: latest.summary.slice(0, 700),
        evidence: latest.evidence.slice(0, 2).map(item => {
          if (typeof item === 'string') return item.slice(0, 160);
          const serialized = JSON.stringify(item);
          return serialized.length > 160 ? serialized.slice(0, 160) : item;
        }),
        updatedAt: latest.updatedAt
      }];
    }
    return result;
  }

  function historySummary(board, decisionOverride) {
    const decision = decisionOverride === undefined ? initialText(board.decision, 'decision') : initialText(decisionOverride, 'decision');
    const contributions = historyContributionsFor(board);
    const summary = {
      recordId: board.runId ? `TR-${board.runId}` : '',
      runId: requireString(board.runId || '', 'runId', 512),
      objective: initialText(board.objective, 'objective'),
      decision,
      owner: requireAgent(board.owner, 'owner'),
      reviewer: board.reviewer === undefined || board.reviewer === null ? null : requireAgent(board.reviewer, 'reviewer'),
      updatedAt: now(board.updatedAt),
      ...(Object.keys(contributions).length ? { contributions } : {})
    };
    // A run can contain long proposal text. The durable history is a compact
    // handoff index, so retain both fields while staying within its hard cap.
    if (jsonLength(summary, 'history') > HISTORY_ITEM_LIMIT) {
      summary.objective = summary.objective.slice(0, 1200);
      summary.decision = summary.decision.slice(0, 1200);
    }
    if (jsonLength(summary, 'history') > HISTORY_ITEM_LIMIT) {
      summary.objective = summary.objective.slice(0, 600);
      summary.decision = summary.decision.slice(0, 600);
    }
    if (jsonLength(summary, 'history') > HISTORY_ITEM_LIMIT) {
      summary.objective = '';
      summary.decision = '';
    }
    return summary;
  }

  function createBoard(input = {}) {
    const owner = requireAgent(input.owner || 'codex', 'owner');
    if (input.reviewer !== undefined && input.reviewer !== null && input.reviewer !== '') {
      throw new TypeError('reviewer는 owner로부터 자동 결정됩니다.');
    }
    const phase = input.phase || 'proposal';
    // Independent runs have no reviewer role — the other agent never reviews,
    // so recording it as "reviewer" is misleading.  Only debate/review assign one.
    const reviewer = phase === 'independent' ? null : (owner === 'codex' ? 'claude' : 'codex');
    if (!['proposal', 'review', 'resolve', 'complete', 'independent'].includes(phase)) throw new TypeError('허용되지 않는 phase입니다.');
    const verdict = input.verdict === undefined ? null : input.verdict;
    if (verdict !== null && !['agree', 'disagree', 'conditional'].includes(verdict)) throw new TypeError('verdict는 agree, disagree, conditional 또는 null이어야 합니다.');
    const conversationId = requireString(input.conversationId || '', 'conversationId', 512);
    const objective = initialText(input.objective, 'objective');
    return {
      version: 1,
      documentId: input.documentId === undefined || input.documentId === null || input.documentId === ''
        ? conversationId : requireString(input.documentId, 'documentId', 512),
      title: input.title === undefined || input.title === null || input.title === ''
        ? fallbackTitle(objective) : requireString(input.title, 'title', 512),
      history: input.history === undefined ? [] : requireHistory(input.history),
      contributions: input.contributions === undefined ? { codex: [], claude: [] } : requireContributions(input.contributions),
      conversationId,
      runId: requireString(input.runId || '', 'runId', 512),
      objective,
      owner,
      reviewer,
      phase,
      revision: 0,
      constraints: input.constraints === undefined ? [] : requireList(input.constraints, 'constraints', LIST_LIMIT, ITEM_LIMIT),
      proposal: initialText(input.proposal, 'proposal'),
      evidence: input.evidence === undefined ? [] : requireEvidence(input.evidence),
      verdict,
      disputes: input.disputes === undefined ? [] : requireList(input.disputes, 'disputes', LIST_LIMIT, ITEM_LIMIT),
      decision: initialText(input.decision, 'decision'),
      updatedAt: now(input.updatedAt)
    };
  }

  function validateBoard(board) {
    if (!board || typeof board !== 'object') throw new TypeError('공유 작업 보드가 필요합니다.');
    if (board.version !== 1) throw new TypeError('지원하지 않는 공유 작업 보드 버전입니다.');
    requireAgent(board.owner, 'owner');
    if (board.reviewer !== null && board.reviewer !== undefined) {
      requireAgent(board.reviewer, 'reviewer');
      if (board.reviewer === board.owner) throw new TypeError('reviewer는 owner와 달라야 합니다.');
    }
    if (!Number.isInteger(board.revision) || board.revision < 0) throw new TypeError('revision은 0 이상의 정수여야 합니다.');
    // v1의 초기 flat board에는 문서 필드가 없을 수 있다. 읽을 때만 fallback을 적용한다.
    documentIdFor(board);
    titleFor(board);
    historyFor(board);
    contributionsFor(board);
  }

  function continueBoard(existing, input = {}) {
    validateBoard(existing);
    const priorHistory = historyFor(existing);
    const priorObjective = initialText(existing.objective, 'objective');
    const priorDecision = initialText(existing.decision, 'decision');
    const contributionSummary = contributionSummaryForHistory(existing);
    const history = [...priorHistory];
    if (priorObjective.trim() || priorDecision.trim() || contributionSummary.trim()) history.push(historySummary(existing, priorDecision));
    const retainedHistory = history.slice(-HISTORY_LIMIT);
    const owner = requireAgent(input.owner || existing.owner, 'owner');
    if (input.reviewer !== undefined && input.reviewer !== null && input.reviewer !== '') {
      throw new TypeError('reviewer는 owner로부터 자동 결정됩니다.');
    }
    const board = createBoard({
      conversationId: input.conversationId === undefined ? existing.conversationId : input.conversationId,
      runId: input.runId || '',
      objective: input.objective,
      owner,
      documentId: documentIdFor(existing),
      title: titleFor(existing),
      constraints: existing.constraints === undefined ? [] : existing.constraints,
      history: retainedHistory,
      contributions: { codex: [], claude: [] },
      updatedAt: input.updatedAt
    });
    board.revision = existing.revision + 1;
    return board;
  }

  function contributionSummaryForHistory(board) {
    const contributions = contributionsFor(board);
    const parts = [];
    for (const actor of AGENTS) {
      const latest = contributions[actor][contributions[actor].length - 1];
      if (latest && latest.summary.trim()) parts.push(`[${actor}] ${latest.summary}`);
    }
    return parts.join('\n').slice(0, 1600);
  }

  function continueIndependentBoard(existing, input = {}) {
    validateBoard(existing);
    const priorHistory = historyFor(existing);
    const priorDecision = initialText(existing.decision, 'decision');
    const contributionSummary = contributionSummaryForHistory(existing);
    const history = [...priorHistory];
    if (priorDecision.trim() || contributionSummary.trim()) history.push(historySummary(existing, priorDecision));
    const owner = requireAgent(input.owner || existing.owner, 'owner');
    if (input.reviewer !== undefined && input.reviewer !== null && input.reviewer !== '') {
      throw new TypeError('reviewer는 owner로부터 자동 결정됩니다.');
    }
    const board = createBoard({
      conversationId: input.conversationId === undefined ? existing.conversationId : input.conversationId,
      runId: input.runId || '',
      objective: input.objective,
      owner,
      documentId: documentIdFor(existing),
      title: titleFor(existing),
      constraints: existing.constraints === undefined ? [] : existing.constraints,
      history: history.slice(-HISTORY_LIMIT),
      contributions: { codex: [], claude: [] },
      phase: 'independent',
      updatedAt: input.updatedAt
    });
    board.revision = existing.revision + 1;
    return board;
  }

  function requestedSections(sections) {
    if (!Array.isArray(sections)) throw new TypeError('sections은(는) 배열이어야 합니다.');
    const requested = [...new Set(sections.filter(section => typeof section === 'string' && SECTIONS.includes(section)))];
    if (!requested.length) throw new RangeError('최소 하나의 알려진 section을 요청해야 합니다.');
    return requested;
  }

  function sectionMetrics(board, name) {
    const value = name === 'history' ? historyFor(board) : name === 'contributions' ? contributionsFor(board) : board[name];
    const array = Array.isArray(value);
    return {
      name,
      revision: board.revision,
      ...(array ? { items: value.length, characters: jsonLength(value, name) } : { characters: typeof value === 'string' ? value.length : jsonLength(value, name) })
    };
  }

  function manifest(board) {
    validateBoard(board);
    return {
      version: board.version,
      documentId: documentIdFor(board),
      title: titleFor(board),
      conversationId: board.conversationId,
      runId: board.runId,
      owner: board.owner,
      reviewer: board.reviewer,
      phase: board.phase,
      revision: board.revision,
      updatedAt: board.updatedAt,
      sections: SECTIONS.map(name => sectionMetrics(board, name))
    };
  }

  function readSections(board, sections) {
    validateBoard(board);
    const selected = requestedSections(sections);
    const result = {};
    for (const name of selected) result[name] = name === 'history' ? historyFor(board) : name === 'contributions' ? contributionsFor(board) : clone(board[name]);
    return result;
  }

  function parsePatch(expectedRevisionOrPatch, actor, changes) {
    if (expectedRevisionOrPatch && typeof expectedRevisionOrPatch === 'object' && !Array.isArray(expectedRevisionOrPatch)) {
      const patch = expectedRevisionOrPatch;
      const resolvedChanges = patch.changes || (typeof patch.section === 'string' ? { [patch.section]: patch.value } : null);
      return { expectedRevision: patch.expectedRevision, actor: patch.actor, changes: resolvedChanges, updatedAt: patch.updatedAt };
    }
    return { expectedRevision: expectedRevisionOrPatch, actor, changes };
  }

  // LLM tool calls sometimes serialize an array/object argument as a JSON
  // string when the parameter schema is untyped (value: {}).  For the array
  // sections, accept that stringified form so a well-formed update isn't
  // rejected with "배열이어야 합니다".  String sections are never coerced, and a
  // string that doesn't parse to a container is left as-is (still rejected).
  function coerceJsonContainer(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed[0] !== '[' && trimmed[0] !== '{') return value;
    try { const parsed = JSON.parse(trimmed); return parsed && typeof parsed === 'object' ? parsed : value; } catch { return value; }
  }

  function validateChange(name, value) {
    if (name === 'constraints' || name === 'disputes') return requireList(coerceJsonContainer(value), name, LIST_LIMIT, ITEM_LIMIT);
    if (name === 'evidence') return requireEvidence(coerceJsonContainer(value));
    if (name === 'verdict') {
      if (!['agree', 'disagree', 'conditional'].includes(value)) throw new TypeError('verdict는 agree, disagree 또는 conditional이어야 합니다.');
      return value;
    }
    // proposal/decision are string sections, but agents often hand back a
    // structured object (position/rationale/…).  Accept that by serializing it
    // rather than rejecting the whole update; a real string passes untouched.
    return requireString(value && typeof value === 'object' ? JSON.stringify(value) : value, name, TEXT_LIMIT);
  }

  function applyPatch(board, expectedRevisionOrPatch, actor, changes) {
    validateBoard(board);
    const patch = parsePatch(expectedRevisionOrPatch, actor, changes);
    if (!Number.isInteger(patch.expectedRevision)) throw new TypeError('expectedRevision은 정수여야 합니다.');
    if (patch.expectedRevision !== board.revision) throw new RangeError(`보드 revision이 변경되었습니다. 현재 revision: ${board.revision}`);
    requireAgent(patch.actor, 'actor');
    if (!patch.changes || typeof patch.changes !== 'object' || Array.isArray(patch.changes)) throw new TypeError('changes가 필요합니다.');
    const names = Object.keys(patch.changes);
    if (!names.length) throw new RangeError('최소 하나의 변경 section이 필요합니다.');
    if (names.some(name => !SECTIONS.includes(name))) throw new TypeError('알 수 없는 section은 수정할 수 없습니다.');
    if (names.includes('history') || names.includes('contributions')) throw new TypeError('history와 contributions는 읽기 전용입니다. 전용 실행/기여 API만 사용할 수 있습니다.');
    if (names.includes('objective')) throw new TypeError('objective는 생성 후 수정할 수 없습니다.');
    const permitted = patch.actor === board.owner ? OWNER_SECTIONS : REVIEWER_SECTIONS;
    if (patch.actor !== board.owner && board.reviewer !== patch.actor) throw new TypeError('이 보드의 reviewer가 아닙니다.');
    if (names.some(name => !permitted.has(name))) throw new TypeError('이 역할은 요청한 section을 수정할 수 없습니다.');

    const next = clone(board);
    for (const name of names) next[name] = validateChange(name, patch.changes[name]);
    if (next.phase !== 'independent') {
      if (names.includes('decision')) next.phase = 'complete';
      else if (names.some(name => REVIEWER_SECTIONS.has(name))) next.phase = 'resolve';
      else if (names.includes('proposal')) next.phase = 'review';
    }
    next.revision += 1;
    next.updatedAt = now(patch.updatedAt);
    return next;
  }

  function appendContribution(board, actor, input = {}) {
    validateBoard(board);
    requireAgent(actor, 'actor');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('contribution 입력이 필요합니다.');
    const summary = requireString(input.summary, 'summary', CONTRIBUTION_SUMMARY_LIMIT);
    if (!summary.trim()) throw new RangeError('summary는 비어 있을 수 없습니다.');
    const next = clone(board);
    const contributions = contributionsFor(board);
    contributions[actor].push({
      runId: input.runId === undefined ? requireString(board.runId || '', 'runId', 512) : requireString(input.runId, 'runId', 512),
      summary,
      evidence: input.evidence === undefined ? [] : requireContributionEvidence(input.evidence),
      updatedAt: now(input.updatedAt)
    });
    next.contributions = contributions;
    next.contributions[actor] = next.contributions[actor].slice(-CONTRIBUTION_LIMIT);
    next.revision += 1;
    next.updatedAt = now(input.updatedAt);
    return next;
  }

  function packetOptions(sectionsOrOptions, maxCharacters) {
    if (Array.isArray(sectionsOrOptions)) return { sections: sectionsOrOptions, maxCharacters };
    if (sectionsOrOptions && typeof sectionsOrOptions === 'object') return sectionsOrOptions;
    return { sections: sectionsOrOptions, maxCharacters };
  }

  function compactPacket(board, sectionsOrOptions, maxCharacters) {
    validateBoard(board);
    const options = packetOptions(sectionsOrOptions, maxCharacters);
    const selected = requestedSections(options.sections);
    const limit = options.maxCharacters === undefined ? PACKET_LIMIT : options.maxCharacters;
    if (!Number.isInteger(limit) || limit < 1 || limit > PACKET_LIMIT) throw new RangeError(`maxCharacters는 1~${PACKET_LIMIT} 사이의 정수여야 합니다.`);
    const packet = {
      version: board.version,
      documentId: documentIdFor(board),
      title: titleFor(board),
      conversationId: board.conversationId,
      runId: board.runId,
      owner: board.owner,
      reviewer: board.reviewer,
      phase: board.phase,
      revision: board.revision,
      sections: readSections(board, selected)
    };
    if (jsonLength(packet, 'packet') > limit) throw new RangeError(`요청한 공유 컨텍스트가 ${limit}자 제한을 초과했습니다.`);
    return packet;
  }

  return {
    AGENTS: [...AGENTS],
    SECTIONS: [...SECTIONS],
    TEXT_LIMIT,
    OBJECTIVE_LIMIT,
    LIST_LIMIT,
    ITEM_LIMIT,
    EVIDENCE_LIMIT,
    EVIDENCE_ITEM_LIMIT,
    HISTORY_LIMIT,
    HISTORY_ITEM_LIMIT,
    CONTRIBUTION_LIMIT,
    CONTRIBUTION_SUMMARY_LIMIT,
    CONTRIBUTION_EVIDENCE_LIMIT,
    CONTRIBUTION_EVIDENCE_ITEM_LIMIT,
    PACKET_LIMIT,
    createBoard,
    continueBoard,
    continueIndependentBoard,
    manifest,
    readSections,
    applyPatch,
    appendContribution,
    compactPacket
  };
});
