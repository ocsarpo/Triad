const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../Resources/shared-context.js'), 'utf8');
const context = {};
vm.runInNewContext(source, context);
const boardApi = context.TriadSharedContext;
const plain = value => JSON.parse(JSON.stringify(value));

test('UMD 모듈은 브라우저 전역과 CommonJS module.exports에서 같은 API를 제공한다', () => {
  const commonJsContext = { module: { exports: {} } };
  vm.runInNewContext(source, commonJsContext);
  const nodeApi = commonJsContext.module.exports;
  for (const name of ['createBoard', 'continueBoard', 'continueIndependentBoard', 'manifest', 'readSections', 'applyPatch', 'appendContribution', 'compactPacket']) {
    assert.equal(typeof boardApi[name], 'function');
    assert.equal(typeof nodeApi[name], 'function');
  }
});

test('보드는 정해진 기본 스키마와 revision 0으로 생성된다', () => {
  const board = boardApi.createBoard({ conversationId: 'chat-1', runId: 'run-1', objective: '토큰 사용량을 줄인다', owner: 'claude', updatedAt: '2026-07-23T00:00:00.000Z' });
  assert.deepEqual(plain(board), {
    version: 1,
    documentId: 'chat-1',
    title: '토큰 사용량을 줄인다',
    history: [],
    contributions: { codex: [], claude: [] },
    conversationId: 'chat-1',
    runId: 'run-1',
    objective: '토큰 사용량을 줄인다',
    owner: 'claude',
    reviewer: 'codex',
    phase: 'proposal',
    revision: 0,
    constraints: [],
    proposal: '',
    evidence: [],
    verdict: null,
    disputes: [],
    decision: '',
    updatedAt: '2026-07-23T00:00:00.000Z'
  });
});

test('manifest는 요약만 제공하고 section별 revision과 크기를 표시한다', () => {
  const board = boardApi.createBoard({ objective: '검증', constraints: ['두 라운드 이하'] });
  const result = plain(boardApi.manifest(board));
  assert.equal(result.revision, 0);
  assert.equal(result.documentId, board.documentId);
  assert.equal(result.title, board.title);
  assert.equal(result.sections.length, 9);
  assert.deepEqual(result.sections.find(section => section.name === 'constraints'), {
    name: 'constraints', revision: 0, items: 1, characters: '["두 라운드 이하"]'.length
  });
  assert.equal(Object.hasOwn(result, 'proposal'), false);
});

test('readSections는 요청한 알려진 section만 복사해 반환한다', () => {
  const board = boardApi.createBoard({ objective: '비공개 목표', proposal: '초안', evidence: [{ path: 'a.js', line: 3 }] });
  const result = boardApi.readSections(board, ['proposal', 'not-a-section']);
  assert.deepEqual(plain(result), { proposal: '초안' });
  result.proposal = '변조';
  assert.equal(board.proposal, '초안');
  assert.throws(() => boardApi.readSections(board, []), /최소 하나/);
});

test('owner는 제안과 근거를 원자적으로 갱신하고 revision을 하나만 증가시킨다', () => {
  const board = boardApi.createBoard({ owner: 'codex', objective: '리뷰' });
  const next = boardApi.applyPatch(board, {
    expectedRevision: 0,
    actor: 'codex',
    changes: { proposal: '공유 보드로 전달한다', evidence: [{ path: 'Resources/a.js', line: 12, claim: '근거' }] },
    updatedAt: '2026-07-23T01:00:00.000Z'
  });
  assert.equal(board.revision, 0);
  assert.equal(next.revision, 1);
  assert.equal(next.phase, 'review');
  assert.equal(next.proposal, '공유 보드로 전달한다');
  assert.deepEqual(plain(next.evidence), [{ path: 'Resources/a.js', line: 12, claim: '근거' }]);
});

