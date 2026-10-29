'use strict';
(() => {
  const atlas = window.atlas;
  const fieldIds = ['campus', 'radius', 'stage', 'district', 'nature', 'kind', 'quality', 'sort', 'search'];
  const toggles = ['showRelations', 'showRadius'];
  const views = ['nearby', 'registry', 'priority', 'compare', 'sources', 'insights', 'students'];
  const element = id => document.getElementById(id);

  function shareURL() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    for (const id of fieldIds) url.searchParams.set(id, element(id).value);
    for (const id of toggles) url.searchParams.set(id, element(id).checked ? '1' : '0');
    const view = atlas.getView();
    url.searchParams.set('view', view.tab);
    url.searchParams.set('explorer', view.explorerTab);
    return url.href;
  }

  function restoreFilters() {
    const params = new URLSearchParams(window.location.search);
    for (const id of fieldIds) {
      if (!params.has(id)) continue;
      const input = element(id);
      const value = params.get(id);
      if (id === 'radius') {
        const radius = Number(value);
        if (value.trim() && Number.isFinite(radius) && radius >= 1 && radius <= 20) {
          input.value = String(Math.round(radius * 2) / 2);
        }
      } else if (id === 'search') {
        input.value = value;
      } else if ([...input.options].some(option => option.value === value)) {
        input.value = value;
      }
    }
    for (const id of toggles) {
      if (!params.has(id)) continue;
      element(id).checked = params.get(id) !== '0';
      element(id).dispatchEvent(new Event('change'));
    }
    // Preserve the list context when sharing a comparison or sources view.
    const explorer = params.get('explorer');
    if (['nearby', 'registry', 'priority'].includes(explorer)) atlas.setTab(explorer, true);
    const view = params.get('view');
    atlas.setTab(views.includes(view) ? view : 'nearby', true);
  }

  element('shareFilters').addEventListener('click', async () => {
    const url = shareURL();
    const fallback = element('shareFallback');
    const localNotice = location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
      ? '当前为本机地址，链接无法直接在他人设备打开。' : '';
    fallback.classList.add('hidden');
    try {
      await navigator.clipboard.writeText(url);
      element('shareStatus').textContent = '当前筛选链接已复制；打开链接会恢复筛选条件和视图。' + localNotice;
    } catch {
      fallback.value = url;
      fallback.classList.remove('hidden');
      fallback.focus();
      fallback.select();
      element('shareStatus').textContent = '浏览器未允许自动复制，请手动复制下方链接。' + localNotice;
    }
  });

  element('exportRegistry').addEventListener('click', () => {
    const schools = atlas.DATA.schools.filter(school => school.stage === '高中');
    atlas.downloadCSV([
      ['招生代码', '学校', '招生归属', '办别', '官方类型', '定位状态', '名单来源'],
      ...schools.map(school => [school.code, school.name, school.district, school.nature, school.type, school.locationStatus, school.source]),
    ], '高中名录_20260916.csv');
  });

  restoreFilters();
  atlas.shareURL = shareURL;
})();
