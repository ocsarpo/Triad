const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('실행 과정은 정렬 토글(최신순/시간순)을 가지며 기본은 최신순', () => {
  assert.match(renderer, /traceSort: localStorage\.getItem\('triad\.traceSort'\)\|\|'newest'/);
  assert.match(renderer, /id="trace-sort"/);
  // 기본(최신순)은 표시용으로만 뒤집고 저장은 시간순 유지 → 복사/내보내기 불변
  assert.match(renderer, /const newest=state\.traceSort!=='oldest'/);
  assert.match(renderer, /const items=newest\?filtered\.slice\(\)\.reverse\(\):filtered/);
  // 최신순이면 위로 스크롤, 시간순이면 아래로
  assert.match(renderer, /root\.scrollTop=newest\?0:root\.scrollHeight/);
  // 토글은 localStorage에 저장
  assert.match(renderer, /state\.traceSort=state\.traceSort==='oldest'\?'newest':'oldest';localStorage\.setItem\('triad\.traceSort',state\.traceSort\)/);
});

test('실행 과정 패널에 숨기기 버튼이 있고 보이기는 메뉴가 담당한다', () => {
  assert.match(renderer, /id="hide-traces"/);
  assert.match(renderer, /getElementById\('hide-traces'\);if\(b\)b\.onclick=\(\)=>\{state\.traceVisible=false;localStorage\.setItem\('triad\.traceVisible','false'\);renderTraceVisibility\(\);\}/);
});
