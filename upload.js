/* NetOps — CONFIG 원본 업로드 보완 · 장비 대장(인벤토리)
   ① 업로드: 양식 없이 원본 여러 개 → 비밀 줄 삭제 → 같은 호스트명 파일은 한 장비로 합침 → 장비 대장의 모델·OS 자동 입력
   ② 원본 보관: 비밀 줄을 지운 원본을 이 브라우저(IndexedDB)와 지정 폴더 configs/ 에 보관 → 구성도에서 두 번 누르면 표시
   ③ 실제 연동 회선: 업로드한 장비끼리 같은 대역으로 이어진 회선 목록
   ④ 장비 대장: 호스트명·벤더·모델·OS·사이트를 따로 관리 (개별 입력 + CSV 양식 일괄 등록) */
(function () {
  'use strict';
  var S = function () { return window.netopsStorage || {}; };
  var toast = function (m) { (S().toast || function (x) { console.log(x); })(m); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var api = function () { return window.__nxStoreApi || {}; };
  var ctx = function () { return window.__nxCtx || {}; };

  /* ── 비밀 정보 줄 삭제 (줄 번호는 그대로 유지: 해당 줄을 빈 줄로) ── */
  var SECRET = /(password|passwd|secret|key-string|authentication-key|authentication-password|privacy-password|message-digest-key|pre-shared|\bpsk\b|shared-secret|private-key|ssh-rsa|ssh-ed25519|ssh-dss|encrypted-password|irreversible-cipher|\bcipher\b|snmp-server\s+community|snmp-agent\s+community|snmp\s+community|community-string|add\s+community|usm-user|snmp-server\s+user\s|tacacs[\w-]*\s+.*key|radius[\w-]*\s+.*key|\bkey\s+[0-7]\s|\$9\$|\$[156]\$|plain-text-password|enable\s+secret|hash\s+\S+\s+\S{16,}|^\s*snmp-server\s+host\b|^\s*(set\s+snmp\s+)?community\s+\S+(\s*\{|\s+authorization|$)|snmp-agent\s+target-host)/i;
  var CERT_START = /^\s*(certificate\s+(self-signed|ca|\S+)|-----BEGIN)/i, CERT_END = /^\s*(quit|-----END.*)\s*$/i;
  function sanitize(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), red = [], inCert = false;
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i];
      if (inCert) { red.push(i + 1); lines[i] = ''; if (CERT_END.test(s)) inCert = false; continue; }
      if (CERT_START.test(s) && !/crypto pki trustpoint/i.test(s)) { inCert = true; red.push(i + 1); lines[i] = ''; continue; }
      if (SECRET.test(s)) { red.push(i + 1); lines[i] = ''; }
    }
    return { text: lines.join('\n'), red: red };
  }

  /* ── 업로드 전처리: 같은 호스트명 파일 합치기 ── */
  var PENDING = {};
  function pre(files) {
    var parse = window.__nxFn && window.__nxFn.parse, groups = [], byKey = {};
    files.forEach(function (f) {
      var sz = sanitize(f.text);
      if (/^#NETOPS-BEGIN/m.test(f.text)) { groups.push({ name: f.name, parts: [{ name: f.name, text: sz.text, red: sz.red }], tpl: true }); return; }
      var host = '';
      try { host = (parse ? parse(sz.text, {}).hostname : '') || ''; } catch (e) { host = ''; }
      host = String(host).replace(/"/g, '').trim();
      var key = host ? 'h:' + host.toLowerCase() : 'f:' + f.name;
      if (!byKey[key]) { byKey[key] = { name: '', host: host, parts: [] }; groups.push(byKey[key]); }
      byKey[key].parts.push({ name: f.name, text: sz.text, red: sz.red });
    });
    return groups.map(function (g) {
      var off = 0, text = [], red = [], names = [];
      g.parts.forEach(function (p) { names.push(p.name); p.red.forEach(function (n) { red.push(n + off); }); text.push(p.text); off += p.text.split('\n').length; });
      var name = names.length > 1 ? names.join(' + ') : names[0];
      PENDING[name] = { text: text.join('\n'), red: red, files: names, merged: names.length > 1 };
      return { name: name, text: text.join('\n') };
    });
  }
  /* ── 업로드 후처리: 장비 대장(호스트명)으로 벤더·모델·OS 채우기 ── */
  function inventory() { return ((api().settings || {}).inventory) || []; }
  function invFind(h) { var k = String(h || '').toLowerCase(); return inventory().find(function (r) { return String(r.hostname).toLowerCase() === k; }); }
  function post(items) {
    (items || []).forEach(function (it) {
      var r = invFind(it.hostname);
      if (r) {
        if (r.model) it.model = r.model;
        if (r.os) it.os = r.os;
        var v = vendorId(r.vendor, r.os); if (v && !it.vendor) it.vendor = v;
        it.invHit = true;
      }
      var pd = PENDING[it.file]; if (pd && pd.merged) it.mergedFiles = pd.files.length;
    });
    return items;
  }

  /* ── 원본 보관소: IndexedDB 'netops-raw' + 지정 폴더 configs/ ── */
  function rdb() { return new Promise(function (res, rej) { var r = indexedDB.open('netops-raw', 1); r.onupgradeneeded = function () { r.result.createObjectStore('cfg', { keyPath: 'key' }); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function rput(rec) { return rdb().then(function (d) { return new Promise(function (res) { var t = d.transaction('cfg', 'readwrite'); t.objectStore('cfg').put(rec); t.oncomplete = res; t.onerror = res; }); }).catch(function () {}); }
  function rget(key) { return rdb().then(function (d) { return new Promise(function (res) { var q = d.transaction('cfg').objectStore('cfg').get(key); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  var MARK = '### NetOps: 비밀 정보 줄 삭제됨 ###';
  var fname = function (h) { return String(h).replace(/[^\w.-]+/g, '_') + '.txt'; };
  function rawSave(items, topoId) {
    (items || []).filter(function (it) { return it.action !== 'skip'; }).forEach(function (it) {
      var pd = PENDING[it.file]; if (!pd) return;
      var rec = { key: topoId + '|' + String(it.hostname).toLowerCase(), hostname: it.hostname, files: pd.files, text: pd.text, red: pd.red, vendor: it.vendor || '', at: Date.now() };
      rput(rec);
      var lines = pd.text.split('\n'); pd.red.forEach(function (n) { if (lines[n - 1] === '') lines[n - 1] = MARK; });
      var save = S().saveExtra; if (save) save('configs', fname(it.hostname), lines.join('\n')).catch(function () {});
    });
  }
  function rawGet(topoId, hostname) {
    return rget(topoId + '|' + String(hostname).toLowerCase()).then(function (r) {
      if (r) return r;
      var read = S().readExtra; if (!read) return null;
      return read('configs', fname(hostname)).then(function (t) {
        if (!t) return null;
        var lines = t.split('\n'), red = [];
        lines.forEach(function (l, i) { if (l === MARK) { red.push(i + 1); lines[i] = ''; } });
        return { hostname: hostname, files: ['configs/' + fname(hostname)], text: lines.join('\n'), red: red, at: 0, fromFolder: true };
      });
    });
  }
  function rall() { return rdb().then(function (d) { return new Promise(function (res) { var q = d.transaction('cfg').objectStore('cfg').getAll(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  window.__nxRawAll = rall; window.__nxRawPut = rput;
  window.__nxPre = pre; window.__nxPost = post; window.__nxRawSave = rawSave; window.__nxRawGet = rawGet;

  /* ── 구성도 두 번 누르기 창: 업로드 원본 보기 (React 컴포넌트, 앱의 React 사용) ── */
  function RawView(props) {
    var R = window.__nxReact, W = R.W, l = R.l;
    var st = W.useState(null), data = st[0], setData = st[1];
    var op = W.useState(true), open = op[0], setOpen = op[1];
    var node = props.node;
    W.useEffect(function () { var off = false; rawGet(props.topo.id, node.hostname).then(function (r) { if (!off) setData(r || false); }); return function () { off = true; }; }, [props.topo.id, node.hostname, node.parsedAt]);
    if (data === null) return node.parsed ? l.jsx('div', { className: 'notice small', children: '업로드 원본 불러오는 중…' }) : null;
    if (data === false) return node.parsed ? l.jsx('div', { className: 'notice small', children: '업로드 원본이 이 PC에 보관되어 있지 않아요 (예전 버전에서 올렸거나 다른 PC에서 올림). 업로드·검증에서 다시 올리면 보관돼요.' }) : null;
    var red = {}; (data.red || []).forEach(function (n) { red[n] = 1; });
    var bad = {}; (props.issues || []).forEach(function (v) { if (v.line) bad[v.line] = v.sev; });
    var lines = data.text.split('\n'), w = String(lines.length).length;
    var copy = function () { var t = lines.map(function (x, i) { return red[i + 1] ? '' : x; }).join('\n'); if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('원본을 복사했어요 (비밀 줄 제외)'); }, function () { toast('복사가 막혀 있어요 — 저장을 이용하세요'); }); };
    var saveF = function () { var dl = S().download; if (dl) dl(fname(node.hostname).replace(/\.txt$/, '') + '-uploaded.txt', new Blob([lines.map(function (x, i) { return red[i + 1] ? MARK : x; }).join('\n')], { type: 'text/plain' })); };
    var rows = open ? lines.map(function (x, i) {
      var n = i + 1, cls = red[n] ? 'nx-raw-red' : bad[n] ? 'nx-raw-' + bad[n] : '';
      return l.jsx('div', { className: 'nx-raw-ln ' + cls, children: [l.jsx('span', { className: 'nx-raw-no', children: String(n).padStart(w, ' ') }, 'n'), red[n] ? '··· 비밀 정보 줄 삭제됨' : x] }, n);
    }) : null;
    return l.jsxs('div', { className: 'nx-raw', children: [
      l.jsxs('div', { className: 'row small', children: [
        l.jsx('b', { children: '업로드 원본 CONFIG' }),
        l.jsx('span', { className: 'muted', children: (data.files || []).join(' + ') + ' · ' + lines.length + '줄 · 비밀 줄 ' + (data.red || []).length + '개 삭제' + (data.at ? ' · ' + new Date(data.at).toLocaleString('ko-KR') : '') + (data.fromFolder ? ' · 폴더 configs/' : '') }),
        l.jsx('span', { className: 'spacer' }),
        l.jsx('button', { className: 'btn sm quiet', onClick: function () { setOpen(!open); }, children: open ? '접기' : '펼치기' }),
        l.jsx('button', { className: 'btn sm quiet', onClick: copy, children: '원본 복사' }),
        l.jsx('button', { className: 'btn sm quiet', onClick: saveF, children: '원본 저장' })
      ] }),
      open ? l.jsx('div', { className: 'nx-raw-box', children: rows }) : null,
      Object.keys(bad).length ? l.jsx('div', { className: 'small muted', children: '빨간 줄 = 검증 오류, 노란 줄 = 경고가 가리키는 줄' }) : null
    ] });
  }
  window.__nxRawView = RawView;

  var css = '' +
    '.nx-raw{border:1px solid var(--line,#e4e7ec);border-radius:10px;padding:8px 10px;margin:8px 0;background:var(--surface,#fff)}' +
    '.nx-raw-box{font:12px/1.5 "JetBrains Mono",ui-monospace,monospace;max-height:420px;overflow:auto;background:var(--surface-2,#f6f7f9);border-radius:8px;padding:6px 0;margin-top:6px;white-space:pre}' +
    '.nx-raw-ln{padding:0 10px}.nx-raw-no{color:var(--muted,#8a94a3);user-select:none;margin-right:12px;white-space:pre}' +
    '.nx-raw-red{color:var(--muted,#8a94a3);font-style:italic}.nx-raw-error{background:rgba(180,50,31,.14)}.nx-raw-warn{background:rgba(194,106,0,.16)}' +
    '#nx-links table,#nx-inv table{width:100%;border-collapse:collapse;font-size:13px}#nx-links th,#nx-links td,#nx-inv th,#nx-inv td{border-bottom:1px solid var(--line,#e4e7ec);padding:5px 6px;text-align:left;vertical-align:middle}' +
    '#nx-inv td input,#nx-inv td select{font:inherit;font-size:13px;width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid var(--line,#d0d5dd);border-radius:7px;background:var(--surface,#fff);color:var(--ink,#111418);min-width:70px}' +
    '#nx-inv .tw,#nx-links .tw{overflow:auto;max-height:480px}#nx-inv .on{color:var(--good,#1f7a4e);font-weight:600}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  /* ── 벤더 표기 ── */
  var VENDORS = [['cisco', 'Cisco'], ['huawei', 'Huawei'], ['juniper', 'Juniper'], ['arista', 'Arista'], ['exos', 'Extreme EXOS'], ['voss', 'Extreme VOSS'], ['ale', 'ALE OmniSwitch'], ['nokia', 'Nokia'], ['a10', 'A10']];
  var CAT_LABEL = { cisco: 'Cisco', huawei: 'Huawei', juniper: 'Juniper', arista: 'Arista', exos: 'Extreme', voss: 'Extreme', ale: 'ALE', nokia: 'Nokia', a10: 'A10' };
  function vendorId(v, os) {
    var s = String(v || '').trim().toLowerCase(), o = String(os || '').toLowerCase(); if (!s) return '';
    if (/^cisco/.test(s)) return 'cisco'; if (/^huawei/.test(s)) return 'huawei'; if (/^juniper/.test(s)) return 'juniper'; if (/^arista/.test(s)) return 'arista'; if (/^a10/.test(s)) return 'a10';
    if (/nokia|alcatel-lucent sr|^sr\b/.test(s)) return 'nokia'; if (/^ale|alcatel|omniswitch/.test(s)) return 'ale';
    if (/voss|^vsp/.test(s)) return 'voss'; if (/exos/.test(s)) return 'exos'; if (/^extreme/.test(s)) return /voss/.test(o) ? 'voss' : 'exos';
    for (var i = 0; i < VENDORS.length; i++) if (VENDORS[i][0] === s) return s; return '';
  }
  var vLabel = function (id) { for (var i = 0; i < VENDORS.length; i++) if (VENDORS[i][0] === id) return VENDORS[i][1]; return id || ''; };

  /* ── 업로드 화면: 실제 연동 회선 ── */
  function pageTitle() { var h = document.querySelector('.page .page-head h1'); return h ? h.textContent.trim() : ''; }
  function ifIp(n, port) {
    var p = n && n.parsed && n.parsed.ifaces; if (!p || !port) return '';
    var k = Object.keys(p).find(function (x) { return x.toLowerCase().replace(/\s+/g, '') === String(port).toLowerCase().replace(/\s+/g, ''); });
    return k && p[k].ip ? p[k].ip : '';
  }
  function linksPanel() {
    var t = ctx().raw; if (!t) return '';
    var byId = {}; t.nodes.forEach(function (n) { byId[n.id] = n; });
    var rows = t.links.filter(function (L) { var a = byId[L.a.node], b = byId[L.b.node]; return a && b && (a.parsed || b.parsed); });
    var h = '<h2>실제 연동 회선 <span class="small muted">' + rows.length + '개</span></h2><p class="small muted">업로드한 CONFIG에서 <b>같은 대역(P2P)</b>의 IP를 가진 인터페이스끼리 이은 회선이에요. 구성도에 선으로 그려져 있고, 연결 양끝 검증(IP·MTU·속도 등)에 쓰여요.</p>';
    if (!rows.length) return h + '<p class="small muted">아직 없어요. 서로 연결된 장비 2대 이상의 CONFIG를 올리면 나타나요.</p>';
    h += '<div class="tw"><table><thead><tr><th>#</th><th>장비 A</th><th>포트 A</th><th>IP A</th><th></th><th>장비 B</th><th>포트 B</th><th>IP B</th></tr></thead><tbody>' + rows.map(function (L, i) {
      var a = byId[L.a.node], b = byId[L.b.node];
      return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(a.hostname) + '</b></td><td class="mono">' + esc(L.a.port || '—') + '</td><td class="mono">' + esc(ifIp(a, L.a.port)) + '</td><td>↔</td><td><b>' + esc(b.hostname) + '</b></td><td class="mono">' + esc(L.b.port || '—') + '</td><td class="mono">' + esc(ifIp(b, L.b.port)) + '</td></tr>';
    }).join('') + '</tbody></table></div><div class="row"><button class="btn sm" data-nx-go="canvas">구성도에서 보기</button></div>';
    return h;
  }
  var lastLinkSig = '';
  function ensureLinks() {
    if (pageTitle() !== '업로드·검증') return;
    var sec = document.querySelector('[aria-labelledby="up2-h"]'); if (!sec) return;
    var box = document.getElementById('nx-links');
    if (!box) { box = document.createElement('section'); box.id = 'nx-links'; box.className = 'panel'; box.addEventListener('click', function (e) { if (e.target.closest('[data-nx-go]')) { var n = document.getElementById('nav-canvas'); if (n) n.click(); } }); lastLinkSig = ''; }
    if (box.previousElementSibling !== sec) sec.insertAdjacentElement('afterend', box);
    var t = ctx().raw, sig = t ? t.id + ':' + t.links.length + ':' + t.nodes.filter(function (n) { return n.parsed; }).map(function (n) { return n.parsedAt; }).join(',') : '';
    if (sig !== lastLinkSig) { lastLinkSig = sig; box.innerHTML = linksPanel(); }
  }

  /* ── 인벤토리: 장비 대장 ── */
  var INV_COLS = ['hostname', 'vendor', 'model', 'os', 'site', 'note'];
  var INV_GUIDE = ['# NetOps 장비 대장 — 한 행 = 장비 1대. hostname은 CONFIG의 hostname/sysname/host-name과 같게 (대소문자 무관)',
    '# vendor: Cisco, Huawei, Juniper, Arista, Extreme EXOS, Extreme VOSS, ALE, Nokia, A10 (비우면 CONFIG에서 자동)',
    '# model·os를 넣어 두면 CONFIG 업로드·구성도 반영 때 자동으로 들어감. # 으로 시작하는 줄은 무시'];
  var invFilter = '', saveTimer = null;
  function saveInv(list) { clearTimeout(saveTimer); saveTimer = setTimeout(function () { if (api().saveSettings) api().saveSettings({ inventory: list }); }, 250); }
  function csvLine(a) { return a.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }
  function parseCsv(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/), out = [], bad = [];
    var delim = lines.some(function (l) { return l.indexOf('\t') >= 0; }) ? '\t' : ',';
    lines.forEach(function (raw, i) {
      if (!raw.trim() || /^\s*#/.test(raw)) return;
      var f = [], cur = '', q = false;
      for (var k = 0; k < raw.length; k++) { var ch = raw[k]; if (q) { if (ch === '"' && raw[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === delim) { f.push(cur); cur = ''; } else cur += ch; }
      f.push(cur); f = f.map(function (x) { return x.trim(); });
      if (f[0].toLowerCase() === 'hostname') return;
      if (!f[0]) { bad.push((i + 1) + '행: hostname 없음'); return; }
      var o = {}; INV_COLS.forEach(function (c, j) { o[c] = f[j] || ''; });
      if (o.vendor && !vendorId(o.vendor, o.os)) bad.push((i + 1) + '행: vendor "' + o.vendor + '"를 모름');
      out.push(o);
    });
    return { rows: out, bad: bad };
  }
  function mergeInv(list, rows) {
    var map = {}; list.forEach(function (r, i) { map[String(r.hostname).toLowerCase()] = i; });
    var add = 0, upd = 0;
    rows.forEach(function (r) { var k = String(r.hostname).toLowerCase(); if (map[k] != null) { var o = list[map[k]]; INV_COLS.forEach(function (c) { if (r[c]) o[c] = r[c]; }); upd++; } else { list.push(r); map[k] = list.length - 1; add++; } });
    return { add: add, upd: upd };
  }
  function invPanel() {
    var list = inventory(), t = ctx().raw, nodes = (t && t.nodes) || [];
    var onCanvas = {}; nodes.forEach(function (n) { onCanvas[String(n.hostname).toLowerCase()] = n; });
    var cat = (api().settings || {}).catalog || [];
    var f = invFilter.toLowerCase();
    var shown = list.map(function (r, i) { return [r, i]; }).filter(function (x) { return !f || INV_COLS.some(function (c) { return String(x[0][c] || '').toLowerCase().indexOf(f) >= 0; }); });
    var h = '<h2>장비 대장 <span class="small muted">호스트명·모델·OS · ' + list.length + '대</span></h2>' +
      '<p class="small muted">CONFIG에는 모델이 없을 때가 많아요. 여기 <b>호스트명</b>으로 모델·OS를 등록해 두면 <b>업로드·검증</b>에서 원본만 올려도 자동으로 들어가고, <b>구성도에 반영</b>으로 지금 장비에도 넣을 수 있어요. 한 대씩 입력하거나 양식(CSV)으로 일괄 등록하세요.</p>' +
      '<div class="row" style="flex-wrap:wrap"><button class="btn sm" data-inv="add">+ 행 추가</button><button class="btn sm" data-inv="fromcanvas">구성도 장비 불러오기</button><button class="btn sm" data-inv="tpl">양식 받기</button><label class="btn sm" style="display:inline-flex;align-items:center">CSV 가져오기<input type="file" id="nx-inv-file" accept=".csv,.txt,.tsv" hidden></label><button class="btn sm" data-inv="export">내보내기</button><button class="btn sm primary" data-inv="apply">구성도에 반영</button><span class="spacer"></span><input id="nx-inv-q" placeholder="검색" value="' + esc(invFilter) + '" style="max-width:180px"></div>' +
      '<datalist id="nx-inv-models">' + cat.map(function (c) { return '<option value="' + esc(c.model) + '">'; }).join('') + '</datalist>' +
      '<div class="tw"><table><thead><tr><th style="min-width:130px">호스트명</th><th>벤더</th><th style="min-width:140px">모델</th><th style="min-width:120px">OS</th><th>사이트</th><th>메모</th><th>구성도</th><th></th></tr></thead><tbody>' +
      (shown.length ? shown.map(function (x) {
        var r = x[0], i = x[1], n = onCanvas[String(r.hostname).toLowerCase()];
        var same = n && (!r.model || n.model === r.model) && (!r.os || n.os === r.os);
        return '<tr data-i="' + i + '"><td><input data-k="hostname" value="' + esc(r.hostname) + '"></td><td><select data-k="vendor"><option value="">자동</option>' + VENDORS.map(function (v) { return '<option value="' + v[1] + '"' + (vendorId(r.vendor, r.os) === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select></td>' +
          '<td><input data-k="model" list="nx-inv-models" value="' + esc(r.model) + '"></td><td><input data-k="os" value="' + esc(r.os) + '"></td><td><input data-k="site" value="' + esc(r.site) + '"></td><td><input data-k="note" value="' + esc(r.note) + '"></td>' +
          '<td class="small">' + (n ? (same ? '<span class="on">반영됨</span>' : '<span class="muted">반영 대기</span>') : '<span class="muted">없음</span>') + '</td><td><button class="btn sm danger" data-inv="del" data-i="' + i + '">삭제</button></td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">등록된 장비가 없어요. <b>+ 행 추가</b>, <b>구성도 장비 불러오기</b> 또는 <b>양식 받기 → CSV 가져오기</b>로 시작하세요.</td></tr>') +
      '</tbody></table></div><div class="small muted" id="nx-inv-msg"></div>';
    return h;
  }
  function renderInv() { var box = document.getElementById('nx-inv'); if (box) { var q = document.activeElement && document.activeElement.id === 'nx-inv-q'; box.innerHTML = invPanel(); if (q) { var el = document.getElementById('nx-inv-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } }
  function ensureCatalog(rows) {
    var cat = window.__nxCat, a = api(); if (!cat || !a.saveSettings) return 0;
    var cur = (a.settings || {}).catalog || [], lines = [];
    rows.forEach(function (r) { var v = r.vendor; if (!v || !r.model) return; if (cur.some(function (c) { return c.vendor === v && String(c.model).toUpperCase() === String(r.model).toUpperCase(); })) return; lines.push([CAT_LABEL[v], r.model, r.os || (v === 'voss' ? 'VOSS' : v === 'exos' ? 'EXOS' : '')].join(', ')); });
    if (!lines.length) return 0;
    var p = cat.parse(lines.join('\n')); if (p.ok.length) a.saveSettings({ catalog: cat.merge(cur, p.ok) });
    return p.ok.length;
  }
  function applyInv() {
    var c = ctx(), list = inventory(); if (!c.raw || !c.updateTopo) return toast('구성도를 먼저 여세요');
    var map = {}; list.forEach(function (r) { map[String(r.hostname).toLowerCase()] = r; });
    var hit = 0, rowsForCat = [];
    c.updateTopo(c.raw.id, function (t) {
      t.nodes.forEach(function (n) {
        var r = map[String(n.hostname).toLowerCase()]; if (!r) return;
        var v = vendorId(r.vendor, r.os); if (v) n.vendor = v;
        if (r.model) n.model = r.model; if (r.os) n.os = r.os;
        hit++; rowsForCat.push({ vendor: n.vendor, model: n.model, os: n.os });
      });
      return t;
    });
    var added = ensureCatalog(rowsForCat);
    toast('구성도 장비 ' + hit + '대에 모델·OS 반영' + (added ? ' · 모델 목록 +' + added : '') + (hit < list.length ? ' (대장 ' + (list.length - hit) + '대는 구성도에 없음)' : ''));
    setTimeout(renderInv, 300);
  }
  function invClick(e) {
    var b = e.target.closest('[data-inv]'); if (!b) return;
    var k = b.getAttribute('data-inv'), list = inventory().slice();
    if (k === 'add') { list.unshift({ hostname: '', vendor: '', model: '', os: '', site: '', note: '' }); api().saveSettings({ inventory: list }); setTimeout(function () { renderInv(); var f = document.querySelector('#nx-inv tbody input[data-k="hostname"]'); if (f) f.focus(); }, 80); }
    else if (k === 'del') { list.splice(+b.getAttribute('data-i'), 1); api().saveSettings({ inventory: list }); setTimeout(renderInv, 80); }
    else if (k === 'fromcanvas') {
      var t = ctx().raw; if (!t) return;
      var r = mergeInv(list, t.nodes.filter(function (n) { return n.hostname; }).map(function (n) { return { hostname: n.hostname, vendor: vLabel(n.vendor), model: n.model || '', os: n.os || '', site: '', note: '' }; }));
      api().saveSettings({ inventory: list }); toast('구성도에서 불러옴: 새로 ' + r.add + '대 · 갱신 ' + r.upd + '대'); setTimeout(renderInv, 80);
    }
    else if (k === 'tpl') { var sample = list.length ? list.map(function (r) { return INV_COLS.map(function (c) { return r[c] || ''; }); }) : [['CORE-01', 'Huawei', 'NE40E-X8A', 'VRP 8.220', '본사', ''], ['LEAF1', 'Arista', 'DCS-7280SR-48C6', 'EOS-4.28.3M', 'IDC', '']]; S().download('netops-inventory-template.csv', new Blob(['﻿' + INV_GUIDE.join('\n') + '\n' + [INV_COLS].concat(sample).map(csvLine).join('\n') + '\n'], { type: 'text/csv' })); }
    else if (k === 'export') S().download('netops-inventory-' + (S().stamp ? S().stamp() : '') + '.csv', new Blob(['﻿' + INV_GUIDE.join('\n') + '\n' + [INV_COLS].concat(list.map(function (r) { return INV_COLS.map(function (c) { return r[c] || ''; }); })).map(csvLine).join('\n') + '\n'], { type: 'text/csv' }));
    else if (k === 'apply') applyInv();
  }
  function invInput(e) {
    var t = e.target;
    if (t.id === 'nx-inv-q') { invFilter = t.value; renderInv(); return; }
    if (t.id === 'nx-inv-file') { var f = t.files && t.files[0]; t.value = ''; if (!f) return; f.text().then(function (x) { var p = parseCsv(x), list = inventory().slice(), r = mergeInv(list, p.rows.filter(function (row) { return !row.vendor || vendorId(row.vendor, row.os); })); api().saveSettings({ inventory: list }); setTimeout(function () { renderInv(); var m = document.getElementById('nx-inv-msg'); if (m) m.textContent = '가져옴: 새로 ' + r.add + '대 · 갱신 ' + r.upd + '대' + (p.bad.length ? ' · 건너뜀: ' + p.bad.join(' / ') : ''); }, 120); }); return; }
    var tr = t.closest('tr[data-i]'); if (!tr || !t.getAttribute('data-k')) return;
    var list = inventory().slice(), i = +tr.getAttribute('data-i'); if (!list[i]) return;
    list[i] = Object.assign({}, list[i]); list[i][t.getAttribute('data-k')] = t.value.trim();
    saveInv(list);
  }
  function ensureInv() {
    if (pageTitle() !== '인벤토리') return;
    var head = document.querySelector('.page .page-head'); if (!head) return;
    var box = document.getElementById('nx-inv');
    if (!box) { box = document.createElement('section'); box.id = 'nx-inv'; box.className = 'panel'; box.addEventListener('click', invClick); box.addEventListener('change', invInput); box.addEventListener('input', function (e) { if (e.target.id === 'nx-inv-q') invInput(e); }); box.innerHTML = invPanel(); }
    if (box.previousElementSibling !== head) head.insertAdjacentElement('afterend', box);
  }

  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensureLinks(); ensureInv(); }); });
  function start() { mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true }); ensureLinks(); ensureInv(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.netopsUpload = { sanitize: sanitize, pre: pre, renderInv: renderInv, parseInvCsv: parseCsv };
})();
