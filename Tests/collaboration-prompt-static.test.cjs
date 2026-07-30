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

test('buildAgentPrompt은 안정 콘텐츠를 volatile 보드 스냅샷 앞에 둔다', () => {
  const block = renderer.slice(
    renderer.indexOf('function buildAgentPrompt'),
    renderer.indexOf('function runAgentTurn')
  );
  assert.ok(block.indexOf('사용자의 원래 작업') >= 0 && block.indexOf('공유 보드 스냅샷') >= 0);
  // 스냅샷은 별도 const로 준비되지만, 최종 프롬프트 템플릿에서는 안정 콘텐츠
  // (작업·역할·정책) 뒤에 ${snapshot}으로 삽입되어야 캐시 prefix가 유지된다.
  assert.match(block, /사용자의 원래 작업:[^`]*전체 채팅 기록은 제공되지 않습니다[^`]*\$\{snapshot\}/);
  // 빈 보드면 스냅샷 블록 대신 짧은 안내 한 줄
  assert.match(block, /const snapshot=boardIndex\?/);
});
