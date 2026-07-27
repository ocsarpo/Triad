const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const i18nSource = fs.readFileSync(path.join(root, 'Resources/i18n.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'Resources/index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');

const ctx = {};
vm.runInNewContext(i18nSource, ctx);
const i18n = ctx.TriadI18n;

test('i18n 모듈은 chrome/translate/detect/aiDirective를 제공한다', () => {
  // 기본은 영어, ko면 원문(한국어) 유지
  assert.equal(i18n.chrome('en', '보내기'), 'Send');
  assert.equal(i18n.chrome('ko', '보내기'), '보내기');
  assert.equal(i18n.chrome('en', '실행 과정'), 'Run log');
  // 사전에 없는 문자열은 그대로 통과
  assert.equal(i18n.chrome('en', 'Triad'), 'Triad');
  // 보간 메시지
  assert.equal(i18n.translate('en', 'maxHandoff', { n: 3, agent: 'Codex' }),
    'Codex is wrapping up with the current information after reaching the max of 3 handoffs.');
  assert.match(i18n.translate('ko', 'sendPrepFailed', { detail: 'x' }), /전송을 준비하지 못했습니다/);
});

test('OS 로케일 감지는 ko만 한국어로, 나머지는 영어로 본다', () => {
  assert.equal(i18n.detect('ko-KR'), 'ko');
  assert.equal(i18n.detect('ko'), 'ko');
  assert.equal(i18n.detect('en-US'), 'en');
  assert.equal(i18n.detect('ja-JP'), 'en');
  assert.equal(i18n.detect(''), 'en');
});

test('AI 응답 언어 지시는 로케일에 따라 달라진다', () => {
  assert.match(i18n.aiDirective('en'), /English/);
  assert.match(i18n.aiDirective('ko'), /한국어/);
});

test('렌더러는 i18n을 로드하고 자동 감지 + 수동 토글로 언어를 정한다', () => {
  assert.match(renderer, /<script src="i18n\.js"><\/script>/);
  assert.match(renderer, /localePref: localStorage\.getItem\('triad\.locale'\)\|\|'auto'/);
  assert.match(renderer, /function effectiveLocale\(\)\{ const p=state\.localePref\|\|'auto'; return p==='auto'\?window\.TriadI18n\.detect\(navigator\.language\):p; \}/);
  assert.match(renderer, /function applyI18n\(root\)/);
  assert.match(renderer, /new MutationObserver\(\(\)=>scheduleI18n\(\)\)/);
  assert.match(renderer, /id="lang-select"/);
  assert.match(renderer, /function setLocalePref\(pref\)/);
  assert.match(renderer, /post\(\{action:'setLocale',locale:effectiveLocale\(\),pref:state\.localePref\}\)/);
  // 앱 메뉴에서 온 언어 변경을 처리한다
  assert.match(renderer, /event\.type==='setLocalePref'\) setLocalePref\(event\.pref\)/);
  assert.match(renderer, /startI18n\(\);/);
  // 콘텐츠(메시지·에이전트 출력·diff)는 스윕에서 제외한다
  assert.match(renderer, /const I18N_SKIP='\.messages,\.trace-list,\.diff-content,\.diff-file-list,\.autocomplete,\.markdown-table-wrap'/);
});

test('AI 응답은 UI 언어로 — dispatchAgent가 프롬프트 끝에 지시를 덧붙인다', () => {
  assert.match(renderer, /prompt = prompt \+ '\\n\\n' \+ window\.TriadI18n\.aiDirective\(effectiveLocale\(\)\)/);
});

test('보간 시스템 메시지는 L()로 감싼다', () => {
  assert.match(renderer, /textContent=L\('refMax3'\)/);
  assert.match(renderer, /addMessage\('system',flow\.mode==='debate'\?L\('debateDone'\):L\('reviewDone'\)\)/);
  assert.match(renderer, /L\('agentStart',\{lead:names\[collaboration\.lead\]\}\)/);
  assert.match(renderer, /L\('sendPrepFailed',\{detail\}\)/);
  assert.match(renderer, /L\('boardWriteFail',\{agent:names\[agent\]\|\|agent,phase:task\.phase\}\)/);
});

test('Phase 2: 설정·협업·상태 크롬이 사전에 있고 텍스트노드 스윕으로 번역된다', () => {
  // 설정 카드 라벨
  assert.equal(i18n.chrome('en', '세션 정책'), 'Session policy');
  assert.equal(i18n.chrome('en', '작업 권한'), 'Permissions');
  assert.equal(i18n.chrome('en', '언어 모델'), 'Language model');
  assert.equal(i18n.chrome('en', '자동 회전 (권장)'), 'Auto-rotate (recommended)');
  // 협업 컨트롤 라벨/상태
  assert.equal(i18n.chrome('en', '작업 시작'), 'Start work');
  assert.equal(i18n.chrome('en', '두 AI가 번갈아 토론'), 'The two AIs debate in turns');
  assert.equal(i18n.chrome('en', '제안 작성'), 'Draft proposal');
  // 계정 상태
  assert.equal(i18n.chrome('en', '연결 필요'), 'Not connected');
  // 보간 UI 문자열
  assert.match(i18n.translate('en', 'hintIndependent', { target: 'Both' }), /untagged goes to Both/);
  assert.equal(i18n.translate('en', 'queueWaiting', { who: 'Collaboration', pos: 2 }), 'Collaboration · waiting 2');
  // 스윕은 텍스트 노드 단위 (라벨이 자식 요소 옆에 있어도 잡힘)
  assert.match(renderer, /if\(node\.nodeType===3\)\{const raw=node\.nodeValue/);
});

test('Phase 2: 렌더러가 보간 UI를 L()/tc()로 감싼다', () => {
  assert.match(renderer, /return L\('sessionSummary',\{policy,turns:stats\.turns\|\|0,total:totalInput,context:contextInput,fresh\}\)/);
  assert.match(renderer, /L\('hintIndependent',\{target:defaultTargetLabel\(\)\}\)/);
  assert.match(renderer, /L\('queueIndependent',\{n:/);
  assert.match(renderer, /L\('docCurrent',\{title:documentTitleOf\(workDocument\)\}\)/);
  assert.match(renderer, /confirm\(L\('logoutConfirm',\{agent:names\[agent\]\}\)\)/);
  assert.match(renderer, /function tc\(ko\)\{ return window\.TriadI18n\.chrome\(effectiveLocale\(\),ko\); \}/);
});

test('셸(main)은 자체 메시지 테이블로 메뉴·다이얼로그·오류를 지역화한다', () => {
  assert.match(main, /const MAIN_MSG = \{/);
  assert.match(main, /function M\(key, params\)/);
  assert.match(main, /function detectLang\(locale\)/);
  assert.match(main, /appLang = detectLang\(app\.getLocale\(\)\)/);
  assert.match(main, /case 'setLocale': appLang = payload\.locale === 'ko' \? 'ko' : 'en'; if \(typeof payload\.pref === 'string'\) appLocalePref = payload\.pref; setupMenu\(\); return;/);
  assert.match(main, /label: M\('menuView'\)/);
  assert.match(main, /label: M\('menuTrace'\)/);
  // 상단 앱 메뉴의 언어 서브메뉴 (라디오 체크 = 현재 선택)
  assert.match(main, /label: M\('menuLanguage'\)/);
  assert.match(main, /label: M\('langAuto'\), type: 'radio', checked: appLocalePref === 'auto', click: \(\) => setLocaleFromMenu\('auto'\)/);
  assert.match(main, /label: 'English', type: 'radio', checked: appLocalePref === 'en'/);
  assert.match(main, /label: '한국어', type: 'radio', checked: appLocalePref === 'ko'/);
  assert.match(main, /function setLocaleFromMenu\(pref\)/);
  assert.match(main, /emit\(\{ type: 'setLocalePref', pref \}\)/);
  assert.match(main, /buttonLabel: M\('dlgSelect'\)/);
  assert.match(main, /message: M\('busy'\)/);
  assert.match(main, /message: M\('cliNotFound', \{ path: executable \|\| '' \}\)/);
});
