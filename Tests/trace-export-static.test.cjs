const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('실행 과정 패널에 복사 버튼과 export/클립보드 배선이 있다', () => {
  assert.match(renderer, /id="copy-traces"/);
  assert.match(renderer, /function traceExportText\(\)/);
  assert.match(renderer, /function copyPlainText\(text, button\)/);
  // 토큰/캐시 요약을 export 텍스트 앞에 붙인다
  assert.match(renderer, /토큰\/캐시 요약/);
  // 복사 버튼이 traceExportText를 클립보드로 보낸다
  assert.match(renderer, /copyPlainText\(traceExportText\(\),b\)/);
  // 일반 텍스트 복사도 네이티브 클립보드 브리지의 onResult 경로를 탄다
  assert.match(renderer, /state\.clipboardRequests\[requestId\]=\{text,timer,onResult:done\}/);
  assert.match(renderer, /if\(request\.onResult\)\{/);
});
