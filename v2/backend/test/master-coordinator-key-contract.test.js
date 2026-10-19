'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../../..');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
const html=read('backend/master-admin.html');
const server=read('backend/server.js');
const coordinator=read('v2/backend/src/menu-coordinator.js');

test('Master Admin retains OWN keys and separately provides Shaurmeg coordinator keys',()=>{
 assert.match(html,/id="createKey"/);
 assert.match(html,/id="createCoordinatorKey"/);
 assert.match(html,/id="coordinatorKeyOutput"/);
 assert.match(html,/id="coordinatorKeyList"/);
 assert.match(html,/SHA-MNU/);
 assert.match(html,/\/api\/shaurma\/admin\/coordinator\/key/);
 assert.match(html,/\/api\/shaurma\/admin\/coordinator\/keys/);
 assert.match(html,/\/api\/shaurma\/admin\/coordinator\/revoke-key/);
});

test('Master Admin inline JavaScript compiles and controls secret visibility',()=>{
 const scripts=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
 for(const code of scripts)assert.doesNotThrow(()=>new vm.Script(code,{filename:'master-admin-inline.js'}));
 assert.match(html,/coordinatorSecretOnce=''/);
 assert.match(html,/\$\('#accessVenue'\)\.onchange/);
 assert.match(html,/\$\('#copyCoordinatorKey'\)\.hidden=true/);
});

test('Master routes require established ownerOk session and reuse the same coordinator key service',()=>{
 for(const route of ['key','keys','revoke-key']){
  const method=route==='keys'?'get':'post';
  const anchor=`app.${method}('/api/shaurma/admin/coordinator/${route}'`;
  const i=server.indexOf(anchor);
  assert.ok(i>0,`missing ${route} endpoint`);
  assert.match(server.slice(i,i+450),/if\(!ownerOk\(req\)\)return res\.status\(401\)/);
 }
 assert.match(server,/v2MenuCoordinator\.issueKey\(req\.body\?\.establishment_id/);
 assert.match(server,/v2MenuCoordinator\.keyStatus\(req\.query\?\.establishment_id/);
 assert.match(server,/v2MenuCoordinator\.revokeKey\(req\.body\?\.establishment_id/);
});

test('Keys are venue-scoped, secret never persisted in plaintext, and can be revoked',()=>{
 assert.match(coordinator,/async function issueKey\(establishmentId,hours=24\)/);
 assert.match(coordinator,/const est=D\.establishmentId\(establishmentId\)/);
 assert.match(coordinator,/SHA-MNU-/);
 assert.match(coordinator,/VALUES\(\$1,\$2,NOW\(\)/);
 assert.match(coordinator,/\[est,keyHash\(code\),String\(ttl\)\]/);
 assert.match(coordinator,/WHERE establishment_id=\$1 AND id=\$2 AND revoked_at IS NULL AND redeemed_at IS NULL/);
 assert.match(coordinator,/expires_at,redeemed_at,revoked_at,created_at/);
});
