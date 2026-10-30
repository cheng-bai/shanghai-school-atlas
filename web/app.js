'use strict';
const DATA=window.SCHOOL_DATA,$=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=url=>/^https?:\/\//.test(url||'')?url:'';
let tab='nearby',explorerTab='nearby',visible=[],map=null,markers=null,circles=null,tiles=null,compareRows=[],schoolMarkers=new Map(),mapTimer=null;
let relationLayer=null,relationRenderer=null,relationLines=new Map(),selectedSchoolId=null,highlightedSchoolId=null,schoolCards=new Map(),mapRenderKey=null;
let mapBaseToken=null;
let manualMode=false,manualSchoolId=null,manualLine=null;
let reverseMode=false,reverseSchool=null,reverseSite=null,reverseFilterKey=null;
const reverseKey=f=>JSON.stringify([tab,f.campus,f.stage,f.district,f.nature,f.kind,f.quality,f.search]);
const schoolById=new Map([...DATA.schools,...(window.PRIORITY_SCHOOLS||[])].map(s=>[s.id,s]));
const campusById=new Map(DATA.campuses.map(c=>[c.id,c]));
function currentFilters(){return {campus:$('campus').value,radius:Number($('radius').value)*1000,stage:$('stage').value,district:$('district').value,nature:$('nature').value,kind:$('kind').value,quality:$('quality').value,search:$('search').value.trim().toLowerCase(),sort:$('sort').value}}
function nearest(s,campus){const entries=campus==='all'?Object.entries(s.distances):s.distances[campus]?[[campus,s.distances[campus]]]:[];if(!entries.length)return null;const [id,d]=entries.reduce((a,b)=>a[1].meters<=b[1].meters?a:b);return {...d,campus:campusById.get(id),site:s.sites.find(x=>x.id===d.siteId)}}
function matches(s,f){return (f.stage==='all'||s.stage===f.stage||(s.priorityStage&&s.priorityStage.includes('初高中')&&f.stage==='初中'))&&(f.district==='all'||s.district===f.district)&&(f.nature==='all'||s.nature===f.nature)&&(f.kind==='all'||(f.kind==='市实验'?s.type.startsWith(f.kind):s.type.includes(f.kind)))&&(f.quality==='all'||(f.quality==='located'?s.sites.length>0:!s.sites.length))&&(!f.search||[s.name,s.priority,...(s.aliases||[]),s.code,s.officialAddress?.address||'',...s.sites.map(x=>x.address||x.legacyAddress||'')].join(' ').toLowerCase().includes(f.search))}
function getViews(f=currentFilters(),mode=tab){const arr=(mode==='priority'?window.PRIORITY_SCHOOLS:DATA.schools).filter(s=>matches(s,f)).map(s=>({...s,nearest:nearest(s,f.campus)})).filter(s=>(mode!=='nearby'&&!(mode==='priority'&&f.campus!=='all'))||(s.nearest&&s.nearest.meters<=f.radius));arr.sort((a,b)=>f.sort==='name'?a.name.localeCompare(b.name,'zh-CN'):f.sort==='district'?a.district.localeCompare(b.district,'zh-CN')||a.name.localeCompare(b.name,'zh-CN'):(a.nearest?.meters??Infinity)-(b.nearest?.meters??Infinity)||a.name.localeCompare(b.name,'zh-CN'));return arr}
function formatDistance(m){return m==null?'待定位':m<1000?Math.round(m/10)*10+' m':(m/1000).toFixed(2)+' km'}
function setTab(name,keepFilters=false){if(name!==tab&&reverseMode)resetReverseState();if(name==='priority'&&!keepFilters&&tab!=='priority'){$('stage').value='all';$('showRelations').checked=false}tab=name;if(['nearby','registry','priority'].includes(name))explorerTab=name;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===name);b.setAttribute('aria-current',b.dataset.tab===name?'page':'false')});$('explorer').classList.toggle('hidden',!['nearby','registry','priority'].includes(name));$('comparePanel').classList.toggle('hidden',name!=='compare');$('sourcesPanel').classList.toggle('hidden',name!=='sources');$('insightsPanel').classList.toggle('hidden',name!=='insights');$('studentsPanel').classList.toggle('hidden',name!=='students');render();if(map)requestAnimationFrame(()=>map.invalidateSize())}
function render(){const f=currentFilters(),campus=DATA.campuses.find(c=>c.id===f.campus);if(reverseSchool&&reverseFilterKey!==reverseKey(f))resetReverseState();visible=getViews(f,['nearby','registry','priority'].includes(tab)?tab:explorerTab);$('radiusValue').textContent=f.radius/1000+' km';document.querySelectorAll('[data-radius]').forEach(b=>b.classList.toggle('chosen',Number(b.dataset.radius)===f.radius/1000));$('shareFilters').disabled=false;$('shareFilters').title='';$('headline').textContent=campus?campus.name+'周边':'27 个校区，连接上海学校';$('subtitle').textContent=tab==='priority'?(campus?'P级学校 · 当前校区 '+f.radius/1000+' km 直线范围':'P级原始名录 · 不受半径限制 · 校址均为参考'):tab==='registry'?'全量名录保留待定位学校；距离以当前所选校区计算。':`参考直线半径 ${f.radius/1000} km · ${f.stage==='all'?'高中与初中':f.stage} · 不等于步行距离`;
$('campusInfo').innerHTML=campus?'<b>'+esc(campus.district)+'</b>'+esc(campus.address)+'<br><small>地址与坐标沿用旧版 · '+DATA.meta.campusDate+'</small>':'<b>全部 27 个教学点</b>每所学校取距任一校区的最近校址；多校区覆盖去重统计。';$('totalHigh').textContent=DATA.meta.seniorCount;$('locatedHigh').textContent=DATA.meta.seniorLocated;$('missingHigh').textContent=DATA.meta.seniorUnlocated;$('resultCount').textContent=visible.length;$('resultLabel').textContent=explorerTab==='nearby'?'当前范围学校':'当前条件学校';$('resultMeta').textContent=`高中 ${visible.filter(s=>s.stage==='高中').length} / 初中 ${visible.filter(s=>s.stage==='初中').length}`;
const missing=(tab==='priority'?window.PRIORITY_SCHOOLS:DATA.schools).filter(s=>matches(s,{...f,quality:'all'})&&!s.sites.length).length;
$('notice').textContent=tab==='priority'?(campus?`${campus.name} · ${f.radius/1000} km 内有 ${visible.length} 条P级学校参考记录；另有 ${missing} 条待定位，不能判断距离。距离为直线参考。`:`P级原始名录 ${visible.length} 条，其中 ${visible.filter(s=>s.sites.length).length} 条有参考坐标，${missing} 条待定位；待定位学校仅显示在清单中，不能推测落点。部分学校有多个校址，地图暂显示距所选校区最近的一个。`):tab==='nearby'?`当前结果仅为有参考校址的学校。另有 ${missing} 所符合其他条件的学校待定位，无法判断是否在 ${f.radius/1000} km 内；半径边缘 ±200 m 请复核。`:tab==='registry'?'全量名录不受半径限制。招生归属不一定是校址所在区；市属学校统一保留“上海市”。':DATA.meta.locationNotice;
$('listTitle').textContent=(tab==='priority'?'P级名录':tab==='registry'?'名录':'附近学校')+' · '+visible.length;$('mapTitle').textContent=tab==='priority'?'P级学校参考位置':tab==='registry'?'每校最近参考校址':'当前范围位置';if(['nearby','registry','priority'].includes(tab)){renderList(f);renderMap()}if(tab==='compare')renderCompare(f);if(tab==='sources')renderSources();if(tab==='insights')renderInsights();}
function renderList(f){
  $('sort').parentElement.classList.remove('hidden');
  $('schoolList').innerHTML=visible.length?visible.map(s=>{const n=s.nearest,border=n&&Math.abs(n.meters-f.radius)<=200&&tab==='nearby';return `<article class="school-card" data-card="${esc(s.id)}"><button class="school-open" ${s.sites.length?'data-explore-school':'data-school'}="${esc(s.id)}" aria-label="${esc(s.name)}${s.sites.length?'，查看半径内新东方校区':'，查看资料'}"><div class="school-title"><h3>${esc(s.name)}</h3><span class="distance">${n?'<small>约 </small>':''}${formatDistance(n?.meters)}</span></div><div class="badges"><span class="badge">${esc(s.priorityStage||s.stage)}</span>${s.priority?'<span class="badge">'+esc(s.priority)+'</span>':''}<span class="badge ${s.nature==='民办'?'private':''}">${esc(s.nature)}</span><span class="badge ${!n?'missing':''}">${esc(n?s.type:'待定位')}</span>${border?'<span class="badge missing">范围边缘</span>':''}</div><p>${esc(n?.site.address||n?.site.legacyAddress||s.officialAddress?.address||(n?'地图未提供完整门牌地址':'保留在名录中，不判为范围外'))}</p><div class="school-meta">${esc(s.district)}${s.code?' · '+esc(s.code):''}${n?' · '+esc(n.campus.name):''}</div></button>${window.atlasStudents?.schoolBadge(s.id,f.campus)||''}<div class="school-actions">${n?`<button data-locate="${esc(s.id)}">地图定位 ↗</button>`:''}${s.sites.length?`<button data-reverse="${esc(s.id)}">附近校区 ↗</button>`:''}<button data-school="${esc(s.id)}">查看画像 →</button></div></article>`}).join(''):'<div class="empty"><b>当前条件没有可列出的学校</b>可扩大半径、调整筛选，或在全量名录查看待定位学校。这里的零不代表现实中没有学校。</div>';
  document.querySelectorAll('[data-school]').forEach(b=>b.addEventListener('click',()=>openSchool(b.dataset.school)));
  document.querySelectorAll('[data-locate]').forEach(b=>b.addEventListener('click',()=>locateSchool(b.dataset.locate)));
  document.querySelectorAll('[data-explore-school]').forEach(b=>b.addEventListener('click',()=>{selectReverseSchool(b.dataset.exploreSchool);if(!document.body.classList.contains('map-expanded'))$('map').scrollIntoView({behavior:'auto',block:'center'});}));
  document.querySelectorAll('[data-reverse]').forEach(b=>b.addEventListener('click',()=>{selectReverseSchool(b.dataset.reverse);if(!document.body.classList.contains('map-expanded'))$('map').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});}));
  schoolCards.clear();document.querySelectorAll('[data-card]').forEach(card=>{schoolCards.set(card.dataset.card,card);card.addEventListener('mouseenter',()=>highlightSchool(card.dataset.card));card.addEventListener('mouseleave',()=>highlightSchool(selectedSchoolId));card.addEventListener('focusin',()=>highlightSchool(card.dataset.card));card.addEventListener('focusout',event=>{if(!card.contains(event.relatedTarget))highlightSchool(selectedSchoolId)});});
}
function locateSchool(id){
  if(reverseMode){resetReverseState();renderMap();}
  const marker=schoolMarkers.get(id);if(!marker||!map)return;
  highlightSchool(id,true);
  const school=visible.find(s=>s.id===id),campus=school?.nearest?.campus;
  const points=[marker.getLatLng()];if(campus)points.push([campus.lat,campus.lon]);
  map.closePopup();map.fitBounds(points,{padding:[45,45],maxZoom:15});
  $('map').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
}
function focusImportedSchool(campusId,schoolId){
  const school=schoolById.get(schoolId);if(!school)return;
  $('campus').value=campusId;$('stage').value=school.stage;
  for(const id of ['district','nature','kind','quality'])$(id).value='all';
  $('search').value=school.code||school.name;
  setTab('registry');if(map)map.invalidateSize();locateSchool(schoolId);
}
function paintSchool(id,active){
  if(!id)return;
  const line=relationLines.get(id),marker=schoolMarkers.get(id),school=schoolById.get(id),card=schoolCards.get(id);
  if(line){line.setStyle({color:active?'#b76332':'#377e70',weight:active?3.5:1.5,opacity:active?.95:.35,dashArray:active?'7 5':'3 6'});line.getElement()?.classList.toggle('is-active',active);if(active)line.bringToFront()}
  if(marker&&school){marker.setRadius(active?9:school.stage==='高中'?6:4);marker.setStyle({weight:active?3:1.5})}
  card?.classList.toggle('is-linked',active);
}
function highlightSchool(id,lock=false){
  if(lock)selectedSchoolId=id;
  if(highlightedSchoolId!==id){paintSchool(highlightedSchoolId,false);paintSchool(id,true);highlightedSchoolId=id}
  const school=visible.find(s=>s.id===id),n=school?.nearest;
  $('relationTitle').textContent=n?n.campus.name+' ↔ '+school.name:'校区与周边学校，连成一张网';
  $('relationDescription').textContent=n?'约 '+formatDistance(n.meters)+' · 直线邻近关系，不代表学生来源或出行路线。':'点击学校查看所选半径内的新东方校区；悬停连线可查看距离。';
  $('clearRelation').classList.toggle('hidden',!selectedSchoolId);
}
function clearManualConnection(message='选学校，再选校区；仅作本次直线比较。'){
  if(manualLine&&map)map.removeLayer(manualLine);
  manualLine=null;manualSchoolId=null;$('clearManual').classList.add('hidden');
  $('manualConnectStatus').textContent=message;
}
function setManualMode(active){
  if(active&&reverseMode)stopReverse();
  manualMode=active;document.body.classList.toggle('manual-mode',active);clearManualConnection(active?'请点击地图上的学校圆点，再点击校区菱形。':'选学校，再选校区；仅作本次直线比较。');
  $('manualConnect').setAttribute('aria-pressed',String(active));
  $('manualConnect').textContent=active?'结束自选连线':'＋ 自选校区连线';
  mapRenderKey=null;renderMap();
}
function manualSelectSchool(school){
  if(manualLine){map.removeLayer(manualLine);manualLine=null;}
  manualSchoolId=school.id;$('clearManual').classList.remove('hidden');
  $('manualConnectStatus').textContent='已选 '+school.name+'；请点击一个校区菱形。';
  highlightSchool(school.id,true);map.closePopup();
}
function manualSelectCampus(campus){
  const school=visible.find(s=>s.id===manualSchoolId),site=school?.nearest?.site;
  if(!site){$('manualConnectStatus').textContent='请先点击一个有坐标的学校圆点。';return;}
  if(manualLine)map.removeLayer(manualLine);
  const a=L.latLng(site.lat,site.lon),b=L.latLng(campus.lat,campus.lon);
  manualLine=L.polyline([a,b],{color:'#b75929',weight:4,opacity:.95,dashArray:'8 5'}).addTo(map);
  $('manualConnectStatus').textContent=school.name+' ↔ '+campus.name+' · 约 '+formatDistance(a.distanceTo(b))+'（直线参考，非学生来源）';
  $('clearManual').classList.remove('hidden');map.closePopup();
}
$('manualConnect').addEventListener('click',()=>setManualMode(!manualMode));
$('clearManual').addEventListener('click',()=>clearManualConnection(manualMode?'已清除；请重新点击学校圆点。':undefined));
function resetReverseState(){
  reverseMode=false;reverseSchool=null;reverseSite=null;reverseFilterKey=null;document.body.classList.remove('reverse-mode');
  $('reverseMode').setAttribute('aria-pressed','false');$('reverseMode').textContent='⌖ 以学校找校区';
  $('reverseExit').classList.add('hidden');$('reverseStatus').textContent='先选择学校，查看周边校区。';$('reverseResults').innerHTML='';
  $('reverseControls').classList.add('hidden');
  mapRenderKey=null;
}
function stopReverse(){resetReverseState();render();}
function selectReverseSchool(id,siteId){
  const school=visible.find(s=>s.id===id)||schoolById.get(id);if(!school||!school.sites.length)return;
  if(!map){$('mapStatus').textContent='地图组件不可用，暂不能计算校区距离；请重新加载页面。';return;}
  if(manualMode)setManualMode(false);
  reverseSchool=school;reverseSite=school.sites.find(s=>s.id===siteId)||school.nearest?.site||nearest(school,$('campus').value)?.site||school.sites[0];reverseMode=true;reverseFilterKey=reverseKey(currentFilters());
  map.closePopup();
  $('reverseSite').innerHTML=school.sites.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.address||s.legacyAddress||s.name||'参考校址')+'</option>').join('');
  $('reverseSite').value=reverseSite.id;
  $('reverseSite').parentElement.classList.toggle('hidden',school.sites.length<2);
  $('reverseControls').classList.remove('hidden');
  document.body.classList.add('reverse-mode');$('reverseMode').setAttribute('aria-pressed','true');$('reverseMode').textContent='换一所学校';$('reverseExit').classList.remove('hidden');
  renderReverse();
}
function focusNearbyCampus(id){
  const c=campusById.get(id);if(!map||!reverseSite||!c)return;
  const meters=map.distance([reverseSite.lat,reverseSite.lon],[c.lat,c.lon]);
  map.panTo([c.lat,c.lon],{animate:false});
  L.popup().setLatLng([c.lat,c.lon]).setContent('<b>'+esc(c.name)+'</b><p>'+esc(c.address)+'</p><p>距所选学校参考校址约 '+formatDistance(meters)+'（直线）</p><small>校区地址沿用 '+esc(DATA.meta.campusDate)+' 原资料，请核实营业状态。</small>').openOn(map);
}
function renderReverse(){
  if(!map||!reverseSchool||!reverseSite)return;
  const center=L.latLng(reverseSite.lat,reverseSite.lon),radius=currentFilters().radius;
  const nearby=DATA.campuses.map(c=>({campus:c,meters:center.distanceTo([c.lat,c.lon])})).filter(x=>x.meters<=radius).sort((a,b)=>a.meters-b.meters);
  markers.clearLayers();circles.clearLayers();relationLayer.clearLayers();schoolMarkers.clear();relationLines.clear();
  L.circleMarker(center,{radius:9,color:'#176752',fillColor:'#388764',fillOpacity:1,weight:3}).bindTooltip(esc(reverseSchool.name),{permanent:true,direction:'top'}).on('click',()=>openSchool(reverseSchool.id)).addTo(markers);
  if($('showRadius').checked)L.circle(center,{radius,color:'#346b51',weight:2,fillOpacity:.06}).addTo(circles);
  for(const {campus:c,meters} of nearby){
    L.marker([c.lat,c.lon],{title:c.name+' · '+formatDistance(meters),alt:c.name,icon:L.divIcon({className:'',html:'<div class="campus-dot active"></div>',iconSize:[23,23],iconAnchor:[11,11]})}).bindTooltip(esc(c.name)+' · '+formatDistance(meters)).on('click',()=>focusNearbyCampus(c.id)).addTo(markers);
    L.polyline([center,[c.lat,c.lon]],{renderer:relationRenderer,color:'#b76332',weight:2,opacity:.7,dashArray:'5 5'}).addTo(relationLayer);
  }
  $('showRelations').checked?map.addLayer(relationLayer):map.removeLayer(relationLayer);map.addLayer(circles);
  $('reverseStatus').textContent=reverseSchool.name+' · '+(reverseSite.address||reverseSite.legacyAddress||'地图参考校址')+' · '+radius/1000+' km 内 '+nearby.length+' 个校区（直线参考，非学生来源）';
  $('reverseRadius').value=radius/1000;
  $('reverseResults').innerHTML='<button type="button" class="text-button" id="reverseProfile">查看 '+esc(reverseSchool.name)+' 的学校介绍</button>'+(nearby.length?nearby.map(({campus:c,meters})=>'<button type="button" class="reverse-campus" data-campus-focus="'+esc(c.id)+'">'+esc(c.name)+' · '+formatDistance(meters)+'</button>').join(''):'<span>当前半径内没有参考校区，可扩大半径。</span>');
  $('reverseProfile').onclick=()=>openSchool(reverseSchool.id);
  $('mapTitle').textContent=reverseSchool.name+'周边 · '+radius/1000+' km';
  $('headline').textContent=reverseSchool.name+'周边的新东方校区';
  $('subtitle').textContent='以所选学校校址为中心 · 参考直线半径 '+radius/1000+' km';
  $('notice').textContent='当前从全部 '+DATA.campuses.length+' 个新东方校区中按半径查找，不受原校区筛选限制。仅显示已有参考坐标，直线距离不代表出行路线；半径边缘 ±200 m 请复核。';
  $('listTitle').textContent='附近新东方校区 · '+nearby.length;
  $('resultLabel').textContent='学校周边新东方校区';$('resultCount').textContent=nearby.length;$('resultMeta').textContent='半径 '+radius/1000+' km · 全部校区中查找';
  $('sort').parentElement.classList.add('hidden');
  $('schoolList').innerHTML=nearby.length?nearby.map(({campus:c,meters})=>'<article class="school-card"><button class="school-open" data-campus-focus="'+esc(c.id)+'"><div class="school-title"><h3>'+esc(c.name)+'</h3><span class="distance">约 '+formatDistance(meters)+'</span></div><p>'+esc(c.address)+'</p><div class="school-meta">'+esc(c.district)+' · 点击地图定位</div></button></article>').join(''):'<div class="empty"><b>当前半径内没有参考校区</b>可调整半径继续查找；这不代表现实中没有新东方教学点。</div>';
  document.querySelectorAll('[data-campus-focus]').forEach(b=>b.onclick=()=>focusNearbyCampus(b.dataset.campusFocus));
  $('relationCount').textContent=nearby.length+' 条';map.fitBounds(center.toBounds(radius*2),{padding:[25,25],maxZoom:15});
}
$('reverseMode').addEventListener('click',()=>{
  if(reverseSchool){resetReverseState();render();reverseMode=true;document.body.classList.add('reverse-mode');}
  else if(!reverseMode){if(manualMode)setManualMode(false);reverseMode=true;document.body.classList.add('reverse-mode');}
  else {stopReverse();return;}
  $('reverseMode').setAttribute('aria-pressed','true');$('reverseMode').textContent='取消选学校';$('reverseExit').classList.remove('hidden');$('reverseStatus').textContent='请点击地图中的学校圆点，或在学校列表点击“附近校区”。';$('reverseResults').innerHTML='';
});
$('reverseExit').addEventListener('click',stopReverse);
$('reverseSite').addEventListener('change',()=>selectReverseSchool(reverseSchool.id,$('reverseSite').value));
$('reverseRadius').addEventListener('change',()=>{
  const value=Number($('reverseRadius').value);
  if(!$('reverseRadius').value.trim()||!Number.isFinite(value)||value<1||value>20){$('reverseRadius').reportValidity();$('reverseRadius').value=currentFilters().radius/1000;return;}
  clearTimeout(filterTimer);$('radius').value=String(Math.round(value*10)/10);render();
});
function setMapFullscreen(open){
  document.body.classList.toggle('map-expanded',open);
  const button=$('mapFullscreen');
  button.setAttribute('aria-pressed',String(open));
  button.setAttribute('aria-label',open?'退出全屏地图':'全屏查看地图');
  button.querySelector('span').textContent=open?'退出全屏':'全屏地图';
  requestAnimationFrame(()=>map?.invalidateSize());
}
$('mapFullscreen').addEventListener('click',()=>setMapFullscreen(!document.body.classList.contains('map-expanded')));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.body.classList.contains('map-expanded')&&!document.querySelector('dialog[open]')){
    setMapFullscreen(false);$('mapFullscreen').focus();
  }
});
function initMap(){
  if(typeof L==='undefined'){$('mapStatus').textContent='本地地图组件缺失，学校清单仍可使用。';return}
  // A rectangular navigation envelope includes Chongming and Shanghai's coastal edges.
  const shanghaiBounds=L.latLngBounds([30.65,120.85],[31.90,122.15]);
  // Fractional zoom and a larger wheel distance prevent small trackpad gestures jumping whole levels.
  map=L.map('map',{preferCanvas:true,zoomAnimation:false,fadeAnimation:false,zoomSnap:.25,zoomDelta:.5,wheelPxPerZoomLevel:240,wheelDebounceTime:80,maxZoom:19,maxBounds:shanghaiBounds,maxBoundsViscosity:1}).setView([31.22,121.47],11);
  const constrainZoom=()=>map.setMinZoom(Math.min(19,Math.max(9,map.getBoundsZoom(shanghaiBounds,true))));
  map.on('resize',constrainZoom);constrainZoom();
  L.control.scale({imperial:false,maxWidth:120}).addTo(map);
  map.createPane('relationPane');map.getPane('relationPane').style.zIndex=410;
  relationRenderer=L.svg({pane:'relationPane'});
  relationLayer=L.layerGroup().addTo(map);markers=L.layerGroup().addTo(map);circles=L.layerGroup().addTo(map);
  map.attributionControl.addAttribution('校址参考 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> / 原项目');
}
function renderMap(){
  if(!map)return;
  if(reverseSchool){renderReverse();return;}
  const f=currentFilters();
  const key=JSON.stringify([explorerTab,f.campus,f.radius,f.stage,f.district,f.nature,f.kind,f.quality,f.search]);
  if(key===mapRenderKey){paintSchool(highlightedSchoolId,true);return}
  mapRenderKey=key;
  markers.clearLayers();circles.clearLayers();schoolMarkers.clear();relationLayer.clearLayers();relationLines.clear();highlightedSchoolId=null;
  if(!visible.some(s=>s.id===selectedSchoolId))selectedSchoolId=null;
  if(manualSchoolId)clearManualConnection(manualMode?'筛选已变化，请重新选择学校和校区。':undefined);
  const campuses=manualMode||f.campus==='all'?DATA.campuses:DATA.campuses.filter(c=>c.id===f.campus);
  for(const c of campuses){
    const campusMarker=L.marker([c.lat,c.lon],{title:c.name,alt:c.name,icon:L.divIcon({className:'',html:'<div class="campus-dot '+(f.campus!=='all'?'active':'')+'"></div>',iconSize:[23,23],iconAnchor:[11,11]})}).bindTooltip(c.name).addTo(markers);
    campusMarker.on('click',()=>{if(manualMode){manualSelectCampus(c);return} $('campus').value=c.id;setTab(explorerTab==='priority'?'priority':'nearby',true)});
    if(explorerTab==='nearby'||(explorerTab==='priority'&&f.campus!=='all'))L.circle([c.lat,c.lon],{radius:f.radius,color:'#346b51',weight:1,fillOpacity:.035}).addTo(circles);
  }
  for(const school of visible){
    const n=school.nearest,site=n?.site;if(!site)continue;
    const line=L.polyline([[n.campus.lat,n.campus.lon],[site.lat,site.lon]],{renderer:relationRenderer,color:'#377e70',weight:1.5,opacity:.35,dashArray:'3 6',className:'school-relation'}).addTo(relationLayer);
    line.bindTooltip(esc(n.campus.name)+' ↔ '+esc(school.name)+'<br>参考直线距离约 '+formatDistance(n.meters));
    line.on('mouseover',()=>highlightSchool(school.id)).on('mouseout',()=>highlightSchool(selectedSchoolId)).on('click',()=>locateSchool(school.id));
    // 宽而连续的透明命中层，手机不必精确点中虚线笔画。
    const hit=L.polyline([[n.campus.lat,n.campus.lon],[site.lat,site.lon]],{renderer:relationRenderer,color:'#377e70',weight:18,opacity:0,className:'school-relation-hit'});
    hit.bindTooltip(esc(n.campus.name)+' ↔ '+esc(school.name)+'<br>参考直线距离约 '+formatDistance(n.meters));
    hit.on('mouseover',()=>highlightSchool(school.id)).on('mouseout',()=>highlightSchool(selectedSchoolId)).on('click',()=>locateSchool(school.id));
    hit.on('add',()=>{const el=hit.getElement();if(el){el.setAttribute('tabindex','0');el.setAttribute('role','button');el.setAttribute('aria-label','查看'+n.campus.name+'与'+school.name+'的直线关系');el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();locateSchool(school.id)}})}});
    hit.addTo(relationLayer);
    relationLines.set(school.id,line);
    const marker=L.circleMarker([site.lat,site.lon],{radius:school.stage==='高中'?6:4,weight:1.5,color:school.nature==='民办'?'#a56129':'#176752',fillColor:school.nature==='民办'?'#dba663':'#388764',fillOpacity:school.stage==='高中'?.9:.2}).bindTooltip((school.priority?school.priority+' · ':'')+school.name);
    marker.on('click',()=>{if(manualMode)manualSelectSchool(school);else selectReverseSchool(school.id)}).on('mouseover',()=>{if(!manualMode)highlightSchool(school.id)}).on('mouseout',()=>{if(!manualMode)highlightSchool(selectedSchoolId)}).addTo(markers);schoolMarkers.set(school.id,marker);
  }
  $('relationCount').textContent=relationLines.size+' 条';
  $('showRelations').checked?map.addLayer(relationLayer):map.removeLayer(relationLayer);
  highlightSchool(selectedSchoolId);fitMap();
}
function fitMap(){if(!map)return;const f=currentFilters();if(f.campus!=='all'&&(tab==='nearby'||tab==='priority')){const c=DATA.campuses.find(c=>c.id===f.campus);map.fitBounds(L.latLng(c.lat,c.lon).toBounds(f.radius*2),{padding:[20,20],maxZoom:15})}else{const points=[...visible.filter(s=>s.nearest).map(s=>[s.nearest.site.lat,s.nearest.site.lon]),...DATA.campuses.filter(c=>f.campus==='all'||f.campus===c.id).map(c=>[c.lat,c.lon])];if(points.length)map.fitBounds(points,{padding:[25,25],maxZoom:13})}}
async function changeBase(){
  if(!map)return;
  mapBaseToken=null;
  clearTimeout(mapTimer);
  if(tiles){map.removeLayer(tiles);tiles=null}
  const choice=$('baseMap').value;
  $('highResolution').disabled=choice!=='osm';
  if(choice==='offline'){$('mapStatus').textContent='点位模式：不含道路；校区和学校位置仍可查看。';return}
  if(choice==='local'){
    const token={};mapBaseToken=token;
    $('mapStatus').textContent='正在加载上海概览底图，学校点位可先使用…';
    try{
      const data=await AtlasLocalMap.load();
      if(mapBaseToken!==token||$('baseMap').value!=='local')return;
      const layer=AtlasLocalMap.create(data, message=>{if(tiles===layer)$('mapStatus').textContent=message});
      tiles=layer;layer.addTo(map);
    }catch(error){
      if(mapBaseToken===token)$('mapStatus').textContent='自带底图文件未能加载，请点击重新加载；学校点位仍可使用。';
    }
    return;
  }
  if(location.protocol==='file:'){$('baseMap').value='local';changeBase();return}
  const sources={
    osm:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
  };
  const source=sources[choice],layer=L.tileLayer(source.url,{maxZoom:19,attribution:source.attribution,detectRetina:$('highResolution').checked,updateWhenZooming:false,keepBuffer:1});
  tiles=layer;let loaded=0,failed=0;
  $('mapStatus').textContent='正在加载地图；如果道路未出现，可重新加载或切换点位模式。';
  layer.on('tileload',()=>{if(tiles!==layer)return;loaded++;$('mapStatus').textContent=failed?'部分地图加载失败；可重新加载或切换底图。':$('highResolution').checked&&L.Browser.retina?'OpenStreetMap 高清模式；网慢可关闭“高分屏高清”。若道路未显示请切换点位模式。':'地图来自 OpenStreetMap；若道路未显示，请切换点位模式。'});
  const fallback=()=>{if(tiles!==layer)return;$('baseMap').value='local';changeBase()};
  layer.on('tileerror',()=>{if(tiles!==layer)return;failed++;if(failed>=3)fallback();else $('mapStatus').textContent='在线底图加载失败，正在尝试；可切回自带上海底图。'});
  mapTimer=setTimeout(()=>{if(tiles===layer&&!loaded)fallback()},12000);
  layer.addTo(map);
}
function researchedIntroduction(school){
  const record=(window.PRIORITY_SCHOOLS||[]).find(s=>s.id===school.id||(school.code&&s.code===school.code)||s.name===school.name);
  const intro=window.P0_INTRODUCTIONS?.[record?.id];
  if(!intro)return '';
  const sources=(intro.sources||[]).filter(s=>safeLink(s.url));
  return '<section class="school-introduction"><h3>学校介绍 · 公开来源核对</h3><p>'+esc(intro.intro)+'</p>'+(intro.highlights?.length?'<ul>'+intro.highlights.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>':'')+'<p class="intro-provenance">'+esc(intro.status)+' · 查阅日期：'+esc(intro.verifiedAt)+' · P0 为本项目收集优先级，不是官方学校评级。</p>'+(intro.note?'<p class="intro-provenance">'+esc(intro.note)+'</p>':'')+'<div class="intro-sources">'+sources.map(s=>'<a target="_blank" rel="noreferrer" href="'+esc(s.url)+'">'+esc(s.title)+' · '+esc(s.publisher||'公开来源')+' · '+esc(s.published||'未标注发布日期')+' ↗</a>').join('')+'</div></section>';
}
function historicalProfile(id){
 const profile=window.SCHOOL_PROFILES?.[id];
 if(!profile)return '<h3>历史学校画像</h3><p>原交付包没有这所学校的可匹配画像，暂不推测办学特色、人数或升学情况。</p>';
 const rows=[['开设年级',profile.grades],['原资料介绍',profile.officialIntro],['2026 招生计划（原资料）',profile.admissionPlan2026],['学生人数（原资料）',profile.studentCount],['班级数量（原资料）',profile.classCount],['数据说明',profile.countsStatus]].filter(([,v])=>v!==''&&v!=null);
 const links=[['原资料来源',profile.primarySource],['录取数据来源',profile.examSource]].filter(([,v])=>safeLink(v)).map(([label,url])=>'<a target="_blank" rel="noreferrer" href="'+esc(url)+'">'+label+' ↗</a>').join('　');
 return '<h3>历史学校画像 · 2026</h3><p>沿用 2026-08-13 原交付资料，未逐条重新核验；校区设置、计划与学校现状请以官方信息为准。</p><dl class="detail-grid">'+rows.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>'+(profile.metricValue?'<div class="site-item"><b>'+esc(profile.metricName||'历史录取数据')+'</b><p>'+esc(profile.metricValue)+' · '+esc(profile.metricDenominator||'记录数未标注')+'</p><small>公布日期：'+esc(profile.metricPublished||'未标注')+'；录取分数分布不等于升学率、统一招生线或学校排名。</small></div>':'')+(links?'<p>'+links+'</p>':'');
}
function openSchool(id){highlightSchool(id,true);const s=schoolById.get(id),n=nearest(s,$('campus').value);const source=safeLink(s.source);$('detailBody').innerHTML=`<h2>${esc(s.name)}</h2><div class="badges"><span class="badge">${esc(s.priority||s.identityStatus||'原名录')}</span><span class="badge">${esc(s.nature)}</span><span class="badge">${esc(s.type)}</span></div>${researchedIntroduction(s)}<dl class="detail-grid"><dt>招生代码</dt><dd>${esc(s.code||(s.priority?'原名录未提供':'初中附加数据'))}</dd><dt>招生归属</dt><dd>${esc(s.district)}（不等于校址所在区）</dd><dt>名单备注</dt><dd>${esc(s.note||'无')}</dd><dt>参考距离</dt><dd>${n?'约 '+formatDistance(n.meters)+' · '+esc(n.campus.name):'待定位，无法判断是否在校区附近'}</dd><dt>名单来源</dt><dd>${source?'<a target="_blank" rel="noreferrer" href="'+esc(source)+(s.page?'#page='+s.page:'')+'">查看原始来源'+(s.page?' · 第'+s.page+'页':'')+' ↗</a>':esc(s.prioritySource||'旧版资料')}</dd></dl>${s.locationReview?'<h3>联网核对说明 · 2026-10-29</h3><p>'+esc(s.locationReview)+(s.priorityStageRaw?' 原名录学段：'+esc(s.priorityStageRaw)+'；当前按已核实的'+esc(s.stage)+'呈现。':'')+'</p>':''}${s.officialAddress?'<h3>公开来源的学校地址</h3><p>'+esc(s.officialAddress.address)+'</p><a target="_blank" rel="noreferrer" href="'+esc(s.officialAddress.source)+'">地址来源 · '+s.officialAddress.date+' ↗</a>':''}${s.identityNote?'<p>'+esc(s.identityNote.note)+' <a target="_blank" rel="noreferrer" href="'+esc(s.identityNote.source)+'">更名与迁址来源 ↗</a></p>':''}<h3>参考校址 · ${s.sites.length} 处</h3>${s.sites.length?s.sites.map(site=>`<div class="site-item"><b>${esc(site.name||'参考校址')}</b><p>${esc(site.address||site.legacyAddress||'原地图未提供完整门牌地址')}</p><small>${esc(site.status)} · ${esc(site.match)}<br>${site.lat.toFixed(6)}, ${site.lon.toFixed(6)} · ${esc(site.coordinateSystem)}</small><p>${esc(site.note)}</p>${safeLink(site.source)?'<a target="_blank" rel="noreferrer" href="'+esc(site.source)+'">核对地图来源 ↗</a>':'<small>来源：原项目校址记录</small>'}</div>`).join(''):'<p>暂无足够可靠的校址匹配。不使用同名初中、其他分校或区中心点代替。</p>'}${historicalProfile(s.id)}<h3>历史录取信号</h3><p>${esc(s.legacySignal?.value||'没有可靠逐校信号')}</p><p>${esc(s.legacySignal?.note||'没有数据时保持空白。')}${s.legacySignal?.date?' 资料保留日期：'+s.legacySignal.date:''}</p>${safeLink(s.legacySignal?.source)?'<a target="_blank" rel="noreferrer" href="'+esc(s.legacySignal.source)+'">历史记录来源 ↗</a>':''}<h3>使用边界</h3><p>名额分配到校分数不等于升学率。地图中心点、旧版坐标及多校址选择会影响距离；学校迁址和在用校区需向学校确认。本工具不生成未经证实的学生人数、成绩或学校排名。</p>`;$('detail').showModal();}
function insightText(){
 const f=currentFilters(),campus=DATA.campuses.find(c=>c.id===f.campus);
 return `${campus?campus.name:'全部校区'} · ${explorerTab==='nearby'?f.radius/1000+' km 直线范围':'全量名录筛选，不限半径'} · 当前 ${visible.length} 条学校记录`;
}
function renderInsights(){
 $('insightScope').textContent=insightText();
 const group=(key,title)=>{const counts=new Map();for(const s of visible){const label=s[key]||'未标注';counts.set(label,(counts.get(label)||0)+1)}return '<article class="insight-card"><h3>'+title+'</h3>'+([...counts].sort((a,b)=>b[1]-a[1]).map(([label,n])=>'<div class="insight-row"><span>'+esc(label)+'</span><b>'+n+'</b><div class="mini-bar" style="width:'+n/Math.max(visible.length,1)*100+'%"></div></div>').join('')||'<p>当前没有学校记录</p>')+'</article>'};
 const f=currentFilters(),missing=DATA.schools.filter(s=>matches(s,{...f,quality:'all'})&&!s.sites.length).length;
 $('insightContent').innerHTML=group('stage','学段结构')+group('nature','办学性质')+group('type','学校类型')+'<article class="insight-card"><h3>资料边界</h3><p>当前清单 '+visible.length+' 条，其中 '+visible.filter(s=>s.sites.length).length+' 条有参考校址。</p><p>符合其他条件但尚未定位的学校：'+missing+' 条。不能将它们判为范围外。</p><p>全量名录按招生记录统计；同址不同招生代码不合并。当前结果不能推算学生人数、升学率或市场份额。</p></article>';
}
async function copyInsights(){
 const text='请基于以下上海学校研究快照做校区周边教学调研。只引用给定证据，不推测学生人数、升学率或学校排名。区分初高中、公民办、学校类型及资料缺口，给出需要进一步核对的问题。\n'+insightText()+'\n资料日期：'+DATA.meta.researchedAt+'；距离为直线距离，未逐校复核。\n'+JSON.stringify(visible.map(s=>({学校:s.name,学段:s.stage,办别:s.nature,类型:s.type,参考距离米:s.nearest?.meters??null,校址状态:s.locationStatus,来源:s.source})),null,2);
 try{await navigator.clipboard.writeText(text);$('insightFallback').classList.add('hidden');$('insightStatus').textContent='分析提示词已复制。未向任何 AI 服务发送数据。'}catch{$('insightFallback').classList.remove('hidden');$('insightFallback').value=text;$('insightFallback').select();$('insightStatus').textContent='请从文本框手动复制。未向任何 AI 服务发送数据。'}
}
function renderCompare(f){const schools=DATA.schools.filter(s=>matches(s,f));compareRows=DATA.campuses.map(c=>{const inRange=schools.filter(s=>s.distances[c.id]?.meters<=f.radius);return {campus:c,count:inRange.length,high:inRange.filter(s=>s.stage==='高中').length,junior:inRange.filter(s=>s.stage==='初中').length,public:inRange.filter(s=>s.nature==='公办').length,private:inRange.filter(s=>s.nature==='民办').length,missing:schools.filter(s=>!s.sites.length).length}}).sort((a,b)=>b.count-a.count);const max=Math.max(...compareRows.map(r=>r.count),1);$('compareTable').innerHTML='<table><thead><tr><th>校区 / 沿用地址</th><th>范围内学校</th><th>高中</th><th>初中</th><th>公办</th><th>民办</th></tr></thead><tbody>'+compareRows.map(r=>`<tr><td><button data-campus-link="${r.campus.id}">${esc(r.campus.name)} ↗</button><p style="font-size:10px;color:var(--muted)">${esc(r.campus.district)}</p></td><td><b>${r.count}</b><div class="mini-bar" style="width:${r.count/max*100}%"></div></td><td>${r.high}</td><td>${r.junior}</td><td>${r.public}</td><td>${r.private}</td></tr>`).join('')+'</tbody></table>';document.querySelectorAll('[data-campus-link]').forEach(b=>b.onclick=()=>{$('campus').value=b.dataset.campusLink;setTab('nearby')})}
function renderSources(){$('sourceCards').innerHTML=DATA.meta.sources.map((s,i)=>`<article class="source-card"><span class="eyebrow">0${i+1} / ${esc(s.type)}</span><h3>${esc(s.title)}</h3><p>资料日期：${s.date}</p>${safeLink(s.url)?'<a href="'+esc(s.url)+'" target="_blank" rel="noreferrer">查看来源 ↗</a>':'<p>原始交付包保留不变</p>'}</article>`).join('');$('methodology').innerHTML=[DATA.meta.scope,DATA.meta.locationNotice,DATA.meta.distanceMethod,`高中 ${DATA.meta.seniorCount} 条中，${DATA.meta.seniorLocated} 条有参考校址，${DATA.meta.seniorUnlocated} 条待定位。初中仅保留旧版 ${DATA.meta.juniorCount} 所附加数据，不声称覆盖全市。`,'新东方校区沿用用户提供的27个教学点，来源为2026-08-13原项目；本次未重新核查营业状态和地址变更。','全量名录中的招生归属可能与实际校址区不同。一个招生代码一条记录；同址不同招生代码仍独立显示，校区之间覆盖数量不能直接相加。','新高中位置使用OpenStreetMap（ODbL）数据，属于非官方地理参考；地图中心点不能代表校门。未匹配记录不参与覆盖判断。'].map(t=>'<p>'+esc(t)+'</p>').join('')}
function csvCell(value){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function downloadCSV(rows,name){const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportSchools(){if(reverseSchool){const center=L.latLng(reverseSite.lat,reverseSite.lon);downloadCSV([['学校','参考校址','半径米','新东方校区','校区地址','参考直线距离米','校区资料日期'],...DATA.campuses.map(c=>({c,meters:center.distanceTo([c.lat,c.lon])})).filter(x=>x.meters<=currentFilters().radius).sort((a,b)=>a.meters-b.meters).map(({c,meters})=>[reverseSchool.name,reverseSite.address||reverseSite.legacyAddress||'',currentFilters().radius,c.name,c.address,Math.round(meters),DATA.meta.campusDate])],'学校周边新东方校区.csv');return;}downloadCSV([['视图','招生代码','学校','学段','招生归属','办别','官方类型','参考距离米','最近新东方校区','参考地址','定位状态','名单来源'],...visible.map(s=>[explorerTab==='priority'?'P级名录 '+s.priority:explorerTab==='nearby'?'范围内参考结果':'名录筛选',s.code,s.name,s.priorityStage||s.stage,s.district,s.nature,s.type,s.nearest?.meters??'',s.nearest?.campus.name||'',s.nearest?.site.address||s.nearest?.site.legacyAddress||s.officialAddress?.address||'',s.locationStatus,s.source])],'学校清单_'+explorerTab+'_20260916.csv')}
function showMissing(){$('stage').value='高中';$('quality').value='missing';$('search').value='';$('district').value='all';$('nature').value='all';$('kind').value='all';setTab('registry')}
$('campus').innerHTML='<option value="all">全部27个校区 · 学校去重</option>'+DATA.campuses.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');$('district').innerHTML+=[...new Set(DATA.schools.map(s=>s.district))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(d=>'<option>'+esc(d)+'</option>').join('');
for(const id of ['campus','stage','district','nature','kind','quality','sort'])$(id).addEventListener('change',render);let filterTimer=null;
function queueFilter(delay){clearTimeout(filterTimer);filterTimer=setTimeout(()=>{filterTimer=null;render()},delay)}
$('radius').addEventListener('input',()=>{$('radiusValue').textContent=Number($('radius').value)+' km';$('reverseRadius').value=$('radius').value;queueFilter(120)});
$('radius').addEventListener('change',()=>{clearTimeout(filterTimer);filterTimer=null;render()});
$('search').addEventListener('input',()=>queueFilter(180));document.querySelectorAll('[data-radius]').forEach(b=>b.onclick=()=>{$('radius').value=b.dataset.radius;render()});document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));$('sourcesTop').onclick=()=>setTab('sources');$('missingMetric').onclick=showMissing;$('showMissing').onclick=showMissing;$('reset').onclick=()=>{resetReverseState();for(const id of ['campus','district','nature','kind','quality'])$(id).value='all';$('stage').value='高中';$('radius').value='3';$('search').value='';$('sort').value='distance';setTab('nearby')};$('closeDetail').onclick=()=>$('detail').close();$('detail').addEventListener('click',e=>{if(e.target===$('detail')){const r=$('detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detail').close()}});$('baseMap').onchange=changeBase;$('retryMap').onclick=changeBase;$('highResolution').onchange=changeBase;$('showRelations').onchange=()=>{if(!map)return;$('showRelations').checked?map.addLayer(relationLayer):map.removeLayer(relationLayer)};$('clearRelation').onclick=()=>{selectedSchoolId=null;highlightSchool(null)};$('showRadius').onchange=()=>{if(!map)return;if(reverseSchool){renderReverse();return;}$('showRadius').checked?map.addLayer(circles):map.removeLayer(circles)};$('copyInsights').onclick=copyInsights;$('fitMap').onclick=()=>reverseSchool?renderReverse():fitMap();$('export').onclick=exportSchools;$('exportCompare').onclick=()=>downloadCSV([['校区','地址','半径米','符合条件学校','高中','初中','公办','民办','符合条件但未定位（无法判断距离）'],...compareRows.map(r=>[r.campus.name,r.campus.address,currentFilters().radius,r.count,r.high,r.junior,r.public,r.private,r.missing])],'校区比较_20260916.csv');$('copySummary').onclick=async()=>{const text=JSON.stringify({视图:explorerTab==='nearby'?'所选半径内参考结果':'全量名录筛选（不受半径限制）',口径:DATA.meta.scope,定位限制:DATA.meta.locationNotice,筛选:currentFilters(),学校数:visible.length,学校明细:visible.map(s=>({学校:s.name,学段:s.stage,类型:s.type,距离米:s.nearest?.meters??null,校区:s.nearest?.campus.name||null,校址状态:s.locationStatus,来源:s.source})),要求:'只基于这些记录分析；未定位学校不等于范围外；不得推测升学率、人数或学校排名。'},null,2);try{await navigator.clipboard.writeText(text);$('copyStatus').textContent='研究摘要已复制，包含全部当前结果。'}catch{$('summaryFallback').classList.remove('hidden');$('summaryFallback').value=text;$('summaryFallback').select();$('copyStatus').textContent='浏览器未允许复制，请从文本框手动复制。'}};
initMap();render();changeBase();window.atlas={getViews,currentFilters,nearest,setTab,DATA,getView:()=>({tab,explorerTab}),refresh:render,focusSchool:focusImportedSchool,exploreSchool:selectReverseSchool,getReverse:()=>({schoolId:reverseSchool?.id,siteId:reverseSite?.id}),getRelations:()=>({count:relationLines.size,visible:!!map?.hasLayer(relationLayer),selectedSchoolId,edges:[...relationLines].map(([schoolId,line])=>({schoolId,points:line.getLatLngs().map(p=>[p.lat,p.lng])}))}),downloadCSV};
