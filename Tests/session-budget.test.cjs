const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/session-budget.js'), 'utf8'), context);
const budget = context.TriadSessionBudget;
const plain = value => JSON.parse(JSON.stringify(value));

test('영문은 4자, 한글·이모지는 code point 하나를 보수적으로 한 토큰으로 추정한다', () => {
  assert.equal(budget.estimateTokens(''), 0);
  assert.equal(budget.estimateTokens('abcd'), 1);
  assert.equal(budget.estimateTokens('가'), 1);
  assert.equal(budget.estimateTokens('😀'), 1);
  assert.equal(budget.estimateTokens('가나다라마바사'), 7);
});

test('Codex는 cache 토큰을 중복 합산하지 않고 Claude는 논리 입력에 포함한다', () => {
  const usage = { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 };
  assert.equal(budget.logicalInputTokens('codex', usage), 100);
  assert.equal(budget.logicalInputTokens('claude', usage), 350);
  assert.equal(budget.logicalInputTokens('claude', { inputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 }), 9);
});

test('정규화와 기록은 유효 범위 및 같은 요청의 usage 보강을 보장한다', () => {
  // 자동 회전 정책 제거 — 레거시 'auto'와 한도 필드는 '계속 유지'로 흡수된다.
  assert.deepEqual(plain(budget.normalizePolicy({ sessionPolicy: 'auto', sessionTurnLimit: 1, sessionTokenLimit: 900000 })), { sessionPolicy: 'continue' });
  assert.deepEqual(plain(budget.normalizePolicy({ sessionPolicy: 'alwaysNew' })), { sessionPolicy: 'alwaysNew' });
  assert.deepEqual(plain(budget.normalizePolicy({})), { sessionPolicy: 'continue' });
  let stats = budget.recordUsage({}, 'claude', { input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 3 });
  assert.equal(stats.claude.turns, 1);
  assert.equal(stats.claude.sessionInputTokens, 30);
  stats = budget.recordUsage(stats, 'claude', { input_tokens: 10, cache_read_input_tokens: 40, output_tokens: 8 }, { replaceLast: true });
  assert.equal(stats.claude.turns, 1);
  assert.equal(stats.claude.sessionInputTokens, 50);
  assert.equal(stats.claude.lastOutputTokens, 8);
});

test('usage가 없는 정상 종료도 정확히 한 turn으로 기록한다', () => {
  let stats = budget.recordCompletion({}, 'codex', { sessionId: 'thread-1' });
  assert.equal(stats.codex.turns, 1);
  assert.equal(stats.codex.sessionInputTokens, 0);
  assert.equal(stats.codex.sessionId, 'thread-1');
  stats = budget.recordUsage(stats, 'codex', { input_tokens: 9 }, { replaceLast: true });
  assert.equal(stats.codex.turns, 1);
  assert.equal(stats.codex.sessionInputTokens, 9);
});

test('자동 회전 기계는 제거되었다 — 통계는 표시용으로만 수집한다', () => {
  // shouldRotate/requiresFreshSession 없음 — CLI가 스스로 문맥을 관리한다.
  assert.equal(typeof budget.shouldRotate, 'undefined');
  const stats = budget.normalizeStats({ codex: { sessionId: 'thread-1', turns: 3, sessionInputTokens: 500, lastInputTokens: 200 } });
  assert.equal('requiresFreshSession' in stats.codex, false);
  assert.equal(stats.codex.turns, 3);
  assert.equal(stats.codex.lastInputTokens, 200);
  // 수동/정책 리셋은 유지 (rotations 카운터 포함)
  const fresh = budget.resetAgent(stats, 'codex', { incrementRotation: true });
  assert.equal(fresh.codex.turns, 0);
  assert.equal(fresh.codex.rotations, 1);
});
