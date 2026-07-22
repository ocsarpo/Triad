const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('ask_agent MCP가 상대 AI 답변을 반환하고 공유 호출 한도를 적용한다', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'triad-broker-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const fake=path.join(directory,'fake-claude');
  fs.writeFileSync(fake,'#!/bin/sh\ncat >/dev/null\nprintf \'%s\\n\' \'{"type":"result","result":"보조 답변 완료"}\'\n');
  fs.chmodSync(fake,0o755);
  const statePath=path.join(directory,'state.json');const eventsPath=path.join(directory,'events.jsonl');const configPath=path.join(directory,'config.json');
  fs.writeFileSync(statePath,JSON.stringify({used:0,limit:1}));fs.writeFileSync(eventsPath,'');
  fs.writeFileSync(configPath,JSON.stringify({nodePath:process.execPath,brokerPath:path.join(__dirname,'../Resources/triad-mcp-server.cjs'),statePath,eventsPath,callLimit:1,maxDepth:2,timeoutMs:3000,agents:{codex:{},claude:{executablePath:fake,workspacePath:directory,model:'test',effort:'low',permissionMode:'acceptEdits'}}}));
  const child=spawn(process.execPath,[path.join(__dirname,'../Resources/triad-mcp-server.cjs'),'--config',configPath,'--caller','codex','--depth','0'],{stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill('SIGTERM'));
  let buffer='';const pending=new Map();
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split(/\r?\n/u);buffer=lines.pop();for(const line of lines){if(!line.trim())continue;const value=JSON.parse(line);pending.get(value.id)?.(value);pending.delete(value.id);}});
  const request=(id,method,params={})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`MCP 응답 시간 초과: ${method}`)),4000);pending.set(id,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);});
  const initialized=await request(1,'initialize',{protocolVersion:'2024-11-05'});assert.equal(initialized.result.serverInfo.name,'triad-agent-broker');
  const listed=await request(2,'tools/list');assert.equal(listed.result.tools[0].name,'ask_agent');
  const called=await request(3,'tools/call',{name:'ask_agent',arguments:{question:'확인해줘'}});assert.equal(called.result.isError,false);assert.match(called.result.content[0].text,/보조 답변 완료/);
  const limited=await request(4,'tools/call',{name:'ask_agent',arguments:{question:'한 번 더'}});assert.equal(limited.result.isError,true);assert.match(limited.result.content[0].text,/호출 한도/);
  const events=fs.readFileSync(eventsPath,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(event=>event.eventType),['agent_call_started','agent_call_completed']);
});
