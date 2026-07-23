const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('렌더러는 세션 정책·자동 회전·대화별 stats migration을 포함한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /sessionPolicy:'auto', sessionTurnLimit:6, sessionTokenLimit:48000/);
  assert.match(renderer, /collaboration: \{mode:'independent',lead:'codex',rounds:2/);
  assert.match(renderer, /window\.TriadSessionBudget\.shouldRotate\(config,state\.sessionStats\[agent\],!!session\)/);
  assert.match(renderer, /sessionStats:clone\(state\.sessionStats\)/);
  assert.match(renderer, /normalizeSessionStats\(conversation\.sessionStats\|\|\{\}\)/);
  assert.match(renderer, /recordCompletion\(state\.sessionStats,agent/);
});

test('패키저는 세션 예산 모듈을 앱 리소스로 복사한다', () => {
  const packager = fs.readFileSync(path.join(__dirname, '../scripts/package-app.sh'), 'utf8');
  assert.match(packager, /Resources\/session-budget\.js/);
});
