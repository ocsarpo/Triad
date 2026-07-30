const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');

test('셸은 첨부 이미지를 codex는 -i, claude는 --add-dir+Read로 전달한다', () => {
  // request.images는 문자열 경로만 통과시킨다.
  assert.match(main, /const images = Array\.isArray\(request\.images\) \? request\.images\.filter\(\(p\) => typeof p === 'string' && p\) : \[\]/);
  // codex: 각 이미지를 -i로 붙이고 마지막에 stdin 마커 '-'.
  assert.match(main, /for \(const p of images\) args\.push\('-i', p\);[\s\S]*?args\.push\('-'\);/);
  // claude: 이미지가 있는 폴더마다 --add-dir 후 프롬프트에 Read 지시.
  assert.match(main, /for \(const dir of new Set\(images\.map\(\(p\) => path\.dirname\(p\)\)\)\) args\.push\('--add-dir', dir\);/);
  assert.match(main, /promptToSend = prompt \+ '\\n\\n\[첨부 이미지\]/);
  // stdin에는 (이미지 지시가 덧붙은) promptToSend를 쓴다.
  assert.match(main, /child\.stdin\.write\(promptToSend\)/);
});

test('셸은 이미지 선택 다이얼로그(chooseImages) 액션을 노출한다', () => {
  assert.match(main, /case 'chooseImages': return void chooseImages\(payload\)/);
  assert.match(main, /async function chooseImages\(payload\)/);
  assert.match(main, /filters: \[\{ name: M\('dlgImages'\), extensions: \[/);
  assert.match(main, /emit\(\{ type: 'images', paths: result\.filePaths \}\)/);
});

test('렌더러는 대기 이미지 상태와 첨부 UI를 갖는다', () => {
  assert.match(renderer, /pendingImages:\[\]/);
  assert.match(renderer, /id="attach-image"/);
  assert.match(renderer, /id="attach-strip"/);
  assert.match(renderer, /function renderAttachStrip\(\)/);
  assert.match(renderer, /function imageFileURL\(p\)/);
  // 이미지 선택 버튼은 chooseImages 액션을 post한다.
  assert.match(renderer, /post\(\{action:'chooseImages',workspace:effectiveWorkspacePath\('codex'\)\|\|''\}\)/);
  // 셸의 images 이벤트를 대기열에 누적한다.
  assert.match(renderer, /else if \(event\.type==='images'\)/);
  assert.match(renderer, /state\.pendingImages\.push\(p\)/);
});

test('이미지는 실행 페이로드로 흐르며 사용자 메시지 첨부로 저장된다', () => {
  // dispatchAgent 옵션 -> pending -> run 페이로드
  assert.match(renderer, /const images=Array\.isArray\(options\.images\)\?options\.images\.filter\(Boolean\):\[\]/);
  assert.match(renderer, /collaboration,images,bubbleMeta,fallbackContext:options\.fallbackContext\|\|'',reviewRequested:!!options\.reviewRequested,reviewSource:options\.reviewSource\|\|''\};/); // state.pending 항목
  assert.match(renderer, /sharedContext,session,runId,images\}\)/); // run 페이로드
  // send()에서 대기 이미지를 캡처하고 전송 후 비운다.
  assert.match(renderer, /const images=state\.pendingImages\.slice\(\)/);
  assert.match(renderer, /state\.pendingImages=\[\];renderAttachStrip\(\)/);
  // 사용자 말풍선 첨부 + 말풍선 썸네일 렌더
  assert.match(renderer, /addMessage\('user',original,false,\{deferred:queued,attachments:images\}\)/);
  assert.match(renderer, /Array\.isArray\(m\.attachments\)&&m\.attachments\.length/);
});

test('협업 흐름은 이미지를 flow에 실어 매 턴 두 AI에게 전달한다', () => {
  // startCollaboration이 images를 받아 orchestration에 저장
  assert.match(renderer, /function startCollaboration\(objective, runCollaboration=state\.collaboration, conversationId=state\.activeConversationId, settings=effectiveAgentConfigs\(\), referencePacket=\[\], images=\[\], review=false\)/);
  assert.match(renderer, /const flowImages=clone\(images\|\|\[\]\)/);
  assert.match(renderer, /images:flowImages,reviewRequested:!!review,crossContext\}/);
  // 협업(agent) + 대화(dialog) 턴 실행기가 flow.images를 dispatch에 넘긴다.
  const turnMatches = renderer.match(/collaboration:flow\.collaboration,images:flow\.images\|\|\[\]\}/g) || [];
  assert.equal(turnMatches.length, 2);
  // 대기열에도 이미지를 보존한다.
  assert.match(renderer, /images:clone\(options\.images\|\|\[\]\)/); // independentBatch
  assert.match(renderer, /images:clone\(images\|\|\[\]\),review:!!review,createdAt/); // collaboration
});
