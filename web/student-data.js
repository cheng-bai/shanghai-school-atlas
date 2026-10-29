(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasStudentData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_BYTES = 1024 * 1024;
  var MAX_ROWS = 5000;
  var HEADERS = ['学生匿名编号', '校区ID', '学校ID', '年级'];
  var GRADES = {
    '六年级': '初中', '七年级': '初中', '八年级': '初中', '九年级': '初中',
    '初一': '初中', '初二': '初中', '初三': '初中',
    '高一': '高中', '高二': '高中', '高三': '高中'
  };

  function fail(message, line) {
    var error = new Error(message);
    error.line = line || 1;
    throw error;
  }

  function checkSize(text) {
    if (typeof text !== 'string') fail('请导入 UTF-8 CSV 文本。');
    if (text.length > MAX_BYTES) fail('文件超过 1MB，请拆分后导入。');
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length &&
               text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
      if (bytes > MAX_BYTES) fail('文件超过 1MB，请拆分后导入。');
    }
  }

  function parse(text) {
    checkSize(text);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], lines = [], row = [], cell = '', state = 'plain';
    var line = 1, startLine = 1;
    function endRow() {
      row.push(cell);
      rows.push(row);
      lines.push(startLine);
      row = [];
      cell = '';
      state = 'plain';
    }
    for (var i = 0; i < text.length; i += 1) {
      var c = text[i];
      if (state === 'quoted') {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 1; }
          else state = 'closed';
        } else if (c === '\r' || c === '\n') {
          if (c === '\r' && text[i + 1] === '\n') i += 1;
          cell += '\n';
          line += 1;
        } else cell += c;
      } else if (c === ',' || c === '\r' || c === '\n') {
        if (c === ',') {
          row.push(cell);
          cell = '';
          state = 'plain';
        } else {
          endRow();
          if (c === '\r' && text[i + 1] === '\n') i += 1;
          line += 1;
          startLine = line;
        }
      } else if (c === '"') {
        if (state !== 'plain' || cell !== '') fail('CSV 引号位置不正确，请使用下载模板。', line);
        state = 'quoted';
      } else {
        if (state === 'closed') fail('CSV 结束引号后只能是逗号或换行。', line);
        cell += c;
      }
    }
    if (state === 'quoted') fail('CSV 引号未闭合。', startLine);
    if (cell !== '' || row.length || state === 'closed') endRow();
    return { rows: rows, lines: lines };
  }

  function parseCSV(text) { return parse(text).rows; }

  function indexes(DATA) {
    if (!DATA || !Array.isArray(DATA.campuses) || !Array.isArray(DATA.schools)) {
      fail('学校目录未加载，暂时无法导入。');
    }
    var campuses = new Map(), schools = new Map();
    DATA.campuses.forEach(function (c) { campuses.set(c.id, c); });
    DATA.schools.forEach(function (s) { schools.set(s.id, s); });
    return { campuses: campuses, schools: schools };
  }

  function rowIssue(row, index) {
    if (typeof row.anonymousId !== 'string' ||
        !/^anon-[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/.test(row.anonymousId) ||
        /\d{7,}/.test(row.anonymousId)) {
      return '匿名编号须为 anon- 开头，后接 1–64 位英文字母、数字或连字符；不可填写姓名、电话或连续 7 位以上数字。';
    }
    if (!index.campuses.has(row.campusId)) return '校区ID不在当前目录中，请填写模板中的精确ID。';
    if (!index.schools.has(row.schoolId)) return '学校ID不在当前目录中，请填写当前目录中的精确ID。';
    if (!Object.prototype.hasOwnProperty.call(GRADES, row.grade)) {
      return '年级须为六年级、七年级、八年级、九年级（或初一、初二、初三）、高一、高二、高三。';
    }
    if (GRADES[row.grade] !== index.schools.get(row.schoolId).stage) return '年级与学校学段不一致，请检查学校ID与年级。';
    return '';
  }

  function hasLocation(school) {
    return Array.isArray(school.sites) && school.sites.some(function (site) {
      return typeof site.lat === 'number' && Number.isFinite(site.lat) &&
        typeof site.lon === 'number' && Number.isFinite(site.lon) &&
        Math.abs(site.lat) <= 90 && Math.abs(site.lon) <= 180;
    });
  }

  function buildSummary(rows, DATA) {
    var index = indexes(DATA), groups = new Map(), seen = new Set();
    if (!Array.isArray(rows)) fail('学生记录必须为数组。');
    if (rows.length > MAX_ROWS) fail('超过 5000 名学生，请分批导入。');
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') fail('学生记录格式不正确。');
      var extra = Object.keys(row).filter(function (key) {
        return ['anonymousId', 'campusId', 'schoolId', 'grade'].indexOf(key) < 0;
      });
      if (extra.length) fail('学生记录含额外字段，请勿携带姓名、手机号等个人信息。');
      var issue = rowIssue(row, index);
      if (issue) fail(issue);
      if (seen.has(row.anonymousId)) fail('同一匿名编号不可重复。');
      seen.add(row.anonymousId);
      var key = JSON.stringify([row.campusId, row.schoolId]);
      if (!groups.has(key)) {
        var school = index.schools.get(row.schoolId), campus = index.campuses.get(row.campusId);
        groups.set(key, { campusId: row.campusId, campusName: campus.name,
          schoolId: row.schoolId, schoolName: school.name, stage: school.stage,
          count: 0, hasLocation: hasLocation(school) });
      }
      groups.get(key).count += 1;
    });
    return { total: rows.length, groups: Array.from(groups.values()).sort(function (a, b) {
      return a.campusId.localeCompare(b.campusId) || a.schoolId.localeCompare(b.schoolId);
    }) };
  }

  function emptyResult(errors) { return { rows: [], errors: errors, summary: { total: 0, groups: [] } }; }

  function validate(text, DATA) {
    var parsed, index;
    try { parsed = parse(text); index = indexes(DATA); }
    catch (error) { return emptyResult([{ line: error.line || 1, message: error.message }]); }
    var records = parsed.rows.map(function (cells, i) { return { cells: cells, line: parsed.lines[i] }; })
      .filter(function (record) { return record.cells.some(function (cell) { return cell.trim() !== ''; }); });
    if (!records.length) return emptyResult([{ line: 1, message: '文件为空，请使用下载模板。' }]);
    var header = records.shift(), headers = header.cells.map(function (cell) { return cell.trim(); });
    if (headers.length !== HEADERS.length || new Set(headers).size !== HEADERS.length ||
        HEADERS.some(function (name) { return headers.indexOf(name) < 0; })) {
      return emptyResult([{ line: header.line, message: '仅允许四列：学生匿名编号、校区ID、学校ID、年级；必需列不可遗漏，姓名、手机号及其他额外列均不允许导入。' }]);
    }
    if (records.length > MAX_ROWS) return emptyResult([{ line: records[MAX_ROWS].line, message: '超过 5000 名学生，请分批导入。' }]);
    if (!records.length) return emptyResult([{ line: header.line, message: '没有学生记录，请先填写模板。' }]);
    var errors = [], rows = [], seen = new Set();
    records.forEach(function (record) {
      if (record.cells.length !== HEADERS.length) {
        errors.push({ line: record.line, message: '每行必须恰好四列，不允许携带额外个人信息。' });
        return;
      }
      var row = { anonymousId: record.cells[headers.indexOf(HEADERS[0])],
        campusId: record.cells[headers.indexOf(HEADERS[1])],
        schoolId: record.cells[headers.indexOf(HEADERS[2])],
        grade: record.cells[headers.indexOf(HEADERS[3])] };
      var issue = rowIssue(row, index);
      if (issue) errors.push({ line: record.line, message: issue });
      if (seen.has(row.anonymousId)) errors.push({ line: record.line, message: '同一匿名编号不可重复。' });
      seen.add(row.anonymousId);
      rows.push(row);
    });
    if (errors.length) return emptyResult(errors);
    return { rows: rows, errors: [], summary: buildSummary(rows, DATA) };
  }

  function templateCSV(DATA) {
    var index = indexes(DATA), campus = index.campuses.get('C000');
    if (!campus) fail('当前目录缺少模板校区 C000。');
    var schools = DATA.schools.filter(function (s) { return s.stage === '高中'; });
    schools.sort(function (a, b) {
      var da = a.distances && a.distances.C000, db = b.distances && b.distances.C000;
      return (da && Number.isFinite(da.meters) ? da.meters : Infinity) -
        (db && Number.isFinite(db.meters) ? db.meters : Infinity) || a.id.localeCompare(b.id);
    });
    if (!schools.length) fail('当前目录没有高中，无法生成高一演示模板。');
    var cells = HEADERS.join(',') + '\r\n' + ['anon-DEMO001', campus.id, schools[0].id, '高一'].join(',') + '\r\n';
    return '\uFEFF' + cells;
  }

  return { parseCSV: parseCSV, validate: validate, buildSummary: buildSummary, templateCSV: templateCSV };
}));
