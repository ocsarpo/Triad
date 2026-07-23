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
  for (const name of ['createBoard', 'manifest', 'readSections', 'applyPatch', 'compactPacket']) {
    assert.equal(typeof boardApi[name], 'function');
    assert.equal(typeof nodeApi[name], 'function');
  }
});

test('보드는 정해진 기본 스키마와 revision 0으로 생성된다', () => {
  const board = boardApi.createBoard({ conversationId: 'chat-1', runId: 'run-1', objective: '토큰 사용량을 줄인다', owner: 'claude', updatedAt: '2026-07-23T00:00:00.000Z' });
  assert.deepEqual(plain(board), {
    version: 1,
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
  assert.equal(result.sections.length, 7);
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
