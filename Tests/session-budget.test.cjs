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
  assert.deepEqual(plain(budget.normalizePolicy({ sessionTurnLimit: 1, sessionTokenLimit: 900000 })), { sessionPolicy: 'auto', sessionTurnLimit: 6, sessionTokenLimit: 48000 });
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

test('자동 회전은 auto + resume 세션에서만 경계를 넘을 때 수행한다', () => {
  const stats = { turns: 6, sessionInputTokens: 100, lastInputTokens: 0, lastOutputTokens: 0, sessionId: 'x', rotations: 0 };
  assert.equal(budget.shouldRotate({ sessionPolicy: 'auto', sessionTurnLimit: 6 }, stats, true), true);
  assert.equal(budget.shouldRotate({ sessionPolicy: 'continue', sessionTurnLimit: 2 }, stats, true), false);
  assert.equal(budget.shouldRotate({ sessionPolicy: 'auto', sessionTurnLimit: 2 }, stats, false), false);
  assert.equal(budget.shouldRotate({ sessionPolicy: 'alwaysNew' }, stats, true), false);
});

test('기존의 측정되지 않은 resume 세션은 auto 정책에서 한 번 새 세션으로 회전한다', () => {
  const legacy = budget.normalizeStats({
    codex: { sessionId: 'thread-legacy', turns: 0, sessionInputTokens: 0 },
    claude: { sessionId: 'session-legacy', turns: 0, sessionInputTokens: 0 }
  }, { codex: 'thread-legacy', claude: 'session-legacy' });
  assert.equal(legacy.codex.requiresFreshSession, true);
  assert.equal(legacy.claude.requiresFreshSession, true);
  assert.equal(budget.shouldRotate({ sessionPolicy: 'auto' }, legacy.codex, true), true);
  assert.equal(budget.shouldRotate({ sessionPolicy: 'continue' }, legacy.codex, true), false);

  const fresh = budget.resetAgent(legacy, 'codex', { incrementRotation: true });
  assert.equal(fresh.codex.requiresFreshSession, false);
  const measured = budget.recordCompletion(legacy, 'claude', { sessionId: 'session-legacy' });
  assert.equal(measured.claude.requiresFreshSession, false);
});
