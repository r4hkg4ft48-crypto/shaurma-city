'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {parseRequest,matchFavorites}=require('../src/quick-order-core');
const dish={item_id:'flat_cheese',name:'Лепёшка с сыром',detail:'Сыр, соус',venue_name:'В Лепёшке'};
test('orders saved cheese flatbread in Russian declensions',()=>{
 const q=parseRequest('Закажи лепешку с сыром');
 assert.deepEqual(q.terms,['лепешк','сыр']);
 const matched=matchFavorites(q,[dish,{item_id:'soup',name:'Суп',detail:'без сыра'}]);
 assert.equal(matched.length,1);assert.equal(matched[0].item_id,'flat_cheese');
});
test('quantity is extracted and constrained to prevent accidental bulk purchase',()=>{
 assert.equal(parseRequest('Закажи две лепёшки с сыром').quantity,2);
 assert.equal(parseRequest('Закажи 3 лепёшки с сыром').quantity,3);
 assert.equal(parseRequest('Закажи 99 лепёшек').error,'invalid_quantity');
});
test('arbitrary chat text does not create a purchase intent',()=>{
 assert.equal(parseRequest('Какие есть лепёшки с сыром?'),null);
});
test('ambiguous favorite across establishments is not automatically chosen',()=>{
 const matches=matchFavorites(parseRequest('Закажи лепёшку с сыром'),[dish,{...dish,item_id:'other',venue_name:'Другое кафе'}]);
 assert.equal(matches.length,2);
});
test('no substring match when only one of two ingredients matches',()=>{
 const matches=matchFavorites(parseRequest('Закажи лепёшку с сыром'),[{name:'Лепёшка с курицей',detail:'курица'}]);
 assert.equal(matches.length,0);
});

test('venue name in a command selects the exact favorite venue',()=>{
 const choices=[
  {...dish,venue_name:'В Лепёшке',item_id:'lepyoshka'},
  {...dish,venue_name:'Другая точка',item_id:'another'}
 ];
 const found=matchFavorites(parseRequest('Закажи лепёшку с сыром в Лепёшке'),choices);
 assert.equal(found.length,1);
 assert.equal(found[0].item_id,'lepyoshka');
});
