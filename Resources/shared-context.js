(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadSharedContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AGENTS = new Set(['codex', 'claude']);
  const SECTIONS = ['objective', 'constraints', 'proposal', 'evidence', 'verdict', 'disputes', 'decision'];
  const OWNER_SECTIONS = new Set(['constraints', 'proposal', 'evidence', 'decision']);
  const REVIEWER_SECTIONS = new Set(['verdict', 'disputes']);
  const TEXT_LIMIT = 8000;
  const LIST_LIMIT = 10;
  const ITEM_LIMIT = 1000;
  const EVIDENCE_LIMIT = 20;
  const EVIDENCE_ITEM_LIMIT = 2000;
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

  function initialText(value, name) {
    return value === undefined || value === null ? '' : requireString(value, name, TEXT_LIMIT);
  }

  function createBoard(input = {}) {
    const owner = requireAgent(input.owner || 'codex', 'owner');
    if (input.reviewer !== undefined && input.reviewer !== null && input.reviewer !== '') {
      throw new TypeError('reviewer는 owner로부터 자동 결정됩니다.');
    }
    const reviewer = owner === 'codex' ? 'claude' : 'codex';
    const phase = input.phase || 'proposal';
    if (!['proposal', 'review', 'resolve', 'complete'].includes(phase)) throw new TypeError('허용되지 않는 phase입니다.');
    const verdict = input.verdict === undefined ? null : input.verdict;
    if (verdict !== null && !['agree', 'disagree', 'conditional'].includes(verdict)) throw new TypeError('verdict는 agree, disagree, conditional 또는 null이어야 합니다.');
    return {
      version: 1,
      conversationId: requireString(input.conversationId || '', 'conversationId', 512),
      runId: requireString(input.runId || '', 'runId', 512),
      objective: initialText(input.objective, 'objective'),
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
  }

  function requestedSections(sections) {
    if (!Array.isArray(sections)) throw new TypeError('sections은(는) 배열이어야 합니다.');
    const requested = [...new Set(sections.filter(section => typeof section === 'string' && SECTIONS.includes(section)))];
    if (!requested.length) throw new RangeError('최소 하나의 알려진 section을 요청해야 합니다.');
    return requested;
  }

  function sectionMetrics(board, name) {
    const value = board[name];
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
    for (const name of selected) result[name] = clone(board[name]);
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

  function validateChange(name, value) {
    if (name === 'constraints' || name === 'disputes') return requireList(value, name, LIST_LIMIT, ITEM_LIMIT);
    if (name === 'evidence') return requireEvidence(value);
    if (name === 'verdict') {
      if (!['agree', 'disagree', 'conditional'].includes(value)) throw new TypeError('verdict는 agree, disagree 또는 conditional이어야 합니다.');
      return value;
    }
    return requireString(value, name, TEXT_LIMIT);
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
    if (names.includes('objective')) throw new TypeError('objective는 생성 후 수정할 수 없습니다.');
    const permitted = patch.actor === board.owner ? OWNER_SECTIONS : REVIEWER_SECTIONS;
    if (patch.actor !== board.owner && board.reviewer !== patch.actor) throw new TypeError('이 보드의 reviewer가 아닙니다.');
    if (names.some(name => !permitted.has(name))) throw new TypeError('이 역할은 요청한 section을 수정할 수 없습니다.');

    const next = clone(board);
    for (const name of names) next[name] = validateChange(name, patch.changes[name]);
    if (names.includes('decision')) next.phase = 'complete';
    else if (names.some(name => REVIEWER_SECTIONS.has(name))) next.phase = 'resolve';
    else if (names.includes('proposal')) next.phase = 'review';
    next.revision += 1;
    next.updatedAt = now(patch.updatedAt);
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
    LIST_LIMIT,
    ITEM_LIMIT,
    EVIDENCE_LIMIT,
    EVIDENCE_ITEM_LIMIT,
    PACKET_LIMIT,
    createBoard,
    manifest,
    readSections,
    applyPatch,
    compactPacket
  };
});