test('role 별 section 권한과 reviewer 고정이 강제된다', () => {
  const board = boardApi.createBoard({ owner: 'claude' });
  assert.throws(() => boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { proposal: '권한 없음' } }), /역할/);
  const reviewed = boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { verdict: 'conditional', disputes: ['락 경합'] } });
  assert.equal(reviewed.reviewer, 'codex');
  assert.equal(reviewed.phase, 'resolve');
  assert.throws(() => boardApi.applyPatch(reviewed, { expectedRevision: 1, actor: 'claude', changes: { verdict: 'agree' } }), /역할/);
});

test('stale revision과 immutable objective를 거부한다', () => {
  const board = boardApi.createBoard({ owner: 'codex', objective: '처음 목표' });
  const next = boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { proposal: '초안' } });
  assert.throws(() => boardApi.applyPatch(next, { expectedRevision: 0, actor: 'codex', changes: { proposal: '오래된 수정' } }), /revision/);
  assert.throws(() => boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { objective: '변경 금지' } }), /생성 후 수정/);
});

test('문자 수와 목록 상한을 적용한다', () => {
  const board = boardApi.createBoard({ owner: 'codex' });
  assert.throws(() => boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { proposal: 'x'.repeat(boardApi.TEXT_LIMIT + 1) } }), /8000/);
  assert.throws(() => boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { constraints: Array(11).fill('제약') } }), /최대 10개/);
  assert.throws(() => boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { evidence: ['x'.repeat(boardApi.EVIDENCE_ITEM_LIMIT + 1)] } }), /2000/);
});

test('compactPacket은 선택한 section과 식별자만 전송하고 12k 제한을 강제한다', () => {
  const board = boardApi.createBoard({ conversationId: 'c', runId: 'r', owner: 'codex', objective: '목표', proposal: '짧은 초안', evidence: [{ path: 'x.js' }] });
  const packet = plain(boardApi.compactPacket(board, { sections: ['proposal'] }));
  assert.deepEqual(Object.keys(packet.sections), ['proposal']);
  assert.equal(Object.hasOwn(packet.sections, 'objective'), false);
  assert.equal(packet.revision, 0);
  assert.throws(() => boardApi.compactPacket(board, { sections: ['proposal'], maxCharacters: 10 }), /제한/);
});

test('새 공유 문서는 안정적인 documentId, 제목과 비어 있는 history를 만든다', () => {
  const board = boardApi.createBoard({ conversationId: 'chat-1', documentId: 'doc-refund', title: '환불 검토', objective: '첫 실행' });
  assert.equal(board.documentId, 'doc-refund');
  assert.equal(board.title, '환불 검토');
  assert.deepEqual(plain(board.history), []);
  const fallback = boardApi.createBoard({ conversationId: 'chat-fallback', objective: '의제' });
  assert.equal(fallback.documentId, 'chat-fallback');
  assert.equal(fallback.title, '의제');
  const longObjective = 'x'.repeat(600);
  assert.equal(boardApi.createBoard({ objective: longObjective }).title.length, 512);
  const legacyTitle = boardApi.manifest({ version: 1, conversationId: 'legacy', runId: '', objective: longObjective, owner: 'codex', reviewer: 'claude', phase: 'proposal', revision: 0, constraints: [], proposal: '', evidence: [], verdict: null, disputes: [], decision: '', updatedAt: 'now' }).title;
  assert.equal(legacyTitle.length, 512);
});

