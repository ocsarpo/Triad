const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../Resources/version.js'),'utf8'),context);const {isNewer}=context.TriadVersion;
test('GitHub 태그가 현재 앱보다 높은지 비교한다',()=>{assert.equal(isNewer('v0.37.0','0.36.0'),true);assert.equal(isNewer('0.36.0','0.36.0'),false);assert.equal(isNewer('v0.35.9','0.36.0'),false);});
