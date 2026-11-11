/* NetOps — 장비 구성 입력 (모델·OS + 슬롯/라인카드·모듈 또는 포트 이름 목록 → 장비 포트)
   ① 개별 입력: 구성도 장비 여러 대를 골라 같은 구성을 한 번에 적용
   ② 템플릿: CSV 양식(hostname,type,vendor,model,os,slot,card,ports)으로 여러 장비 일괄 입력·내보내기
   결과는 장비의 portList(실제 포트 목록)로 저장 — 모델 포트 구성보다 우선 사용됨. 비밀번호·장비 출력은 저장하지 않음. */
(function () {
  'use strict';
  var VENDORS = [
    ['cisco', 'Cisco'], ['huawei', 'Huawei'], ['juniper', 'Juniper'], ['arista', 'Arista'], ['exos', 'Extreme EXOS'],
    ['voss', 'Extreme VOSS'], ['ale', 'ALE OmniSwitch'], ['nokia', 'Nokia'], ['a10', 'A10']
  ];
  var TYPES = [['router', '라우터'], ['l3', 'L3 스위치'], ['l2', 'L2 스위치'], ['fw', '방화벽'], ['adc', 'L4·ADC'], ['server', '서버·NF']];
  var CAT_LABEL = { cisco: 'Cisco', huawei: 'Huawei', juniper: 'Juniper', arista: 'Arista', exos: 'Extreme', voss: 'Extreme', ale: 'ALE', nokia: 'Nokia', a10: 'A10' };
  function vendorId(v, os) {
    var s = String(v || '').trim().toLowerCase(), o = String(os || '').toLowerCase();
    if (!s) return '';
    if (/^cisco/.test(s)) return 'cisco'; if (/^huawei/.test(s)) return 'huawei'; if (/^juniper/.test(s)) return 'juniper';
    if (/^arista/.test(s)) return 'arista'; if (/^a10/.test(s)) return 'a10'; if (/nokia|^sr\b/.test(s)) return 'nokia';
    if (/^ale|alcatel|omniswitch|^aos/.test(s)) return 'ale';
    if (/voss|fabric engine|^vsp/.test(s)) return 'voss'; if (/exos|switch engine/.test(s)) return 'exos';
    if (/^extreme/.test(s)) return /voss|fabric/.test(o) ? 'voss' : 'exos';
    for (var i = 0; i < VENDORS.length; i++) if (VENDORS[i][0] === s) return s;
    return '';
  }
  var vLabel = function (id) { for (var i = 0; i < VENDORS.length; i++) if (VENDORS[i][0] === id) return VENDORS[i][1]; return id || '—'; };
  function typeId(t) { var s = String(t || '').trim().toLowerCase(); if (!s) return ''; for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === s || TYPES[i][1].toLowerCase() === s) return TYPES[i][0]; if (/라우터|router/.test(s)) return 'router'; if (/l3/.test(s)) return 'l3'; if (/l2/.test(s)) return 'l2'; if (/fw|firewall|방화벽/.test(s)) return 'fw'; if (/adc|l4/.test(s)) return 'adc'; if (/server|서버/.test(s)) return 'server'; return ''; }
  var S = function () { return window.netopsStorage || {}; };
  var toast = function (m) { (S().toast || alert)(m); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ctx() { return window.__nxCtx || {}; }
  function catalog() { return ((window.__nxStoreApi || {}).settings || {}).catalog || []; }
  function catEntry(v, m) { return catalog().find(function (c) { return c.vendor === v && String(c.model).toUpperCase() === String(m || '').toUpperCase(); }); }

  /* ── 포트 계산 ── */
  function speedOf(name) {
    var n = String(name).toLowerCase();
    if (/^(hu|hundredgig|100ge|et-)/.test(n)) return '100G';
    if (/^(te|tengig|xge|xgigabit|xe-|10ge)/.test(n)) return '10G';
    if (/^(gi|gigabit|ge-|ge\d|ge)/.test(n)) return '1G';
    return '*';
  }
  function normSpeed(x) { var s = String(x || '').toUpperCase().replace(/\s/g, ''); return /^(1G|10G|100G)$/.test(s) ? s : ''; }
  function fromList(text) {
    var out = [], bad = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, i) {
      var l = raw.replace(/#.*$/, '').trim(); if (!l) return;
      var f = l.split(/[\s,\t]+/), name = f[0];
      if (!/^[\w./:-]+$/.test(name)) { bad.push((i + 1) + '번째 줄 "' + l + '"'); return; }
      var sp = normSpeed(f[1]) || speedOf(name), md = String(f[2] || '').toUpperCase();
      out.push({ name: name, speed: sp, media: /^(UTP|OPTIC)$/.test(md) ? md : '*' });
    });
    return { ports: out, bad: bad };
  }
  // 슬롯 행 [{slot, card, ports}] → 포트 목록
  function fromSlots(vendor, rows, cards) {
    var cat = window.__nxCat, out = [], bad = [];
    rows.forEach(function (r, i) {
      var slot = String(r.slot || '').trim() || '1', spec = String(r.ports || '').trim(), src = '직접';
      if (r.card) {
        var c = (cards || []).find(function (x) { return x.card.toUpperCase() === String(r.card).toUpperCase() && (!x.vendorId || x.vendorId === vendor || (x.vendorId === 'exos' && vendor === 'voss')); });
        if (!c) { bad.push((i + 1) + '번째 행: 카드 "' + r.card + '"가 카드 목록에 없음'); return; }
        spec = c.ports; src = c.card;
      }
      if (!spec) { bad.push((i + 1) + '번째 행: 카드나 포트구성이 필요'); return; }
      spec = spec.replace(/\$S/g, slot);
      var g = cat.spec(spec);
      if (!g) { bad.push((i + 1) + '번째 행: 포트구성 "' + spec + '"을 읽을 수 없음'); return; }
      if (rows.length > 1 && !/@/.test(spec)) bad.push((i + 1) + '번째 행(' + src + '): 슬롯이 여러 개면 포트 이름을 @로 지정하세요 (예: 48x1G-UTP@GigabitEthernet' + slot + '/0/1) — 기본 규칙 이름이 겹칠 수 있어요');
      cat.expand(vendor, g).forEach(function (p) { out.push(p); });
    });
    return { ports: out, bad: bad };
  }
  function summary(ports) {
    if (!ports.length) return '포트 없음';
    var by = {}; ports.forEach(function (p) { (by[p.speed] = by[p.speed] || []).push(p.name); });
    var names = ports.map(function (p) { return p.name; }), dup = names.length - new Set(names).size;
    return ports.length + '포트 · ' + Object.keys(by).map(function (k) { var a = by[k]; return (k === '*' ? '속도 미상' : k) + ' ' + a.length + '개 (' + a[0] + (a.length > 1 ? ' … ' + a[a.length - 1] : '') + ')'; }).join(' · ') + (dup ? ' · ⚠ 이름 겹침 ' + dup + '개' : '');
  }
  function dupCount(ports) { var n = ports.map(function (p) { return p.name; }); return n.length - new Set(n).size; }

  function getCards() {
    var lp = S().loadPack; if (!lp) return Promise.resolve([]);
    return lp().then(function (p) { RULES = (p.rules || []).map(function (r) { var o = Object.assign({}, r); o.vendorId = vendorId(r.vendor); return o; }); return (p.cards || []).map(function (c) { var o = Object.assign({}, c); o.vendorId = vendorId(c.vendor); return o; }); }).catch(function () { return []; });
  }

  /* ── 구성도에 적용 ── */
  function ensureCatalog(list) {
    var api = window.__nxStoreApi, cat = window.__nxCat; if (!api || !cat) return 0;
    var lines = [];
    list.forEach(function (d) {
      if (!d.vendor || !d.model || catEntry(d.vendor, d.model)) return;
      var os = d.os || (d.vendor === 'voss' ? 'VOSS' : d.vendor === 'exos' ? 'EXOS' : '');
      lines.push([CAT_LABEL[d.vendor], d.model, os].join(', '));
    });
    if (!lines.length) return 0;
    var r = cat.parse(lines.join('\n'));
    if (r.ok.length) api.saveSettings({ catalog: cat.merge(catalog(), r.ok) });
    return r.ok.length;
  }
  var nid = function () { return 'n' + Math.random().toString(36).slice(2, 9); };
  // devs: [{id?, hostname, type, vendor, model, os, hw:{mode, rows, list}|null, ports:[...]|null, clearHw}]
  function applyDevices(devs) {
    var c = ctx(); if (!c.raw || !c.updateTopo) { toast('구성도를 먼저 여세요'); return null; }
    var added = ensureCatalog(devs), made = 0, changed = 0;
    c.updateTopo(c.raw.id, function (t) {
      var maxX = t.nodes.reduce(function (m, n) { return Math.max(m, n.x || 0); }, 0), baseY = t.nodes.reduce(function (m, n) { return Math.min(m, n.y || 0); }, Infinity);
      if (!isFinite(baseY)) baseY = 120;
      var col = 0;
      devs.forEach(function (d) {
        var n = d.id ? t.nodes.find(function (x) { return x.id === d.id; }) : t.nodes.find(function (x) { return String(x.hostname).toLowerCase() === String(d.hostname).toLowerCase(); });
        if (!n) {
          var tp = d.type || (d.vendor === 'a10' ? 'adc' : 'l3');
          n = { id: nid(), hostname: d.hostname, type: tp, role: tp === 'server' ? 'service' : tp === 'l2' ? 'access' : 'core', x: maxX + 200 + (col % 4) * 180, y: baseY + Math.floor(col / 4) * 150, vendor: '', model: '', os: '' };
          col++; t.nodes.push(n); made++;
        } else { changed++; if (d.type) n.type = d.type; }
        if (d.vendor) n.vendor = d.vendor;
        if (d.model != null && d.model !== '') n.model = d.model;
        if (d.os != null && d.os !== '') n.os = d.os;
        if (d.ports && d.ports.length) { n.portList = d.ports.map(function (p) { return { name: p.name, speed: p.speed, media: p.media }; }); n.hw = d.hw; }
        else if (d.clearHw && n.hw) { delete n.hw; delete n.portList; }
      });
      return t;
    });
    return { made: made, changed: changed, catalogAdded: added };
  }

  /* ── 화면 ── */
  var css = '' +
    '.hw-tabs{display:flex;gap:6px;margin:10px 0}.hw-tabs button{font:inherit;font-weight:600;border:1px solid var(--line,#d0d5dd);background:var(--surface-2,#f3f5f7);color:var(--ink,#111418);border-radius:999px;padding:6px 14px;cursor:pointer}.hw-tabs button.on{background:var(--accent,#2b59ff);border-color:var(--accent,#2b59ff);color:#fff}' +
    '.hw-devs{max-height:150px;overflow:auto;border:1px solid var(--line,#e4e7ec);border-radius:10px;padding:6px 8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:2px 10px;background:var(--surface-2,#f7f8fa)}' +
    '.hw-devs label{display:flex;gap:6px;align-items:center;font-size:13px;min-width:0}.hw-devs span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hw-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}.hw-g label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--muted,#5b6573)}' +
    '.hw-g input,.hw-g select,.hw-slot input,.hw-slot select{font:inherit;color:var(--ink,#111418);background:var(--surface,#fff);border:1px solid var(--line,#d0d5dd);border-radius:8px;padding:7px 9px;min-width:0}' +
    '.hw-slot{display:grid;grid-template-columns:70px minmax(0,1.1fr) minmax(0,1.6fr) 34px;gap:6px;margin:4px 0;align-items:center}' +
    '.hw-slot.h{font-size:12px;color:var(--muted,#5b6573)}.hw-x{border:0;background:none;font-size:18px;color:var(--muted,#5b6573);cursor:pointer}' +
    '.hw-modes{display:flex;flex-wrap:wrap;gap:12px;margin:6px 0;font-size:13.5px}.hw-modes label{display:flex;gap:5px;align-items:center}' +
    '.hw-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.hw-tbl th,.hw-tbl td{border-bottom:1px solid var(--line,#e4e7ec);padding:5px 6px;text-align:left;vertical-align:top}.hw-tbl td.e{color:var(--bad,#b4321f)}.hw-wrap{overflow:auto;max-height:280px;margin:8px 0}' +
    '.hw-ta{width:100%;box-sizing:border-box;font:12.5px/1.5 "JetBrains Mono",ui-monospace,monospace;background:var(--surface-2,#f3f5f7);color:var(--ink,#111418);border:1px solid var(--line,#e4e7ec);border-radius:10px;padding:8px 10px;white-space:pre}' +
    '@media (max-width:640px){.hw-slot{grid-template-columns:54px minmax(0,1fr) 30px}.hw-slot .p{grid-column:1 / -2}}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  var RULES = [], RULE = { id: '', speed: '10G', media: 'OPTIC', count: '8', mod: '0', row: '' };
  var ov = null, CARDS = [], STATE = { tab: 'one', mode: 'model', rows: [{ slot: '1', card: '', ports: '' }], list: '', sel: [], vendor: '', model: '', os: '', newHost: '', newType: 'l3', csv: '', rowsCsv: null };
  function close() { if (ov) { ov.remove(); ov = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open(preset) {
    if (!ctx().raw) { var n = document.getElementById('nav-canvas'); if (n) n.click(); setTimeout(function () { open(preset); }, 500); return; }
    if (preset && preset.sel) STATE.sel = preset.sel;
    getCards().then(function (c) { CARDS = c; render(); });
  }
  function render() {
    close();
    ov = document.createElement('div'); ov.className = 'sx-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="sx-card" style="width:min(860px,100%)"><button class="sx-x" data-h="close" aria-label="닫기">×</button>' +
      '<h3>장비 구성 입력</h3><p class="sx-mu">모델·OS와 <b>슬롯/라인카드·모듈</b> 또는 <b>포트 이름 목록</b>만 넣으면 장비의 실제 포트가 만들어져요. 이 포트는 모델 기본 포트보다 우선해서 연결·검증·CONFIG에 쓰여요.</p>' +
      '<div class="hw-tabs"><button data-h="tab-one" class="' + (STATE.tab === 'one' ? 'on' : '') + '">개별 입력 (여러 대 선택 가능)</button><button data-h="tab-csv" class="' + (STATE.tab === 'csv' ? 'on' : '') + '">템플릿 — 여러 장비 일괄</button></div>' +
      '<div id="hw-body"></div></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) return close(); var a = e.target.closest('[data-h]'); if (a) act(a.getAttribute('data-h'), a); });
    ov.addEventListener('input', onInput); ov.addEventListener('change', onInput);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    if (STATE.tab === 'one') renderOne(); else renderCsv();
  }
  function nodes() { return (ctx().raw || {}).nodes || []; }

  /* 개별 입력 */
  function renderOne() {
    var ns = nodes(), b = document.getElementById('hw-body');
    if (!STATE.sel.length && ns.length) { var first = ns[0]; STATE.sel = [first.id]; loadFrom(first); }
    var cardsV = CARDS.filter(function (c) { return !STATE.vendor || c.vendorId === STATE.vendor || (STATE.vendor === 'voss' && c.vendorId === 'exos'); });
    var models = catalog().filter(function (c) { return c.vendor === STATE.vendor; });
    var h = '<h4>① 장비 선택</h4><div class="hw-devs">' + ns.map(function (n) {
      return '<label><input type="checkbox" data-dev="' + n.id + '"' + (STATE.sel.indexOf(n.id) >= 0 ? ' checked' : '') + '><span title="' + esc(n.hostname) + '"><b>' + esc(n.hostname) + '</b> <span class="sx-mu">' + esc((n.model || '모델 미지정') + (n.hw ? ' · 구성입력됨' : n.portList ? ' · 업로드' : '')) + '</span></span></label>';
    }).join('') + '<label><input type="checkbox" data-dev="__new"' + (STATE.sel.indexOf('__new') >= 0 ? ' checked' : '') + '><span><b>+ 새 장비</b></span></label></div>';
    if (STATE.sel.indexOf('__new') >= 0) h += '<div class="hw-g"><label>새 장비 호스트명<input id="hw-newhost" value="' + esc(STATE.newHost) + '" placeholder="예: CORE-01"></label><label>종류<select id="hw-newtype">' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (STATE.newType === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label></div>';
    h += '<h4>② 모델·OS</h4><div class="hw-g"><label>벤더<select id="hw-vendor"><option value="">선택</option>' + VENDORS.map(function (v) { return '<option value="' + v[0] + '"' + (STATE.vendor === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>모델 (목록에 없으면 직접 입력)<input id="hw-model" list="hw-models" value="' + esc(STATE.model) + '" placeholder="예: C9200-48T"><datalist id="hw-models">' + models.map(function (c) { return '<option value="' + esc(c.model) + '">'; }).join('') + '</datalist></label>' +
      '<label>OS<input id="hw-os" value="' + esc(STATE.os) + '" placeholder="예: IOS-XE 17.9"></label></div>';
    var ce = catEntry(STATE.vendor, STATE.model), cs = ce && ce.ports && ce.ports.length ? window.__nxCat.specText(ce.ports) : '';
    h += '<h4>③ 포트 구성 방법</h4><div class="hw-modes">' +
      '<label><input type="radio" name="hw-mode" value="model"' + (STATE.mode === 'model' ? ' checked' : '') + '>모델 기본 포트' + (cs ? ' <span class="sx-mu mono">(' + esc(cs) + ')</span>' : ' <span class="sx-mu">(모델 목록에 포트 구성 없음)</span>') + '</label>' +
      '<label><input type="radio" name="hw-mode" value="slots"' + (STATE.mode === 'slots' ? ' checked' : '') + '>슬롯·라인카드·모듈</label>' +
      '<label><input type="radio" name="hw-mode" value="list"' + (STATE.mode === 'list' ? ' checked' : '') + '>포트 이름 목록 붙여넣기</label></div>';
    if (STATE.mode === 'slots') {
      h += '<p class="sx-mu">슬롯(섀시 슬롯·스택 멤버·모듈 자리)마다 카드를 고르거나 포트구성을 적어요. 포트구성의 <b>$S</b>는 슬롯 번호로 바뀌고, <b>@시작이름</b>으로 이름을 정해요. 고정 포트도 한 행으로 넣으세요.</p>' +
        '<div class="hw-slot h"><span>슬롯</span><span>카드(목록)</span><span class="p">또는 포트구성</span><span></span></div>' +
        STATE.rows.map(function (r, i) {
          return '<div class="hw-slot"><input data-row="' + i + '" data-k="slot" value="' + esc(r.slot) + '" aria-label="슬롯"><select data-row="' + i + '" data-k="card" aria-label="카드"><option value="">— 직접 입력 —</option>' + cardsV.map(function (c) { return '<option value="' + esc(c.card) + '"' + (r.card === c.card ? ' selected' : '') + '>' + esc(c.card + (c.mine ? ' ★' : '')) + '</option>'; }).join('') + '</select>' +
            '<input class="p mono" data-row="' + i + '" data-k="ports" value="' + esc(r.card ? ((cardsV.find(function (c) { return c.card === r.card; }) || {}).ports || '') : r.ports) + '" placeholder="48x1G-UTP@GigabitEthernet$S/0/1"' + (r.card ? ' disabled' : '') + ' aria-label="포트구성"><button class="hw-x" data-h="row-del" data-i="' + i + '" aria-label="행 삭제">×</button></div>';
        }).join('') +
        ruleBar() +
        '<div class="sx-row"><button class="sx-b" data-h="row-add">+ 슬롯 행 추가</button>' + (cs ? '<button class="sx-b" data-h="row-model">모델 기본 포트를 1행으로 넣기</button>' : '') + '<span class="sx-mu">카드 목록: 표준 팩 ' + CARDS.filter(function (c) { return !c.mine; }).length + '종 + 내 카드 ' + CARDS.filter(function (c) { return c.mine; }).length + '종 (저장 폴더 my-pack/my-cards.txt)</span></div>';
    } else if (STATE.mode === 'list') {
      h += '<p class="sx-mu">한 줄에 포트 이름 하나 (뒤에 속도·매체를 붙여도 됨: <span class="mono">Gi1/0/1 1G UTP</span>). 장비의 인터페이스 목록 첫 열만 복사해 붙여도 돼요. 이름만 저장하고 원문은 저장하지 않아요.</p>' +
        '<textarea id="hw-list" class="hw-ta" rows="7" placeholder="GigabitEthernet1/0/1&#10;GigabitEthernet1/0/2&#10;TenGigabitEthernet1/1/1 10G OPTIC">' + esc(STATE.list) + '</textarea>';
    }
    h += '<h4>④ 미리보기</h4><pre class="sx-pre" id="hw-prev" style="max-height:160px"></pre>' +
      '<div class="sx-row"><button class="sx-b p" data-h="apply-one">선택 장비에 적용</button><span class="sx-mu" id="hw-cnt"></span></div>';
    b.innerHTML = h; preview();
  }
  // OS 계열 포트 이름 규칙으로 행 채우기 (섀시·라인카드용)
  function ruleBar() {
    var rs = RULES.filter(function (r) { return !STATE.vendor || r.vendorId === STATE.vendor || (STATE.vendor === 'voss' && r.vendorId === 'exos'); });
    if (!rs.length) return '';
    if (!rs.some(function (r) { return r.id === RULE.id; })) { RULE.id = rs[0].id; RULE.mod = rs[0].mdef || '0'; }
    var r = rs.find(function (x) { return x.id === RULE.id; }), sp = Object.keys(r.tpl);
    if (sp.indexOf(RULE.speed) < 0) RULE.speed = sp[0];
    return '<div class="sx-st" style="flex-wrap:wrap;margin:8px 0"><b style="width:100%">포트 이름 규칙으로 채우기 <span class="sx-mu">(라인카드 포트 수만 넣으면 이름 자동)</span></b>' +
      '<select data-rule="id" aria-label="OS 계열 규칙">' + rs.map(function (x) { return '<option value="' + x.id + '"' + (x.id === RULE.id ? ' selected' : '') + '>' + esc(x.label) + (x.chk ? '' : ' [확인 필요]') + '</option>'; }).join('') + '</select>' +
      '<select data-rule="speed" aria-label="속도">' + sp.map(function (k) { return '<option' + (k === RULE.speed ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>' +
      '<select data-rule="media" aria-label="매체"><option' + (RULE.media === 'OPTIC' ? ' selected' : '') + '>OPTIC</option><option' + (RULE.media === 'UTP' ? ' selected' : '') + '>UTP</option></select>' +
      '<label class="sx-mu">포트 수 <input data-rule="count" value="' + esc(RULE.count) + '" style="width:60px"></label>' +
      (/\$M/.test(r.tpl[RULE.speed]) ? '<label class="sx-mu">모듈/PIC <input data-rule="mod" value="' + esc(RULE.mod) + '" style="width:50px"></label>' : '') +
      '<label class="sx-mu">넣을 행 <select data-rule="row">' + STATE.rows.map(function (x, i) { return '<option value="' + i + '"' + (String(i) === RULE.row ? ' selected' : '') + '>' + (i + 1) + '행 (슬롯 ' + esc(x.slot) + ')</option>'; }).join('') + '<option value="new"' + (RULE.row === 'new' ? ' selected' : '') + '>새 행</option></select></label>' +
      '<button class="sx-b" data-h="rule-fill">채우기</button>' +
      '<span class="sx-mu" style="width:100%">예: ' + esc(previewRule(r)) + (r.note ? ' · ' + esc(r.note) : '') + '</span></div>';
  }
  function ruleSpec(r) {
    var n = parseInt(RULE.count, 10); if (!(n > 0)) return '';
    var md = RULE.speed === '1G' ? RULE.media : 'OPTIC';
    return n + 'x' + RULE.speed + '-' + md + '@' + r.tpl[RULE.speed].replace(/\$M/g, RULE.mod || '0');
  }
  function previewRule(r) {
    var sp = ruleSpec(r); if (!sp) return '포트 수를 넣으세요';
    var g = window.__nxCat.spec(sp.replace(/\$S/g, '1')); if (!g) return sp;
    var ps = window.__nxCat.expand(STATE.vendor || 'cisco', g);
    return '슬롯 1이면 ' + ps[0].name + (ps.length > 1 ? ' … ' + ps[ps.length - 1].name : '');
  }
  function loadFrom(n) {
    STATE.vendor = n.vendor || ''; STATE.model = n.model || ''; STATE.os = n.os || '';
    if (n.hw && n.hw.mode === 'slots') { STATE.mode = 'slots'; STATE.rows = n.hw.rows.map(function (r) { return Object.assign({}, r); }); }
    else if (n.hw && n.hw.mode === 'list') { STATE.mode = 'list'; STATE.list = n.hw.list || ''; }
    else STATE.mode = 'model';
  }
  function compute() {
    if (STATE.mode === 'slots') return fromSlots(STATE.vendor, STATE.rows, CARDS);
    if (STATE.mode === 'list') return fromList(STATE.list);
    var ce = catEntry(STATE.vendor, STATE.model);
    return { ports: ce && ce.ports && ce.ports.length ? window.__nxCat.expand(STATE.vendor, ce.ports) : [], bad: [], model: true };
  }
  function preview() {
    var pv = document.getElementById('hw-prev'); if (!pv) return;
    if (!STATE.vendor) { pv.textContent = '벤더를 고르세요'; return; }
    var r = compute();
    var lines = [summary(r.ports)];
    if (r.model) lines.push('→ 모델 기본 포트를 써요. 입력된 슬롯/목록 구성이 있으면 지워져요.');
    r.bad.forEach(function (b) { lines.push('⚠ ' + b); });
    if (r.ports.length) lines.push('', r.ports.slice(0, 60).map(function (p) { return p.name + '  ' + p.speed + (p.media !== '*' ? ' ' + p.media : ''); }).join('\n') + (r.ports.length > 60 ? '\n… 외 ' + (r.ports.length - 60) + '개' : ''));
    pv.textContent = lines.join('\n');
    var cn = document.getElementById('hw-cnt'); if (cn) cn.textContent = STATE.sel.length + '대 선택됨';
  }
  function onInput(e) {
    var t = e.target;
    if (t.matches('[data-dev]')) {
      var id = t.getAttribute('data-dev');
      if (t.checked) { if (STATE.sel.indexOf(id) < 0) STATE.sel.push(id); if (STATE.sel.length === 1 && id !== '__new') { var n = nodes().find(function (x) { return x.id === id; }); if (n) loadFrom(n); } }
      else STATE.sel = STATE.sel.filter(function (x) { return x !== id; });
      return renderOne();
    }
    if (t.id === 'hw-vendor') { if (STATE.vendor !== t.value) { STATE.model = ''; STATE.os = ''; STATE.rows = [{ slot: '1', card: '', ports: '' }]; } STATE.vendor = t.value; return renderOne(); }
    if (t.id === 'hw-model') { STATE.model = t.value; if (e.type === 'change') return renderOne(); return preview(); }
    if (t.id === 'hw-os') { STATE.os = t.value; return; }
    if (t.id === 'hw-newhost') { STATE.newHost = t.value; return; }
    if (t.id === 'hw-newtype') { STATE.newType = t.value; return; }
    if (t.name === 'hw-mode') { STATE.mode = t.value; return renderOne(); }
    if (t.matches('[data-row]')) { var i = +t.getAttribute('data-row'), k = t.getAttribute('data-k'); STATE.rows[i][k] = t.value; if (k === 'card') return renderOne(); return preview(); }
    if (t.matches('[data-rule]')) { RULE[t.getAttribute('data-rule')] = t.value; if (t.getAttribute('data-rule') === 'id') { var rr = RULES.find(function (x) { return x.id === t.value; }); if (rr) RULE.mod = rr.mdef || '0'; } if (e.type === 'change' || t.tagName === 'SELECT') return renderOne(); return; }
    if (t.id === 'hw-list') { STATE.list = t.value; return preview(); }
    if (t.id === 'hw-csv') { STATE.csv = t.value; STATE.rowsCsv = null; return; }
    if (t.id === 'hw-file') { var f = t.files && t.files[0]; t.value = ''; if (f) f.text().then(function (x) { STATE.csv = x.replace(/^﻿/, ''); renderCsv(); checkCsv(); }); }
  }
  function applyOne() {
    if (!STATE.vendor) return toast('벤더를 고르세요');
    if (!STATE.sel.length) return toast('장비를 하나 이상 고르세요');
    var r = compute();
    if (!r.model && !r.ports.length) return toast('포트가 하나도 없어요 — 입력을 확인하세요');
    if (dupCount(r.ports)) return toast('포트 이름이 겹쳐요 — @로 이름을 지정하세요');
    var hw = r.model ? null : (STATE.mode === 'slots' ? { mode: 'slots', rows: STATE.rows.map(function (x) { return { slot: x.slot, card: x.card, ports: x.card ? '' : x.ports }; }) } : { mode: 'list', list: STATE.list });
    var devs = STATE.sel.map(function (id) {
      if (id === '__new') { var hn = STATE.newHost.trim(); if (!hn) return null; return { hostname: hn, type: STATE.newType, vendor: STATE.vendor, model: STATE.model.trim(), os: STATE.os.trim(), hw: hw, ports: r.model ? null : r.ports, clearHw: r.model }; }
      return { id: id, vendor: STATE.vendor, model: STATE.model.trim(), os: STATE.os.trim(), hw: hw, ports: r.model ? null : r.ports, clearHw: r.model };
    }).filter(Boolean);
    if (!devs.length) return toast('새 장비 호스트명을 넣으세요');
    var res = applyDevices(devs); if (!res) return;
    toast('적용: ' + devs.length + '대 (새 장비 ' + res.made + ')' + (res.catalogAdded ? ' · 모델 목록에 ' + res.catalogAdded + '개 추가' : ''));
    STATE.newHost = ''; STATE.sel = STATE.sel.filter(function (x) { return x !== '__new'; });
    setTimeout(renderOne, 300);
  }

  /* 템플릿(CSV) */
  var COLS = ['hostname', 'type', 'vendor', 'model', 'os', 'slot', 'card', 'ports'];
  var GUIDE = [
    '# NetOps 장비 구성 템플릿 — 한 행 = 장비 1대의 슬롯(모듈) 1개. 같은 hostname 행은 한 장비로 합쳐짐',
    '# type: router / l3 / l2 / fw / adc / server (비우면 l3)   vendor: Cisco, Huawei, Juniper, Arista, Extreme EXOS, Extreme VOSS, ALE, Nokia, A10',
    '# slot·card·ports를 모두 비우면 모델 기본 포트 사용.  card = 카드 목록 이름(표준 팩·my-cards.txt)  ports = 포트구성 (예: 48x1G-UTP@GigabitEthernet$S/0/1, $S=slot 번호)',
    '# # 으로 시작하는 줄은 무시. 엑셀에서 열어 행을 추가한 뒤 CSV로 저장해 가져오세요.'
  ];
  var SAMPLE = [
    ['ACC-SW-01', 'l2', 'Cisco', 'C9200L-48T-4X', 'IOS-XE 17.9', '', '', ''],
    ['ACC-SW-02', 'l2', 'Cisco', 'C9200-48T', 'IOS-XE 17.9', '1', '', '48x1G-UTP@GigabitEthernet1/0/1'],
    ['ACC-SW-02', '', '', '', '', '1', 'C9200-NM-4X', ''],
    ['CORE-01', 'l3', 'Huawei', 'S6730-H48X6C', 'VRP V200R021', '', '', ''],
    ['EXAMPLE-CHASSIS', 'router', 'Cisco', '예시-섀시(모델명으로 바꾸세요)', '', '1', '', '48x1G-UTP@GigabitEthernet1/0/1'],
    ['EXAMPLE-CHASSIS', '', '', '', '', '2', '', '8x10G-OPTIC@TenGigabitEthernet2/0/1']
  ];
  function csvLine(a) { return a.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }
  function parseCsv(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/), out = [];
    var delim = lines.some(function (l) { return l.indexOf('\t') >= 0; }) ? '\t' : ',';
    lines.forEach(function (raw, i) {
      if (!raw.trim() || /^\s*#/.test(raw)) return;
      var f = [], cur = '', q = false;
      for (var k = 0; k < raw.length; k++) { var ch = raw[k]; if (q) { if (ch === '"' && raw[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === delim) { f.push(cur); cur = ''; } else cur += ch; }
      f.push(cur);
      f = f.map(function (x) { return x.trim(); });
      if (f[0].toLowerCase() === 'hostname') return;
      var o = { line: i + 1 }; COLS.forEach(function (c, j) { o[c] = f[j] || ''; }); out.push(o);
    });
    return out;
  }
  function groupCsv(rows) {
    var map = {}, order = [];
    rows.forEach(function (r) {
      var k = r.hostname.toLowerCase();
      if (!r.hostname) { (map['__bad'] = map['__bad'] || { hostname: '', lines: [], errs: [] }).errs.push(r.line + '행: hostname 없음'); return; }
      if (!map[k]) { map[k] = { hostname: r.hostname, type: '', vendorRaw: '', model: '', os: '', slots: [], lines: [], errs: [] }; order.push(k); }
      var d = map[k]; d.lines.push(r.line);
      if (r.type) d.type = r.type; if (r.vendor) d.vendorRaw = r.vendor; if (r.model) d.model = r.model; if (r.os) d.os = r.os;
      if (r.slot || r.card || r.ports) d.slots.push({ slot: r.slot, card: r.card, ports: r.ports, line: r.line });
    });
    var list = order.map(function (k) { return map[k]; });
    var exist = {}; nodes().forEach(function (n) { exist[String(n.hostname).toLowerCase()] = n; });
    list.forEach(function (d) {
      var n = exist[d.hostname.toLowerCase()];
      d.node = n || null;
      d.vendor = vendorId(d.vendorRaw, d.os) || (n && n.vendor) || '';
      if (d.vendorRaw && !vendorId(d.vendorRaw, d.os)) d.errs.push('vendor "' + d.vendorRaw + '"를 모름');
      if (!d.vendor) d.errs.push('vendor 필요');
      d.typeId = typeId(d.type); if (d.type && !d.typeId) d.errs.push('type "' + d.type + '"를 모름');
      if (d.slots.length && d.vendor) {
        var r = fromSlots(d.vendor, d.slots, CARDS);
        r.bad.forEach(function (b) { var m = b.match(/^(\d+)번째 행/); d.errs.push(m ? b.replace(/^\d+번째 행/, d.slots[+m[1] - 1].line + '행') : b); });
        d.ports = r.ports; if (dupCount(r.ports)) d.errs.push('포트 이름 겹침 ' + dupCount(r.ports) + '개 — @로 지정');
      } else d.ports = null;
      d.fatal = d.errs.some(function (e) { return !/@로 지정하세요/.test(e); });
    });
    if (map['__bad']) list.push(Object.assign(map['__bad'], { fatal: true, vendor: '', ports: null }));
    return list;
  }
  function renderCsv() {
    var b = document.getElementById('hw-body'); if (!b) return;
    b.innerHTML = '<p class="sx-mu">양식(CSV)을 받아 엑셀에서 장비를 행으로 채운 뒤 가져오세요. 한 행 = 장비 1대의 슬롯(모듈) 1개, 같은 hostname은 한 장비로 합쳐져요. 이미 있는 hostname은 <b>수정</b>, 없으면 <b>새 장비</b>로 구성도에 추가돼요.</p>' +
      '<div class="sx-row"><button class="sx-b" data-h="csv-template">양식 받기 (예시 포함)</button><button class="sx-b" data-h="csv-export">현재 구성도 장비 내보내기</button><label class="sx-b" style="display:inline-flex;align-items:center">CSV 파일 가져오기<input type="file" id="hw-file" accept=".csv,.txt,.tsv" hidden></label></div>' +
      '<label class="sx-mu" for="hw-csv">또는 여기에 붙여넣기 (엑셀에서 복사해도 됨)</label><textarea id="hw-csv" class="hw-ta" rows="6" placeholder="hostname,type,vendor,model,os,slot,card,ports">' + esc(STATE.csv) + '</textarea>' +
      '<div class="sx-row"><button class="sx-b" data-h="csv-check">검사</button><button class="sx-b p" data-h="csv-apply">구성도에 적용</button><span class="sx-mu" id="hw-csvmsg"></span></div><div class="hw-wrap" id="hw-csvres"></div>';
  }
  function checkCsv() {
    var rows = parseCsv(STATE.csv), list = groupCsv(rows); STATE.rowsCsv = list;
    var ok = list.filter(function (d) { return !d.fatal; }).length;
    document.getElementById('hw-csvmsg').textContent = '장비 ' + list.length + '대 · 적용 가능 ' + ok + '대' + (list.length - ok ? ' · 오류 ' + (list.length - ok) + '대(적용 안 함)' : '');
    document.getElementById('hw-csvres').innerHTML = '<table class="hw-tbl"><thead><tr><th>hostname</th><th>구분</th><th>벤더 · 모델 · OS</th><th>포트</th><th>확인</th></tr></thead><tbody>' + list.map(function (d) {
      return '<tr><td><b>' + esc(d.hostname || '—') + '</b><div class="sx-mu">' + (d.lines || []).join(',') + '행</div></td><td>' + (d.node ? '수정' : '새 장비') + '</td><td>' + esc(vLabel(d.vendor) + ' · ' + (d.model || (d.node && d.node.model) || '—') + ' · ' + (d.os || '—')) + '</td><td>' + esc(d.ports ? summary(d.ports) : '모델 기본') + '</td><td class="' + (d.errs.length ? 'e' : '') + '">' + (d.errs.length ? esc(d.errs.join(' / ')) : '✓') + '</td></tr>';
    }).join('') + '</tbody></table>';
    return list;
  }
  function applyCsv() {
    var list = STATE.rowsCsv || checkCsv();
    var good = list.filter(function (d) { return !d.fatal; });
    if (!good.length) return toast('적용할 장비가 없어요 — 오류를 고치세요');
    var devs = good.map(function (d) { return { id: d.node ? d.node.id : null, hostname: d.hostname, type: d.typeId, vendor: d.vendor, model: d.model, os: d.os, hw: d.ports ? { mode: 'slots', rows: d.slots.map(function (s) { return { slot: s.slot, card: s.card, ports: s.card ? '' : s.ports }; }) } : null, ports: d.ports, clearHw: !d.slots.length }; });
    var res = applyDevices(devs); if (!res) return;
    toast('템플릿 적용: 수정 ' + res.changed + '대 · 새 장비 ' + res.made + '대' + (res.catalogAdded ? ' · 모델 목록 +' + res.catalogAdded : ''));
    STATE.rowsCsv = null; setTimeout(function () { checkCsv(); }, 300);
  }
  function exportCsv() {
    var rows = [COLS];
    nodes().forEach(function (n) {
      var base = [n.hostname, n.type || '', vLabel(n.vendor), n.model || '', n.os || ''];
      if (n.hw && n.hw.mode === 'slots' && n.hw.rows.length) n.hw.rows.forEach(function (r, i) { rows.push((i ? ['' + n.hostname, '', '', '', ''] : base).concat([r.slot || '', r.card || '', r.ports || ''])); });
      else if (n.portList && n.portList.length && (!n.hw || n.hw.mode === 'list')) rows.push(base.concat(['', '', listToSpec(n)]));
      else rows.push(base.concat(['', '', '']));
    });
    var text = '﻿' + GUIDE.join('\n') + '\n' + rows.map(csvLine).join('\n') + '\n';
    S().download('netops-devices-' + (S().stamp ? S().stamp() : 'export') + '.csv', new Blob([text], { type: 'text/csv' }));
  }
  // 포트 목록 → 연속 구간을 @지정 포트구성으로 압축 (내보내기용)
  function listToSpec(n) {
    var groups = [], cur = null;
    n.portList.forEach(function (p) {
      var m = String(p.name).match(/^(.*?)(\d+)(\D*)$/); if (!m) { cur = null; groups.push({ count: 1, speed: p.speed, media: p.media, tpl: p.name, start: null }); return; }
      var sp = p.speed === '*' ? '1G' : p.speed, md = p.media === '*' ? (sp === '1G' ? 'UTP' : 'OPTIC') : p.media;
      if (cur && cur.pre === m[1] && cur.suf === m[3] && cur.next === +m[2] && cur.speed === sp && cur.media === md) { cur.count++; cur.next++; }
      else { cur = { pre: m[1], suf: m[3], start: +m[2], next: +m[2] + 1, count: 1, speed: sp, media: md }; groups.push(cur); }
    });
    return groups.map(function (g) { return g.count + 'x' + g.speed + '-' + g.media + '@' + (g.pre == null ? g.tpl : g.suf ? g.pre + '{' + g.start + '}' + g.suf : g.pre + g.start); }).join('+');
  }

  function act(a, el) {
    if (a === 'close') close();
    else if (a === 'tab-one') { STATE.tab = 'one'; render(); }
    else if (a === 'tab-csv') { STATE.tab = 'csv'; render(); }
    else if (a === 'row-add') { var last = STATE.rows[STATE.rows.length - 1]; STATE.rows.push({ slot: String((+(last && last.slot) || 0) + 1), card: '', ports: '' }); renderOne(); }
    else if (a === 'row-del') { STATE.rows.splice(+el.getAttribute('data-i'), 1); if (!STATE.rows.length) STATE.rows.push({ slot: '1', card: '', ports: '' }); renderOne(); }
    else if (a === 'row-model') { var ce = catEntry(STATE.vendor, STATE.model); if (ce) { var ps = window.__nxCat.expand(STATE.vendor, ce.ports); STATE.rows.unshift({ slot: '1', card: '', ports: listToSpec({ portList: ps }) }); renderOne(); } }
    else if (a === 'apply-one') applyOne();
    else if (a === 'rule-fill') {
      var r = RULES.find(function (x) { return x.id === RULE.id; }), sp = r && ruleSpec(r);
      if (!sp) return toast('포트 수를 넣으세요');
      var i = RULE.row === 'new' || RULE.row === '' && false ? -1 : parseInt(RULE.row || '0', 10);
      if (RULE.row === 'new' || !(i >= 0) || !STATE.rows[i]) { var last = STATE.rows[STATE.rows.length - 1]; STATE.rows.push({ slot: String((+(last && last.slot) || 0) + 1), card: '', ports: sp }); RULE.row = String(STATE.rows.length - 1); }
      else { STATE.rows[i].card = ''; STATE.rows[i].ports = STATE.rows[i].ports && STATE.rows[i].ports.trim() ? STATE.rows[i].ports + '+' + sp : sp; }
      renderOne();
    }
    else if (a === 'csv-template') { var text = '﻿' + GUIDE.join('\n') + '\n' + [COLS].concat(SAMPLE).map(csvLine).join('\n') + '\n'; S().download('netops-devices-template.csv', new Blob([text], { type: 'text/csv' })); }
    else if (a === 'csv-export') exportCsv();
    else if (a === 'csv-check') checkCsv();
    else if (a === 'csv-apply') applyCsv();
  }

  /* 왼쪽 메뉴: '장비 구성 입력' (장비 목록 아래, 없으면 구성도 아래) */
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></svg>';
  function ensure() {
    var anchor = document.getElementById('nav-inventory') || document.getElementById('nav-canvas'), mine = document.getElementById('nav-hw');
    if (!anchor) return;
    if (!mine) { mine = document.createElement('button'); mine.id = 'nav-hw'; mine.type = 'button'; mine.addEventListener('click', function (e) { e.preventDefault(); var sc = document.querySelector('.nav-scrim'); if (sc && window.innerWidth < 900) sc.click(); open(); }); }
    if (mine.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', mine);
    var cls = anchor.className.replace(/\b(active|is-active|current|on)\b/g, '').replace(/\s+/g, ' ').trim(); if (mine.className !== cls) mine.className = cls;
    var html = ICON + '<span>장비 구성 입력</span>'; if (mine.getAttribute('data-h') !== html) { mine.innerHTML = html; mine.setAttribute('data-h', html); }
    var cnt = anchor.parentElement && anchor.parentElement.querySelector('.sec-count'); if (cnt) { var n = anchor.parentElement.querySelectorAll('.nav-item').length; if (cnt.textContent !== String(n)) cnt.textContent = String(n); }
  }
  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensure(); }); });
  function start() { ensure(); mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.netopsHW = { open: open, _parseCsv: parseCsv, _fromSlots: fromSlots, _fromList: fromList, _listToSpec: listToSpec };
})();