test('continueBoard는 문서 정체성과 제약을 유지하고 새 실행 단계와 이력을 만든다', () => {
  const existing = boardApi.createBoard({
    conversationId: 'chat-old', runId: 'run-1', documentId: 'doc-1', title: '환불 정책', objective: '초기 분석',
    owner: 'claude', constraints: ['두 라운드 이하'], proposal: '기존 초안', evidence: [{ path: 'old.js' }],
    verdict: 'conditional', disputes: ['반례'], decision: '초기 결론', updatedAt: '2026-07-23T00:00:00.000Z'
  });
  const continued = boardApi.continueBoard(existing, {
    conversationId: 'chat-current', runId: 'run-2', objective: '후속 검토', owner: 'codex', updatedAt: '2026-07-23T01:00:00.000Z'
  });
  assert.equal(continued.documentId, 'doc-1');
  assert.equal(continued.title, '환불 정책');
  assert.deepEqual(plain(continued.constraints), ['두 라운드 이하']);
  assert.equal(continued.conversationId, 'chat-current');
  assert.equal(continued.runId, 'run-2');
  assert.equal(continued.owner, 'codex');
  assert.equal(continued.reviewer, 'claude');
  assert.equal(continued.phase, 'proposal');
  assert.equal(continued.revision, existing.revision + 1);
  assert.equal(continued.proposal, '');
  assert.deepEqual(plain(continued.evidence), []);
  assert.equal(continued.verdict, null);
  assert.deepEqual(plain(continued.disputes), []);
  assert.equal(continued.decision, '');
  assert.deepEqual(plain(continued.contributions), { codex: [], claude: [] });
  assert.deepEqual(plain(continued.history), [{
    recordId: 'TR-run-1', runId: 'run-1', objective: '초기 분석', decision: '초기 결론', owner: 'claude', reviewer: 'codex', updatedAt: '2026-07-23T00:00:00.000Z'
  }]);
});

test('continueBoard는 이전 독립 contribution을 구조화된 history 기여로 보존한다', () => {
  const existing = boardApi.createBoard({
    conversationId: 'chat-old', runId: 'independent-1', documentId: 'doc-1', title: '문서', objective: '독립 조사', owner: 'codex',
    contributions: { codex: [{ runId: 'independent-1', summary: 'Codex 조사 결과', evidence: [], updatedAt: 'old' }], claude: [{ runId: 'independent-1', summary: 'Claude 조사 결과', evidence: [], updatedAt: 'old' }] },
    phase: 'independent'
  });
  const continued = boardApi.continueBoard(existing, { conversationId: 'chat-new', runId: 'collab-2', objective: '교차 검토', owner: 'claude' });
  assert.equal(continued.phase, 'proposal');
  assert.equal(continued.history.length, 1);
  assert.equal(continued.history[0].decision, '');
  assert.deepEqual(plain(continued.history[0].contributions), {
    codex: [{ summary: 'Codex 조사 결과', evidence: [], updatedAt: 'old' }],
    claude: [{ summary: 'Claude 조사 결과', evidence: [], updatedAt: 'old' }]
  });
  assert.deepEqual(plain(continued.contributions), { codex: [], claude: [] });
});

test('legacy v1 flat board는 문서 fallback으로 읽고 patch해도 호환된다', () => {
  const legacy = {
    version: 1, conversationId: 'legacy-chat', runId: 'legacy-run', objective: '기존 목표', owner: 'codex', reviewer: 'claude',
    phase: 'proposal', revision: 0, constraints: [], proposal: '', evidence: [], verdict: null, disputes: [], decision: '', updatedAt: '2026-07-23T00:00:00.000Z'
  };
  const summary = boardApi.manifest(legacy);
  assert.equal(summary.documentId, 'legacy-chat');
  assert.equal(summary.title, '기존 목표');
  assert.deepEqual(plain(boardApi.readSections(legacy, ['history'])), { history: [] });
  const patched = boardApi.applyPatch(legacy, { expectedRevision: 0, actor: 'codex', changes: { proposal: '새 초안' } });
  assert.equal(patched.documentId, undefined);
  assert.equal(patched.proposal, '새 초안');
});

