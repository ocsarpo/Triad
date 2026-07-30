const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

// Prompt-prefix caching only holds when the byte-stable content forms a
// contiguous prefix and the per-turn volatile board delta comes last.  These
// guard against a future edit silently moving the board snapshot ahead of the
// stable objective/role/policy text (which would break caching every turn).

test('토론/교차검토 하니스 프롬프트는 제거되었다 (모드 축소)', () => {
  assert.doesNotMatch(renderer, /function buildCollaborationPrompt/);
  assert.doesNotMatch(renderer, /function runNextCollaborationTurn/);
  assert.doesNotMatch(renderer, /submit_verdict 도구로/);
});

test('구 에이전트 협업 하니스는 제거되었다 — 상호 호출은 독립 실행의 ask_agent', () => {
  assert.doesNotMatch(renderer, /function buildAgentPrompt/);
  assert.doesNotMatch(renderer, /function agentHandoffProtocol/);
  assert.doesNotMatch(renderer, /function runAgentTurn/);
  assert.doesNotMatch(renderer, /TRIAD_HANDOFF/); // 폴백 마커 경로도 소멸
});