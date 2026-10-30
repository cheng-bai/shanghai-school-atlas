'use strict';
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const context={window:{}, Math, Promise, console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'web/basemap/manifest.js'),'utf8'),context);
const data=context.window.SHANGHAI_BASEMAP;
for(const part of data.parts){
  vm.runInContext(fs.readFileSync(path.join(root,'web/basemap',part.file),'utf8'),context);
  const features=context.window.ATLAS_BASEMAP_PARTS[part.zoom];
  assert.equal(features.length,part.features);
  for(const feature of features){assert.equal(Math.max(10,feature[1]),part.zoom);data.features.push(feature);}
}
data.features.sort((a,b)=>a[8]-b[8]);
data.features.forEach((f,i)=>assert.equal(f[8],i));
const compare=process.argv.find(arg=>arg.startsWith('--compare='));
if(compare){
  const text=require('node:child_process').execFileSync('git',['show',compare.slice(10)+':web/basemap/shanghai.js'],{cwd:root,maxBuffer:20*1024*1024,encoding:'utf8'});
  const old=JSON.parse(text.slice('window.SHANGHAI_BASEMAP='.length,-2));
  assert.equal(JSON.stringify(data.features.map(f=>f.slice(0,8))),JSON.stringify(old.features));
  assert.equal(JSON.stringify(data.names),JSON.stringify(old.names));
  assert.equal(JSON.stringify(data.meta),JSON.stringify(old.meta));
  console.log('Lossless package comparison: all geometry, names, order and metadata match '+compare.slice(10));
}
// Expose the decoder only in this test harness; the published API stays small.
vm.runInContext(fs.readFileSync(path.join(root,'web/local-map.js'),'utf8').replace('return {load, create};','return {load, create, decode};'),context);
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