test('history는 최대 20개의 작은 항목만 읽을 수 있고 actor가 직접 수정할 수 없다', () => {
  const history = Array.from({ length: boardApi.HISTORY_LIMIT }, (_, index) => ({ runId: `r-${index}`, objective: '목표', decision: '', owner: 'codex', reviewer: 'claude', updatedAt: 'now' }));
  const board = boardApi.createBoard({ owner: 'codex', history });
  assert.deepEqual(plain(boardApi.readSections(board, ['history'])).history, history);
  assert.throws(() => boardApi.createBoard({ history: [...history, {}] }), /최대 20개/);
  assert.throws(() => boardApi.createBoard({ history: [{ note: 'x'.repeat(boardApi.HISTORY_ITEM_LIMIT + 1) }] }), /3000/);
  assert.throws(() => boardApi.applyPatch(board, { expectedRevision: 0, actor: 'codex', changes: { history: [] } }), /읽기 전용/);
});

test('history는 패킷에서 명시적으로 선택했을 때만 전달된다', () => {
  const board = boardApi.createBoard({ conversationId: 'chat', documentId: 'doc', title: '문서', objective: '목표', history: [{ runId: 'old', objective: '이전', decision: '결론', owner: 'codex', reviewer: 'claude', updatedAt: 'now' }] });
  const withoutHistory = plain(boardApi.compactPacket(board, { sections: ['objective'] }));
  const withHistory = plain(boardApi.compactPacket(board, { sections: ['history'] }));
  assert.equal(Object.hasOwn(withoutHistory.sections, 'history'), false);
  assert.deepEqual(withHistory.sections.history, plain(board.history));
  assert.equal(withHistory.documentId, 'doc');
  assert.equal(withHistory.title, '문서');
});

test('독립 실행은 이전 기여를 구조화된 history로 보존하고 새 실행 contributions를 비운다', () => {
  const existing = boardApi.createBoard({
    conversationId: 'chat-old', runId: 'run-1', documentId: 'doc-1', title: '독립 작업', objective: '이전 목표', owner: 'codex',
    constraints: ['근거만 기록'], contributions: { codex: [{ runId: 'run-1', summary: 'Codex 결과', evidence: ['a.js'], updatedAt: 'old' }], claude: [{ runId: 'run-1', summary: 'Claude 검토', evidence: [], updatedAt: 'old' }] }
  });
  const continued = boardApi.continueIndependentBoard(existing, { conversationId: 'chat-new', runId: 'run-2', objective: '새 목표', owner: 'claude', updatedAt: 'new' });
  assert.equal(continued.phase, 'independent');
  assert.equal(continued.documentId, 'doc-1');
  assert.equal(continued.title, '독립 작업');
  assert.deepEqual(plain(continued.constraints), ['근거만 기록']);
  assert.deepEqual(plain(continued.contributions), { codex: [], claude: [] });
  assert.equal(continued.history.length, 1);
  assert.equal(continued.history[0].decision, '');
  assert.deepEqual(plain(continued.history[0].contributions), {
    codex: [{ summary: 'Codex 결과', evidence: ['a.js'], updatedAt: 'old' }],
    claude: [{ summary: 'Claude 검토', evidence: [], updatedAt: 'old' }]
  });
});

test('실행 history는 최신 AI 기여만 구조화해 보존하며 항목·패킷 상한을 지킨다', () => {
  const contributions = {
    codex: [
      { runId: 'run-1', summary: '이전 Codex 제출', evidence: [], updatedAt: 'one' },
      { runId: 'run-1', summary: '최종 Codex 제출', evidence: ['a.js'], updatedAt: 'two' }
    ],
    claude: [{ runId: 'run-1', summary: '최종 Claude 검토', evidence: ['b.js'], updatedAt: 'three' }]
  };
  const existing = boardApi.createBoard({ runId: 'run-1', objective: '이전 실행', owner: 'codex', contributions });
  const continued = boardApi.continueIndependentBoard(existing, { runId: 'run-2', objective: '새 실행', owner: 'claude' });
  assert.equal(JSON.stringify(continued.history[0]).length <= boardApi.HISTORY_ITEM_LIMIT, true);
  assert.equal(continued.history[0].contributions.codex[0].summary, '최종 Codex 제출');
  assert.equal(continued.history[0].contributions.claude[0].summary, '최종 Claude 검토');
  const packet = boardApi.compactPacket(continued, { sections: ['history'] });
  assert.equal(JSON.stringify(packet).length <= boardApi.PACKET_LIMIT, true);
});

