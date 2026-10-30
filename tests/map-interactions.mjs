// Run a local web server, then: ego-browser nodejs < tests/map-interactions.mjs
// ATLAS_TEST_URL can point to the deployed website instead.
const assert = (await import('node:assert/strict')).default;
const t = await taskSpace('Atlas interaction regression ' + Date.now());
const p = t.page('p1');
try {
  await p.goto(process.env.ATLAS_TEST_URL || 'http://127.0.0.1:18823/');
  await p.waitForSelector('canvas[data-zoom-ready="true"]', {timeout:30000});
  const id = await p.evaluate(() => visible.find(s => s.sites.length).id);
  await p.click('[data-explore-school="' + id + '"]');
  const checkRange = async () => {
    const state = await p.evaluate(() => {
      // Independent haversine calculation, rather than Leaflet's distance method.
      const rad = x => x * Math.PI / 180;
      const expected = DATA.campuses.map(c => {
        const dlat = rad(c.lat - reverseSite.lat), dlon = rad(c.lon - reverseSite.lon);
        const a = Math.sin(dlat/2)**2 + Math.cos(rad(reverseSite.lat)) * Math.cos(rad(c.lat)) * Math.sin(dlon/2)**2;
        return {id:c.id, meters:6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))};
      }).filter(c => c.meters <= currentFilters().radius).sort((a,b) => a.meters-b.meters).map(c => c.id);
      return {
        expected, actual:[...document.querySelectorAll('#schoolList [data-campus-focus]')].map(b => b.dataset.campusFocus),
        count:Number($('resultCount').textContent), school:reverseSchool.id,
        radius:currentFilters().radius, input:Number($('reverseRadius').value),
        site:reverseSite.id, share:window.atlas.shareURL()
      };
    });
    assert.deepEqual(state.actual, state.expected);
    assert.equal(state.count, state.expected.length);
    assert.equal(state.input * 1000, state.radius);
    return state;
  };
  await checkRange();
  console.log('school-click pass');
  await p.fill('#reverseRadius', '1.1');
  await p.press('#reverseRadius', 'Tab');
  assert.equal((await checkRange()).radius, 1100);
  assert.equal((await checkRange()).school, id);
  console.log('radius pass');
  const shared = (await checkRange()).share;
  await p.goto(shared);
  await p.waitForSelector('#reverseControls:not(.hidden)');
  assert.equal((await checkRange()).school, id);
  assert.equal((await checkRange()).radius, 1100);

  console.log('share pass');
  // A multi-site school must keep the radius while changing the calculation origin.
  await p.evaluate(() => { window.atlas.setTab('priority'); window.atlas.exploreSchool('P012'); });
  const sites = await p.evaluate(() => [...$('reverseSite').options].map(o => o.value));
  assert.ok(sites.length > 1);
  await p.selectOption('#reverseSite', sites[1]);
  assert.equal((await checkRange()).site, sites[1]);
  assert.equal((await checkRange()).radius, 1100);

  console.log('multi-site pass');
  // Full-screen users must still have both a radius control and a campus list.
  await p.click('#mapFullscreen');
  await p.evaluate(() => { $('radius').value = '10'; render(); });
  await checkRange();
  assert.ok(await p.evaluate(() => document.querySelectorAll('#reverseResults .reverse-campus').length > 0));
  await p.evaluate(() => { map.setView([31.22,121.47],12,{animate:false}); });
  const point = await p.evaluate(() => { const r=$('map').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; });
  await p.cdp('Input.dispatchMouseEvent', {type:'mouseWheel', ...point, deltaX:0, deltaY:-20});
  await p.waitForFunction(() => map.getZoom() > 12);
  assert.equal(await p.evaluate(() => map.getZoom()), 12.25);
  await p.cdp('Input.dispatchMouseEvent', {type:'mouseWheel', ...point, deltaX:0, deltaY:20});
  await p.waitForFunction(() => map.getZoom() === 12);
  await p.click('#mapFullscreen');

  console.log('wheel pass');
  await p.evaluate(() => { $('reverseExit').scrollIntoView({block:'center'}); });
  await p.click('#reverseExit');
  assert.equal(await p.evaluate(() => reverseSchool), null);
  await p.click('#reset');
  assert.equal(await p.evaluate(() => currentFilters().radius), 3000);
  await p.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  console.log('PASS: school click, independent radius counts, 0.1 km precision, share restore, multi-site switch, full-screen results, fractional wheel zoom, 390px layout, return/reset.');
} finally {
  await t.finish({keep:[]});
}
