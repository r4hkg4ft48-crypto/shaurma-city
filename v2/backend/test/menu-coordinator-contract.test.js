'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const D=require('../src/domain');
const read=x=>fs.readFileSync(path.join(__dirname,'..','..','..',x),'utf8');

test('Blocking an ingredient survives menu normalization and rejects checkout availability',()=>{
  const immutableId=JSON.stringify(['cheese-shawarma','ingredient','сыр моцарелла']);
  const first=D.normalizeMenu([{id:'cheese-shawarma',n:'Сырная шаурма',c:'shawarma_doner',p:330,composition:'сыр моцарелла',coordinator_blocked_ingredients:[immutableId]}])[0];
  assert.deepEqual(first.coordinator_blocked_ingredients,[immutableId]);
  assert.equal(D.menuItemAvailableNow(first),false,'stop-listed ingredient must make item unsellable');
  const second=D.normalizeMenu([first])[0];
  assert.equal(second.coordinator_blocked_ingredients[0],immutableId);
  const restored=D.normalizeMenu([{...first,coordinator_blocked_ingredients:[]}])[0];
  assert.equal(D.menuItemAvailableNow(restored),true);
});

test('Coordinator scope includes project-specific venue ID and code, not name only',()=>{
  const source=read('v2/backend/src/menu-coordinator.js');
  assert.match(source,/UNIQUE\(establishment_id,normalized_code\)/);
  assert.match(source,/PRIMARY KEY\(establishment_id,entity_type,entity_id\)/);
  assert.match(source,/WHERE establishment_id=\$1 AND normalized_code=\$2/);
  assert.match(source,/WHERE establishment_id=\$1 AND is_active=true FOR UPDATE/);
  assert.match(source,/SELECT.*FROM shaurma_coordinator_bindings/);
  assert.match(source,/authorizeBridge\(req\)/);
  assert.match(source,/forbidden|Нет прав на это заведение/);
});

test('Production entrypoint actually mounts the bot and coordinator',()=>{
  const source=read('backend/server.js');
  assert.match(source,/v2MenuCoordinator\.install\(app\)/);
  assert.match(source,/v2CoordinatorBot\.install\(app\)/);
  assert.match(source,/await v2MenuCoordinator\.ensureSchema\(\)/);
  assert.match(source,/v2CoordinatorBot\.sync\(\)/);
});

test('Bot requires private chat, signed webhook and Shaurmeg-only tenant scoping',()=>{
  const source=read('v2/backend/src/coordinator-bot.js');
  assert.match(source,/message\.chat\.type\)!=='private'/);
  assert.match(source,/x-telegram-bot-api-secret-token/);
  assert.match(source,/const linked=await coordinator\.binding\(uid\)/);
  assert.match(source,/if\(row\.project!=='shaurmeg'\)/);
  assert.doesNotMatch(source,/COORDINATOR_COFFEE_SECRET|coffeeResolve|kofeyok/i);
});

test('Admin and restaurant user share normalizer that honours stop-list',()=>{
  const routes=read('v2/backend/src/routes.js');
  assert.match(routes,/!D\.menuItemAvailableNow\(src/);
  const domain=read('v2/backend/src/domain.js');
  assert.match(domain,/coordinator_blocked_ingredients\.length>0/);
});


test('Create commands lock only the bound establishment and reject duplicate menu IDs',()=>{
  const source=read('v2/backend/src/menu-coordinator.js');
  assert.match(source,/createScopedMenuObject\(bind,telegramId,text\)/);
  assert.match(source,/SELECT menu,config,name FROM shaurma_venues WHERE establishment_id=\$1 AND is_active=true FOR UPDATE/);
  assert.match(source,/entity_type='category' AND normalized_code=\$2/);
  assert.match(source,/Дублирующийся внутренний ID/);
  assert.match(source,/добавить вариант/);
});
