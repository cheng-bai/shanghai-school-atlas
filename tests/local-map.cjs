'use strict';
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const context={window:{}, Math, Promise, console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'web/basemap/shanghai.js'),'utf8'),context);
// Expose the decoder only in this test harness; the published API stays small.
vm.runInContext(fs.readFileSync(path.join(root,'web/local-map.js'),'utf8').replace('return {load, create};','return {load, create, decode};'),context);
const data=context.window.SHANGHAI_BASEMAP;
assert.equal(data.meta.coordinates,'WGS84');assert.equal(data.meta.license,'ODbL-1.0');
let points=0,rings=0;
for(const f of data.features){
  assert.ok(f[0]>=0&&f[0]<=6);assert.ok(f[2]<data.names.length);
  const geometry=context.window.AtlasLocalMap.decode(f);
  const paths=f[0]===4?geometry:[geometry];
  for(const ring of paths){
    assert.ok(ring.length>0);rings++;
    for(const [x,y] of ring){
      const lon=x*360-180,lat=Math.atan(Math.sinh((.5-y)*2*Math.PI))*180/Math.PI;
      assert.ok(Number.isFinite(lon)&&Number.isFinite(lat));
      assert.ok(lon>=f[3]-.000011&&lon<=f[5]+.000011);
      assert.ok(lat>=f[4]-.000011&&lat<=f[6]+.000011);points++;
    }
  }
}
assert.ok(data.features.length>100000);assert.ok(rings>data.features.length);
console.log(JSON.stringify({features:data.features.length,points,rings,license:data.meta.license,coordinateBounds:'all pass within 1e-5 degree rounding'}));
