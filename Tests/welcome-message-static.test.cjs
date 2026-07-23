const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const renderer=fs.readFileSync(path.join(__dirname,'../Resources/index.html'),'utf8');

test('환영 말풍선은 대화 생성 시 한 번만 seed하고 렌더 함수는 상태를 바꾸지 않는다',()=>{
  assert.match(renderer,/const createWelcomeMessage=\(\)=>\(\{id:id\(\),author:'system',text:welcomeText/);
  assert.match(renderer,/messages:\[createWelcomeMessage\(\)\],settings:clone\(state\.settings\)/);
  const render=renderer.slice(renderer.indexOf('function renderMessages'),renderer.indexOf('function renderLinkedText'));
  assert.doesNotMatch(render,/createWelcomeMessage\(/);
  assert.doesNotMatch(renderer,/function addWelcome\(/);
});

test('boot과 migration은 빈 대화를 seed하고 연속된 초기 환영문만 하나로 정리한다',()=>{
  assert.match(renderer,/function seedInitialWelcome\(messages=\[\]\)/);
  assert.match(renderer,/if\(!list\.length\)return \[createWelcomeMessage\(\)\]/);
  assert.match(renderer,/while\(repeated<list\.length&&isInitialWelcome\(list\[0\]\)&&isInitialWelcome\(list\[repeated\]\)\)repeated\+=1/);
  assert.match(renderer,/return repeated>1\?\[list\[0\],\.\.\.list\.slice\(repeated\)\]:list/);
  assert.match(renderer,/const messages=seedInitialWelcome\(withoutDeferred\)/);
  assert.match(renderer,/messages:clone\(seedInitialWelcome\(removeDeferredOrphans\(state\.messages\)\)\)/);
});

test('대화 비우기와 마지막 대화 삭제 뒤 생성도 환영문 하나를 명시적으로 남긴다',()=>{
  assert.match(renderer,/state\.messages=\[createWelcomeMessage\(\)\];save\(\);renderMessages\(\)/);
  assert.match(renderer,/else \{state\.activeConversationId=null;newConversation\(true\);\}/);
});
