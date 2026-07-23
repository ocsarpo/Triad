const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '../Native/main.m'), 'utf8');

test('각 말풍선은 렌더링 결과가 아닌 저장된 원문을 전체 복사한다', () => {
  assert.match(renderer, /copy.className='bubble-copy'/);
  assert.match(renderer, /copyMessageText\(m\.id,String\(m\.text\|\|''\)\)/);
  assert.match(renderer, /마크다운과 줄바꿈을 포함한 원문 전체 복사/);
  assert.match(renderer, /copy\.addEventListener\('click',event=>\{event\.preventDefault\(\);event\.stopPropagation\(\);/);
});

test('클립보드는 native bridge를 우선하고 WKWebView 외 환경에서는 fallback을 사용한다', () => {
  assert.match(renderer, /post\(\{action:'copyText',requestId,text\}\)/);
  assert.match(renderer, /navigator\.clipboard\?\.writeText/);
  assert.match(renderer, /document\.execCommand\('copy'\)/);
  assert.match(renderer, /event\.type==='clipboardResult'/);
  assert.match(native, /\[action isEqualToString:@"copyText"\]/);
  assert.match(native, /NSPasteboard\.generalPasteboard/);
  assert.match(native, /@"type": @"clipboardResult"/);
});

test('복사 결과는 성공·실패를 버튼에 명확하게 표시한다', () => {
  assert.match(renderer, /setCopyFeedback\(messageId,\{label:'복사됨'/);
  assert.match(renderer, /setCopyFeedback\(messageId,\{label:'복사 실패'/);
  assert.match(renderer, /delete state\.copyFeedback\[messageId\];renderMessages\(\)/);
});

test('스트리밍 재렌더 뒤에도 messageId 기반 복사 피드백을 이어간다', () => {
  assert.match(renderer, /clipboardRequests:\{\}, copyFeedback:\{\}/);
  assert.match(renderer, /state\.clipboardRequests\[requestId\]=\{messageId,text,timer\}/);
  assert.match(renderer, /function applyCopyFeedback\(button, messageId, hasText\)/);
  assert.match(renderer, /const feedback=state\.copyFeedback\[messageId\]/);
  assert.match(renderer, /applyCopyFeedback\(copy,m\.id,String\(m\.text\|\|''\)\.length>0\)/);
});

test('말풍선 복사 배포 버전을 올린다', () => {
  const plist = fs.readFileSync(path.join(__dirname, '../Resources/Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.40\.5<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>55<\/string>/);
});
