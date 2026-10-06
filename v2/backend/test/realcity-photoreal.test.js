'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

require('../../frontend/realcity-photoreal-layer.js');
const R=globalThis.RealCityPhotorealLayer;

function rcs(points){
  const stride=20,b=Buffer.alloc(16+points.length*stride);
  b.write('RCS1',0,'ascii');b.writeUInt16LE(1,4);b.writeUInt16LE(stride,6);b.writeUInt32LE(points.length,8);b.writeUInt32LE(1,12);
  points.forEach((p,i)=>{
    const o=16+i*stride;
    b.writeFloatLE(p[0],o);b.writeFloatLE(p[1],o+4);b.writeFloatLE(p[2],o+8);
    b[o+12]=p[3];b[o+13]=p[4];b[o+14]=p[5];b[o+15]=255;b.writeFloatLE(p[6],o+16);
  });return b;
}

test('RCS1 parser preserves local geometry, source color and radius',()=>{
  const b=rcs([[1.25,-2.5,3.75,120,80,40,.14],[-5,4,1,10,220,90,.09]]);
  const data=R.parseRcs(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  assert.equal(data.count,2);assert.equal(data.sourceCount,2);
  assert.ok(Math.abs(data.positions[0]-1.25)<1e-6);
  assert.ok(Math.abs(data.positions[1]+2.5)<1e-6);
  assert.ok(Math.abs(data.colors[0]-120/255)<1e-6);
  assert.ok(Math.abs(data.radii[0]-.14)<1e-5);
});

test('RCS1 parser fails closed on malformed artifacts',()=>{
  assert.throws(()=>R.parseRcs(new Uint8Array([1,2,3,4]).buffer),/realcity_rcs_magic/);
  const b=rcs([[0,0,0,1,2,3,.1]]);b.writeUInt16LE(99,4);
  assert.throws(()=>R.parseRcs(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),/realcity_rcs_schema/);
});

test('RCS1 mobile sampling caps GPU point count deterministically',()=>{
  const pts=Array.from({length:1000},(_,i)=>[i*.01,0,1,100,120,140,.08]);
  const b=rcs(pts),data=R.parseRcs(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),100);
  assert.ok(data.count<=100);assert.equal(data.sourceCount,1000);
});
