const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('렌더러는 세션 정책·자동 회전·대화별 stats migration을 포함한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /sessionPolicy:'auto', sessionTurnLimit:50, sessionTokenLimit:170000/);
  // 옛 기본값(6/48k)에 머문 설정만 새 기본값으로 끌어올리는 마이그레이션 배선
  assert.match(renderer, /const LEGACY_SESSION_DEFAULTS=\{sessionTurnLimit:6,sessionTokenLimit:48000\}/);
  assert.match(renderer, /function liftLegacySessionDefaults\(config\)/);
  assert.match(renderer, /normalizeSessionSettings\(liftLegacySessionDefaults\(\{\.\.\.base\.codex/);
  assert.match(renderer, /state\.settings\.codex=liftLegacySessionDefaults\(state\.settings\.codex\)/);
  assert.match(renderer, /collaboration: \{mode:'independent',lead:'codex',rounds:2/);
  assert.match(renderer, /window\.TriadSessionBudget\.shouldRotate\(config,state\.sessionStats\[agent\],!!session\)/);
  assert.match(renderer, /현재 문맥 \$\{Math\.round\(stats\.lastInputTokens\/1000\)\}k/);
  assert.match(renderer, /누적 입력 \$\{totalInput\}k · 현재 문맥 \$\{contextInput\}k/);
  assert.match(renderer, /<label>현재 문맥 기준<\/label><input data-key="sessionTokenLimit"/);
  assert.match(renderer, /function ensureAgentSessionStats\(agent\)/);
  assert.match(renderer, /const stats=ensureAgentSessionStats\('codex'\)/);
  assert.match(renderer, /자동 회전 · 기존 세션 사용량 미측정/);
  assert.match(renderer, /sessionStats:clone\(state\.sessionStats\)/);
  assert.match(renderer, /normalizeSessionStats\(conversation\.sessionStats\|\|\{\}\)/);
  assert.match(renderer, /normalizeStats\(value,state\.sessions\)/);
  assert.match(renderer, /recordCompletion\(state\.sessionStats,agent/);
  assert.match(renderer, /addTrace\('system','error','전송 준비 실패',detail\)/);
  assert.match(renderer, /공유 문서를 준비하지 못했습니다/);
});

test('README은 문맥 기준과 과금 추정의 차이를 명시한다', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  assert.match(readme, /직전 요청에서 측정된 현재 문맥 170,000토큰/);
  assert.match(readme, /문맥 측정용이며 과금 추정이 아닙니다/);
  assert.match(readme, /전송 미리보기의 토큰 수는 UTF-8 문자 특성을 반영한 보수적 \*\*추정치\*\*/);
  assert.match(readme, /세션의 현재 문맥·누적 입력은 CLI 사용량 이벤트 기반 논리 토큰/);
  assert.match(readme, /실제 청구 토큰 또는 과금액과는 다를 수 있습니다/);
});

test('패키저는 세션 예산 모듈을 앱 리소스로 복사한다', () => {
  const packager = fs.readFileSync(path.join(__dirname, '../scripts/package-app.sh'), 'utf8');
  assert.match(packager, /Resources\/session-budget\.js/);
});
