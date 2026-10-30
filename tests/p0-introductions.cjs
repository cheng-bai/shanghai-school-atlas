'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context={window:{}};
vm.createContext(context);
for(const name of ['priority-data.js','p0-introductions.js'])vm.runInContext(fs.readFileSync(path.join(root,'web',name),'utf8'),context);
const schools=context.window.PRIORITY_SCHOOLS.filter(s=>s.priority==='P0');
const intros=context.window.P0_INTRODUCTIONS;
assert.deepEqual(Object.keys(intros).sort(),Array.from(schools,s=>s.id).sort());
const statuses={},urls=new Set();
for(const school of schools){
  const intro=intros[school.id];
  assert.equal(intro.name,school.name,school.id+' identity mismatch');
  assert.ok(intro.intro.length>20&&intro.intro.length<400);
  assert.equal(intro.verifiedAt,'2026-10-30');
  assert.ok(intro.note&&intro.status&&intro.sources.length);
  for(const source of intro.sources){
    const url=new URL(source.url);assert.ok(['https:','http:'].includes(url.protocol));
    assert.ok(source.title&&source.publisher&&source.accessNote);
    assert.equal(source.accessed,intro.verifiedAt);urls.add(source.url);
  }
  statuses[intro.status]=(statuses[intro.status]||0)+1;
}
assert.match(intros.P015.status,/待/);
assert.match(intros.P021.note,/2019/);
console.log(JSON.stringify({schools:schools.length,sourceURLs:urls.size,statuses}));