test('최대 크기 contribution도 history 항목 상한 안에서 보존한다', () => {
  const long = 'x'.repeat(boardApi.CONTRIBUTION_SUMMARY_LIMIT);
  const evidence = Array.from({ length: boardApi.CONTRIBUTION_EVIDENCE_LIMIT }, () => 'e'.repeat(boardApi.CONTRIBUTION_EVIDENCE_ITEM_LIMIT - 2));
  const existing = boardApi.createBoard({
    runId: 'run-1', objective: 'o'.repeat(boardApi.TEXT_LIMIT), decision: 'd'.repeat(boardApi.TEXT_LIMIT), owner: 'codex',
    contributions: {
      codex: [{ runId: 'run-1', summary: long, evidence, updatedAt: 'old' }],
      claude: [{ runId: 'run-1', summary: long, evidence, updatedAt: 'old' }]
    }
  });
  const continued = boardApi.continueIndependentBoard(existing, { runId: 'run-2', objective: '다음 실행', owner: 'claude' });
  assert.equal(JSON.stringify(continued.history[0]).length <= boardApi.HISTORY_ITEM_LIMIT, true);
});

test('각 AI는 자기 contribution만 cap 내에서 추가하고 일반 patch로는 수정할 수 없다', () => {
  let board = boardApi.createBoard({ runId: 'run-1', phase: 'independent', owner: 'codex' });
  board = boardApi.appendContribution(board, 'codex', { summary: 'Codex 결과', evidence: [{ path: 'a.js' }], updatedAt: 'one' });
  const claude = boardApi.appendContribution(board, 'claude', { summary: 'Claude 결과', updatedAt: 'two' });
  assert.equal(board.phase, 'independent');
  assert.equal(claude.phase, 'independent');
  assert.equal(claude.revision, 2);
  assert.equal(claude.contributions.codex.length, 1);
  assert.equal(claude.contributions.claude.length, 1);
  assert.throws(() => boardApi.applyPatch(claude, { expectedRevision: 2, actor: 'codex', changes: { contributions: { codex: [], claude: [] } } }), /읽기 전용/);
  assert.throws(() => boardApi.appendContribution(claude, 'codex', { summary: 'x'.repeat(boardApi.CONTRIBUTION_SUMMARY_LIMIT + 1) }), /4000/);
  assert.throws(() => boardApi.appendContribution(claude, 'codex', { summary: 'ok', evidence: Array(6).fill('evidence') }), /최대 5개/);
});

test('contribution은 agent별 최근 20개만 보존한다', () => {
  let board = boardApi.createBoard({ runId: 'run', phase: 'independent', owner: 'codex' });
  for (let index = 0; index < boardApi.CONTRIBUTION_LIMIT + 1; index += 1) board = boardApi.appendContribution(board, 'codex', { summary: `결과 ${index}` });
  assert.equal(board.contributions.codex.length, boardApi.CONTRIBUTION_LIMIT);
  assert.equal(board.contributions.codex[0].summary, '결과 1');
  assert.equal(board.contributions.codex.at(-1).summary, `결과 ${boardApi.CONTRIBUTION_LIMIT}`);
});

test('contributions는 명시 선택한 패킷에서만 전달된다', () => {
  const board = boardApi.createBoard({ contributions: { codex: [{ runId: '', summary: '결과', evidence: [], updatedAt: 'now' }], claude: [] } });
  const withoutContributions = plain(boardApi.compactPacket(board, { sections: ['objective'] }));
  const withContributions = plain(boardApi.compactPacket(board, { sections: ['contributions'] }));
  assert.equal(Object.hasOwn(withoutContributions.sections, 'contributions'), false);
  assert.deepEqual(withContributions.sections.contributions, { codex: [{ runId: '', summary: '결과', evidence: [], updatedAt: 'now' }], claude: [] });
});
