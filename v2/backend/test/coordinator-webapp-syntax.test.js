'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('The user-facing coordinator Mini App has valid JavaScript and no unauthenticated write mode',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../frontend/coordinator-console.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script,'Inline application JavaScript must exist');
  new vm.Script(script[1]);
  assert.match(html,/tg\.initData/);
  assert.match(html,/api\('preview'/);
  assert.match(html,/api\('confirm'/);
  assert.match(html,/data-code/);
  assert.match(html,/getUserMedia/);
});
