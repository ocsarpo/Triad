const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/file-search.js'), 'utf8'), context);
const search = context.TriadFileSearch;

const catalogs = [
  { agent:'codex', workspace:'/repo', files:[{path:'src/OrderService.kt',status:'M'},{path:'README.md',status:''}] },
  { agent:'claude', workspace:'/repo', files:[{path:'src/OrderService.kt',status:'M'}] },
  { agent:'claude', workspace:'/other', files:[{path:'docs/order-plan.md',status:''}] }
];

test('같은 절대 경로는 합치고 AI 배지를 모두 보존한다', () => {
  const item=search.itemsFor(catalogs).find(value=>value.name==='OrderService.kt');
  assert.deepEqual(JSON.parse(JSON.stringify(item.agents)),['codex','claude']);
});

test('파일명 시작 일치를 경로 중간 일치보다 우선한다', () => {
  const results=search.search('order',catalogs);
  assert.equal(results[0].name,'OrderService.kt');
  assert.equal(results[1].name,'order-plan.md');
});

test('빈 검색에서는 변경 파일을 먼저 보여준다', () => {
  assert.equal(search.search('',catalogs)[0].status,'M');
});
