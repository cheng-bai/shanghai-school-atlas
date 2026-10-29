'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const data = window.SCHOOL_DATA;
  const studentData = window.AtlasStudentData;
  let current = {rows: [], summary: {total: 0, groups: []}};
  let pending = null;
  let reading = 0;

  function downloadText(text, name) {
    const url = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function table(groups, action) {
    if (!groups.length) return '<div class="student-empty"><span>◌</span><b>还没有校区—学校学生数据</b><p>下载模板，使用匿名演示数据体验流程。</p></div>';
    return '<table class="student-table"><thead><tr><th>校区</th><th>学校</th><th>学段</th><th>导入人数</th><th>地图</th></tr></thead><tbody>' + groups.map(group =>
      `<tr><td>${escapeHTML(group.campusName)}<small>${escapeHTML(group.campusId)}</small></td><td>${escapeHTML(group.schoolName)}<small>${escapeHTML(group.schoolId)}</small></td><td>${escapeHTML(group.stage)}</td><td><b>${group.count}</b> 人</td><td>${action ? (group.hasLocation ? `<button data-student-campus="${escapeHTML(group.campusId)}" data-student-school="${escapeHTML(group.schoolId)}">查看位置 ↗</button>` : '<span class="location-missing">待定位</span>') : (group.hasLocation ? '有参考校址' : '待定位')}</td></tr>`).join('') + '</tbody></table>';
  }
  function renderSummary() {
    const summary = current.summary;
    const campusCount = new Set(summary.groups.map(g => g.campusId)).size;
    const schoolCount = new Set(summary.groups.map(g => g.schoolId)).size;
    $('studentStats').innerHTML = `<div><span>导入人数</span><b>${summary.total}</b><small>仅本次会话</small></div><div><span>涉及校区</span><b>${campusCount}</b><small>精确匹配校区 ID</small></div><div><span>涉及学校</span><b>${schoolCount}</b><small>精确匹配学校 ID</small></div><div><span>校区—学校组合</span><b>${summary.groups.length}</b><small>包含待定位学校</small></div>`;
    $('studentSummaryTable').innerHTML = table(summary.groups, true);
    $('studentClear').disabled = !summary.total;
    $('studentSummaryTable').querySelectorAll('[data-student-school]').forEach(button => button.addEventListener('click', () => {
      window.atlas.focusSchool(button.dataset.studentCampus, button.dataset.studentSchool);
    }));
  }
  function renderPreview(result) {
    $('studentPreview').classList.remove('hidden');
    const errors = result.errors || [];
    $('studentConfirm').disabled = !!errors.length || !result.rows.length;
    if (errors.length) {
      $('studentPreviewTitle').textContent = '文件未通过校验';
      $('studentPreviewDescription').textContent = `发现 ${errors.length} 处问题，整批不会导入；已导入的会话数据不受影响。`;
      $('studentErrors').innerHTML = '<div class="student-error"><b>请修正后重新选择文件</b><ul>' + errors.slice(0, 20).map(e => `<li>第 ${Number(e.line) || 1} 行：${escapeHTML(e.message)}</li>`).join('') + (errors.length > 20 ? `<li>另有 ${errors.length - 20} 处问题未展开。</li>` : '') + '</ul></div>';
      $('studentPreviewTable').innerHTML = '';
    } else {
      $('studentPreviewTitle').textContent = `校验通过 · ${result.summary.total} 条匿名记录`;
      $('studentPreviewDescription').textContent = '以下只显示校区—学校汇总；确认后会替换本次会话中已有的导入数据。';
      $('studentErrors').innerHTML = '';
      $('studentPreviewTable').innerHTML = table(result.summary.groups, false);
    }
  }
  function clearPreview() {
    pending = null; reading++;
    $('studentFile').value = '';
    $('studentPreview').classList.add('hidden');
    $('studentPreviewTable').innerHTML = ''; $('studentErrors').innerHTML = '';
    $('studentFileStatus').textContent = '还没有选择文件。不会自动导入，也不会合并到公开学校数据。';
  }
  $('studentFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    const request = ++reading;
    pending = null;
    $('studentFileStatus').textContent = '正在本机校验文件……';
    let result;
    try {
      if (file.size > 1024 * 1024) throw new Error('文件超过 1 MB，请拆分后导入。');
      const text = new TextDecoder('utf-8', {fatal:true}).decode(await file.arrayBuffer());
      if (request !== reading) return;
      result = studentData.validate(text, data);
    } catch (error) {
      if (request !== reading) return;
      result = {rows: [], errors: [{line: 1, message: error instanceof TypeError ? '文件不是有效的 UTF-8，请另存为 UTF-8 CSV。' : error.message}], summary: {total: 0, groups: []}};
    }
    if (!result.errors.length) pending = result;
    $('studentFileStatus').textContent = result.errors.length ? '文件校验未通过；请查看下方错误。' : '文件已通过本地校验；请确认预览。';
    renderPreview(result);
  });
  $('studentTemplate').addEventListener('click', () => downloadText(studentData.templateCSV(data), '校区学生_匿名导入模板.csv'));
  $('studentDirectory').addEventListener('click', () => window.atlas.downloadCSV([
    ['类型', 'ID', '名称', '学段', '区'],
    ...data.campuses.map(c => ['校区', c.id, c.name, '', c.district]),
    ...data.schools.map(s => ['学校', s.id, s.name, s.stage, s.district])
  ], '校区与学校_ID对照.csv'));
  $('studentCancel').addEventListener('click', clearPreview);
  $('studentConfirm').addEventListener('click', () => {
    if (!pending || pending.errors.length || !pending.rows.length) return;
    current = {rows: pending.rows, summary: pending.summary};
    clearPreview(); renderSummary(); window.atlas.refresh();
    $('studentSessionStatus').textContent = `已载入 ${current.summary.total} 条匿名记录；仅保存在本页面内，刷新即清空。`;
  });
  $('studentClear').addEventListener('click', () => {
    current = {rows: [], summary: {total: 0, groups: []}};
    clearPreview(); renderSummary(); window.atlas.refresh();
    $('studentSessionStatus').textContent = '本次会话数据已清空。';
  });
  window.atlasStudents = {
    schoolBadge(schoolId, campusId) {
      const count = current.summary.groups.filter(g => g.schoolId === schoolId && (campusId === 'all' || g.campusId === campusId)).reduce((sum, g) => sum + g.count, 0);
      return count ? `<div class="student-badge">本地导入 · ${campusId === 'all' ? '全部校区' : '当前校区'} ${count} 人</div>` : '';
    }
  };
  renderSummary();
})();
