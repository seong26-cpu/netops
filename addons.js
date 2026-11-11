/* NetOps 보조 기능 (앱 본체와 따로 동작)
   1) __nxApply: 검토용 CONFIG → 장비 적용용 텍스트
   2) 운용 도구 5종: 원복 CONFIG · 장비↔설계 비교 · IP 계획표 · 점검 명령 · 변경 이력
   앱 본체가 window.__nxFn(계산 함수)·window.__nxCtx(현재 구성도)를 넘겨 준다. */
(function () {
  'use strict';
  var MARK = /\s+! \[확인 필요\]$/;
  // 적용용: [확인 필요] 줄은 표시만 지우지 않고 주석으로 바꿔 실행되지 않게 한다.
  // 머리 줄(들여쓰기 0)이 미확인이면 그 아래 들여쓴 줄도 함께 주석 처리(엉뚱한 위치에서 실행 방지).
  window.__nxApply = function (vendor, text) {
    var lines = String(text || '').split('\n');
    var cm = (vendor === 'cisco' || vendor === 'arista' || vendor === 'a10') ? '!' : '#';
    var need = 0; var out = []; var skipKids = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var indented = /^\s/.test(l);
      if (!indented) skipKids = false;
      if (MARK.test(l)) {
        l = l.replace(MARK, '');
        if (!/^\s*[!#]?\s*$/.test(l)) { need++; out.push(cm + ' [미확인-실행 안 함] ' + l.trim()); if (!indented) skipKids = true; continue; }
      }
      if (skipKids && indented && l.trim()) { out.push(cm + ' [미확인-실행 안 함]   ' + l.trim()); need++; continue; }
      if (/^!/.test(l)) { if (cm === '!') out.push(l); else if (l.replace(/^!\s*/, '')) out.push('#' + l.slice(1)); continue; }
      out.push(l);
    }
    if (need) out.splice(1, 0, cm + ' 주의: 출처 확인 전 문법 ' + need + '줄은 주석(' + cm + ')으로 바꿔 실행되지 않게 했습니다 — 검토 후 직접 주석을 풀어 적용');
    return out.join('\n');
  };

  var FN = function () { return window.__nxFn; };
  var CTX = function () { return window.__nxCtx || {}; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var VN = { cisco: 'Cisco', huawei: 'Huawei', juniper: 'Juniper', arista: 'Arista', exos: 'Extreme EXOS', voss: 'Extreme VOSS', ale: 'ALE', nokia: 'Nokia', a10: 'A10' };
  var isNx = function (n) { return /nx/i.test(n.os || '') || /nexus|^n\d?k/i.test(n.model || ''); };
  function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function saveFile(name, data) { var f = FN(); if (f && f.save) return f.save(name, data, toast); var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain' })); a.download = name; a.click(); }
  function copy(text) { var done = function () { toast('복사했습니다'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('복사하지 못했습니다 — 파일 저장을 쓰세요'); }); else toast('복사하지 못했습니다 — 파일 저장을 쓰세요'); }

  // ---------- 생성 CONFIG → 블록 ----------
  function cfgLines(topo, node) {
    var f = FN(); var cfg = f.deviceConfig(topo, node.id);
    var out = [];
    cfg.sections.forEach(function (s) { s.lines.forEach(function (l) { out.push(l.text); }); });
    return out;
  }
  // [{h:'interface X', kids:[' ip address ..']}] — 들여쓰기 0 줄이 머리, 그 아래 들여쓴 줄이 자식
  function toBlocks(lines, vendor) {
    var blocks = []; var cur = null;
    lines.forEach(function (raw) {
      var t = raw.replace(/\s+$/, '');
      if (!t.trim() || /^\s*!/.test(t) || /^\s*(quit|exit|return|system-view|exit-address-family)\s*$/.test(t)) return;
      if (vendor === 'juniper') { blocks.push({ h: t.trim(), kids: [] }); cur = null; return; }
      var ind = t.match(/^\s*/)[0].length;
      if (ind === 0) { cur = blocks.filter(function (b) { return b.h === t; })[0]; if (!cur) { cur = { h: t, kids: [] }; blocks.push(cur); } cur.stack = []; }
      else if (cur) {
        // 상위 문맥(예: ospf → area → network)을 경로로 보존
        while (cur.stack.length && cur.stack[cur.stack.length - 1].ind >= ind) cur.stack.pop();
        var path = cur.stack.map(function (x) { return x.t; }), pind = cur.stack.map(function (x) { return x.ind; });
        cur.kids.push({ t: t.trim(), ind: ind, path: path, pind: pind });
        cur.stack.push({ t: t.trim(), ind: ind });
      }
      else blocks.push({ h: t.trim(), kids: [] });
    });
    return blocks;
  }
  function diffBlocks(before, after) { // after에만 있는 것
    var out = [];
    after.forEach(function (b) {
      var o = before.filter(function (x) { return x.h === b.h; })[0];
      if (!o) { out.push({ h: b.h, isNew: true, kids: b.kids }); return; }
      var key = function (k) { return (k.path || []).join('\u0001') + '\u0001' + k.t; };
      var had = {}; o.kids.forEach(function (k) { had[key(k)] = 1; });
      var ks = b.kids.filter(function (k) { return !had[key(k)]; });
      if (ks.length) out.push({ h: b.h, isNew: false, kids: ks });
    });
    return out;
  }
  var once = function (arr, line) { if (arr.indexOf(line) < 0) arr.push(line); };
  // 자식 줄 하나를 되돌리는 줄
  function negKidCisco(c) {
    if (c === 'no shutdown') return null;
    if (c === 'no switchport') return null; // 포트 방식(L2/L3)은 건드리지 않음
    if (/^no /.test(c)) return c.slice(3);
    var m;
    if (/^description/.test(c)) return 'no description';
    if (/^ip address/.test(c)) return 'no ip address';
    if (/^speed/.test(c)) return 'no speed';
    if (/^mtu/.test(c)) return 'no mtu';
    if (/^channel-group/.test(c)) return 'no channel-group';
    if ((m = c.match(/^vrrp (\d+) address-family ipv4/))) return 'no vrrp ' + m[1] + ' address-family ipv4';
    if ((m = c.match(/^vrrp (\d+) /))) return 'no vrrp ' + m[1];
    if ((m = c.match(/^standby (\d+) /))) return 'no standby ' + m[1];
    if (/^switchport trunk allowed vlan/.test(c)) return 'no switchport trunk allowed vlan';
    if (/^switchport mode/.test(c)) return 'no switchport mode';
    if (/^switchport port-security/.test(c)) return 'no switchport port-security';
    if (/^bfd interval/.test(c)) return 'no bfd interval';
    if (/^priority-flow-control priority/.test(c)) return 'no ' + c;
    return 'no ' + c;
  }
  function negKidHuawei(c) {
    if (c === 'undo portswitch') return null;
    if (c === 'undo shutdown') return null;
    if (/^undo /.test(c)) return c.slice(5);
    var m;
    if (/^description/.test(c)) return 'undo description';
    if (/^ip address/.test(c)) return 'undo ip address';
    if (/^ip binding vpn-instance/.test(c)) return 'undo ' + c;
    if ((m = c.match(/^traffic-filter (inbound|outbound)/))) return 'undo traffic-filter ' + m[1];
    if ((m = c.match(/^traffic-policy \S+ (inbound|outbound)/))) return 'undo traffic-policy ' + m[1];
    if ((m = c.match(/^vrrp vrid (\d+)/))) return 'undo vrrp vrid ' + m[1];
    if (/^eth-trunk/.test(c)) return 'undo eth-trunk';
    if (/^port link-type/.test(c)) return 'undo port link-type';
    if (/^stp edged-port/.test(c)) return 'undo stp edged-port';
    if (/^dcb pfc enable/.test(c)) return 'undo dcb pfc enable';
    if (/^mode lacp/.test(c)) return 'undo mode';
    return 'undo ' + c;
  }
  // 문맥 안의 한 줄을 지우는 명령
  function negCtx(c, hw, un) {
    var m;
    if (/^(no|undo) /.test(c)) return c.replace(/^(no|undo) /, '');
    if (hw && (m = c.match(/^peer (\S+) as-number/))) return 'undo peer ' + m[1];
    if (!hw && (m = c.match(/^neighbor (\S+) remote-as/))) return 'no neighbor ' + m[1];
    return un + c;
  }
  // changes: diffBlocks 결과(추가된 것) / readd: 지워진 것(되돌릴 때 다시 넣음)
  function rollbackLines(vendor, added, removed) {
    var out = []; var warn = [];
    var rev = added.slice().reverse();
    if (vendor === 'juniper') {
      rev.forEach(function (b) { out.push(b.h.replace(/^set /, 'delete ')); });
      (removed || []).forEach(function (b) { out.push(b.h); });
      return { lines: out, warn: warn };
    }
    var hw = vendor === 'huawei';
    var un = hw ? 'undo ' : 'no ';
    var close = hw ? ' quit' : '!';
    rev.forEach(function (b) {
      var h = b.h; var m;
      var kidsTop = b.kids.length ? Math.min.apply(null, b.kids.map(function (k) { return k.ind; })) : 0;
      var kids = b.kids.filter(function (k) { return k.ind === kidsTop; }).map(function (k) { return k.t; }).reverse();
      if (/^interface /i.test(h)) {
        var logical = /^interface (loopback|vlan|vlanif|port-?channel|eth-trunk|vxlan|nve|vbdif)/i.test(h);
        if (b.isNew && logical) { out.push(un + h); return; }
        var ls = [];
        kids.forEach(function (c) { var n = hw ? negKidHuawei(c) : negKidCisco(c); if (n) once(ls, ' ' + n); });
        if (ls.length) { out.push(h); ls.forEach(function (x) { out.push(x); }); out.push(close); }
        return;
      }
      if (!b.isNew) { // 기존 블록 안에 줄만 추가됨 → 상위 문맥(area·address-family 등)에 들어가 그 줄만 지움
        var addedKey = {}; b.kids.forEach(function (k) { addedKey[(k.path || []).concat([k.t]).join('\u0001')] = 1; });
        // 뿌리: 조상 중 새로 추가된 줄이 없는 줄 (새 문맥이면 문맥째 지움)
        var roots = b.kids.filter(function (k) { var p = k.path || []; for (var i = 1; i <= p.length; i++) if (addedKey[p.slice(0, i).join('\u0001')]) return false; return true; });
        var l2 = [];
        roots.slice().reverse().forEach(function (k) {
          if (/^(quit|exit)/.test(k.t)) return;
          var p = k.path || [], pi = k.pind || [];
          p.forEach(function (x, i) { l2.push(' '.repeat(pi[i] || (i + 1)) + x); });
          l2.push(' '.repeat(k.ind || 1) + negCtx(k.t, hw, un));
          for (var i = p.length - 1; i >= 0; i--) l2.push(' '.repeat(pi[i] || (i + 1)) + (hw ? 'quit' : /^address-family/.test(p[i]) ? 'exit-address-family' : 'exit'));
        });
        if (l2.length) { var hh = h, mo; if (hw && (mo = h.match(/^ospf (\d+)/))) hh = 'ospf ' + mo[1]; /* 기존 프로세스는 번호로만 진입 */ out.push(hh); l2.forEach(function (x) { out.push(x); }); out.push(close); }
        return;
      }
      if (/^(hostname|sysname)\b/.test(h)) return;
      if (hw) {
        if ((m = h.match(/^ospf (\d+)/))) { out.push('undo ospf ' + m[1]); warn.push('OSPF ' + m[1] + ' 프로세스 전체를 지웁니다'); return; }
        if (/^bgp \d+/.test(h)) { out.push('undo bgp'); warn.push('BGP 전체를 지웁니다 — 기존에 BGP가 있었다면 이 줄은 빼세요'); return; }
        if ((m = h.match(/^acl (?:number )?(\d+)/))) { out.push('undo acl ' + m[1]); return; }
        if (/^dcb pfc$/.test(h)) { warn.push('dcb pfc 프로파일은 수동으로 원복하세요'); return; }
        out.push(/^undo /.test(h) ? h.slice(5) : 'undo ' + h); return;
      }
      if (/^router bgp/.test(h)) warn.push('BGP 전체를 지웁니다 — 기존에 BGP가 있었다면 이 줄은 빼고 neighbor만 지우세요');
      if (/^router ospf/.test(h)) warn.push(h + ' 프로세스 전체를 지웁니다');
      if (/^mlag/.test(h)) { out.push('no mlag configuration'); return; }
      out.push(/^no /.test(h) ? h.slice(3) : 'no ' + h);
    });
    (removed || []).forEach(function (b) {
      out.push(b.h);
      var opened = [];
      b.kids.forEach(function (k) {
        var p = k.path || [], pi = k.pind || [];
        // 필요한 상위 문맥만 다시 열기
        var same = 0; while (same < opened.length && same < p.length && opened[same] === p[same]) same++;
        for (var i = opened.length - 1; i >= same; i--) out.push(' '.repeat(i + 1) + (hw ? 'quit' : /^address-family/.test(opened[i]) ? 'exit-address-family' : 'exit'));
        opened = opened.slice(0, same);
        for (var j = same; j < p.length; j++) { out.push(' '.repeat(pi[j] || (j + 1)) + p[j]); opened.push(p[j]); }
        out.push(' '.repeat(k.ind || 1) + k.t);
      });
      for (var i = opened.length - 1; i >= 0; i--) out.push(' '.repeat(i + 1) + (hw ? 'quit' : /^address-family/.test(opened[i]) ? 'exit-address-family' : 'exit'));
      if (b.kids.length) out.push(close);
    });
    return { lines: out, warn: warn };
  }
  function rollbackFor(node, topoAfter, topoBefore) {
    var v = node.vendor;
    if (['cisco', 'arista', 'huawei', 'juniper'].indexOf(v) < 0) return { text: '', skip: (VN[v] || v || '벤더 미지정') + ': 원복 CONFIG는 Cisco·Arista·Huawei·Juniper만 만듭니다' };
    var after = toBlocks(cfgLines(topoAfter, node), v);
    var nb = topoBefore && topoBefore.nodes.filter(function (x) { return x.id === node.id; })[0];
    var before = nb ? toBlocks(cfgLines(topoBefore, nb), v) : [];
    var added = diffBlocks(before, after); var removed = topoBefore ? diffBlocks(after, before) : [];
    var r = rollbackLines(v, added, removed);
    if (!r.lines.length) return { text: '', skip: '되돌릴 줄이 없습니다' };
    var cm = (v === 'cisco' || v === 'arista') ? '!' : '#';
    var head = [cm + ' ===== ' + node.hostname + ' 원복(Rollback) — ' + (topoBefore ? '선택한 저장의 변경분만' : '앱이 만든 설정 전체') + ' =====',
      cm + ' 규칙으로 만든 초안입니다(no/undo/delete). 적용 전 장비에서 한 줄씩 확인하세요.'];
    r.warn.forEach(function (w) { head.push(cm + ' 주의: ' + w); });
    if (v === 'juniper') head.push('# 방금 commit한 변경만 되돌릴 때는 Junos 기본 기능이 더 안전합니다: configure → rollback 1 → commit');
    if (v === 'huawei') head.push('system-view');
    if (v === 'cisco' || v === 'arista') head.push('configure terminal');
    if (v === 'juniper') head.push('configure');
    var tail = v === 'juniper' ? ['commit confirmed 5', '# 이상 없으면 5분 안에 commit 을 한 번 더 입력 (입력하지 않으면 자동으로 되돌아감)'] : v === 'huawei' ? ['return'] : ['end'];
    return { text: head.concat(r.lines, tail).join('\n'), count: r.lines.length };
  }

  // ---------- 장비(업로드) ↔ 설계(앱) 비교 ----------
  var nIf = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); };
  function compareNode(topo, node) {
    var f = FN(); var up = node.parsed; if (!up) return null;
    var cfg = f.deviceConfig(topo, node.id);
    var text = f.configText(node, cfg).split('\n').map(function (l) { return l.replace(MARK, ''); }).join('\n');
    var de = f.parse(text, { vendor: node.vendor, hostname: node.hostname });
    var rows = [];
    var add = function (cat, item, a, b) { var k = (a == null || a === '') ? '설계에만 있음 (추가 필요)' : (b == null || b === '') ? '장비에만 있음' : '값 다름 (변경 필요)'; rows.push({ cat: cat, item: item, up: a == null ? '' : String(a), de: b == null ? '' : String(b), kind: k }); };
    var upIf = {}; Object.keys(up.ifaces).forEach(function (k) { upIf[nIf(k)] = up.ifaces[k]; });
    var only = [];
    Object.keys(de.ifaces).forEach(function (k) {
      var d = de.ifaces[k]; var u = upIf[nIf(k)];
      if (!u) { add('인터페이스', k, '', d.ip || '(설정)'); return; }
      [['IP', 'ip'], ['VRF', 'vrf'], ['Description', 'desc'], ['ACL in', 'aclIn'], ['ACL out', 'aclOut'], ['MTU', 'mtu'], ['PBR', 'pbr']].forEach(function (p) {
        var a = u[p[1]] || ''; var b = d[p[1]] || '';
        if (String(a) !== String(b) && (a || b)) { if (p[1] === 'mtu' && !b) return; if (p[1] === 'desc' && !b) return; add('인터페이스', k + ' · ' + p[0], a || '(없음)', b || '(없음)'); }
      });
      if (u.shutdown) add('인터페이스', k + ' · 상태', 'shutdown', 'no shutdown');
    });
    var deIf = {}; Object.keys(de.ifaces).forEach(function (k) { deIf[nIf(k)] = 1; });
    Object.keys(up.ifaces).forEach(function (k) { if (!deIf[nIf(k)] && up.ifaces[k].ip) only.push(k + ' ' + up.ifaces[k].ip); });
    var setOf = function (dev, fn) { var m = {}; fn(dev).forEach(function (x) { m[x[0]] = x[1]; }); return m; };
    var cmp = function (cat, a, b) {
      Object.keys(b).forEach(function (k) { if (!(k in a)) add(cat, k, '', b[k] || '(있음)'); else if (String(a[k]) !== String(b[k])) add(cat, k, a[k], b[k]); });
      Object.keys(a).forEach(function (k) { if (!(k in b)) add(cat, k, a[k] || '(있음)', ''); });
    };
    cmp('OSPF network', setOf(up, function (d) { var o = []; d.ospf.forEach(function (p) { p.networks.forEach(function (n) { o.push([n.net + '/' + n.prefix, 'area ' + n.area]); }); }); return o; }),
      setOf(de, function (d) { var o = []; d.ospf.forEach(function (p) { p.networks.forEach(function (n) { o.push([n.net + '/' + n.prefix, 'area ' + n.area]); }); }); return o; }));
    var nb = function (d) { return d.bgp ? Object.keys(d.bgp.neighbors).map(function (k) { var n = d.bgp.neighbors[k]; return [(n.vrf ? n.vrf + ' ' : '') + n.ip, 'AS ' + (n.remoteAs || '?') + (n.rrClient ? ' · RR client' : '') + (n.updSrc ? ' · src ' + n.updSrc : '')]; }) : []; };
    if ((up.bgp || de.bgp) && (up.bgp ? up.bgp.as : '') !== (de.bgp ? de.bgp.as : '')) add('BGP', '자체 AS', up.bgp ? up.bgp.as : '', de.bgp ? de.bgp.as : '');
    cmp('BGP neighbor', setOf(up, nb), setOf(de, nb));
    var stf = function (d) { return d.statics.map(function (s) { return [(s.vrf ? s.vrf + ' ' : '') + s.prefix, s.nh || s.iface]; }); };
    cmp('Static', setOf(up, stf), setOf(de, stf));
    var vrf = function (d) { return Object.keys(d.vrfs).map(function (k) { return [k, 'RD ' + (d.vrfs[k].rd || '없음')]; }); };
    cmp('VRF', setOf(up, vrf), setOf(de, vrf));
    var acl = function (d) { var seen = {}; return Object.keys(d.acls).filter(function (k) { var a = d.acls[k]; if (seen[a.name]) return false; seen[a.name] = 1; return true; }).map(function (k) { return [d.acls[k].name, d.acls[k].rules.map(function (r) { return r.text; }).join(' / ')]; }); };
    var ua = setOf(up, acl); var da = setOf(de, acl);
    Object.keys(da).forEach(function (k) { if (!(k in ua)) add('ACL', k, '', '규칙 ' + da[k].split(' / ').length + '개'); else if (ua[k] !== da[k]) add('ACL', k, ua[k].slice(0, 160), da[k].slice(0, 160)); });
    return { rows: rows, onlyDevice: only, upIf: Object.keys(up.ifaces).length, deIf: Object.keys(de.ifaces).length };
  }

  // ---------- IP 계획표 ----------
  function ipTable(topo) {
    var f = FN(); var ips = f.alloc(topo);
    var nm = function (id) { var n = topo.nodes.filter(function (x) { return x.id === id; })[0]; return n ? n.hostname : '?'; };
    var plans = {}; (topo.ipPlans || []).forEach(function (p) { plans[p.id] = p.name; });
    var vrfOf = {}; ((topo.features || {}).vrfs || []).forEach(function (v) { (v.links || []).forEach(function (l) { vrfOf[l] = v.name; }); });
    var rows = [['구분', '장비 A', '포트 A', 'IP A', '장비 B', '포트 B', 'IP B', '대역', 'VRF', 'IP 계획', '속도', '매체', 'LAG']];
    topo.links.forEach(function (l) {
      var a = ips.links[l.id];
      rows.push([a ? 'P2P(L3)' : 'L2', nm(l.a.node), l.a.port || '', a ? a.a : '', nm(l.b.node), l.b.port || '', a ? a.b : '', a ? a.net + '/' + a.prefix : '', vrfOf[l.id] || '', a ? (a.manual ? '직접 입력' : plans[a.plan] || '') : '', l.speed, l.media, l.lag || '']);
    });
    topo.nodes.forEach(function (n) { if (ips.loops[n.id]) rows.push(['Loopback', n.hostname, 'Loopback0', ips.loops[n.id] + '/32', '', '', '', '', '', n.loopback ? '직접 입력' : '', '', '', '']); });
    ((topo.features || {}).fhrp || []).forEach(function (g) { if (g.vip) rows.push([g.proto.toUpperCase() + ' VIP', g.members.map(function (m) { return nm(m.node); }).join(' / '), 'VLAN ' + g.vlan, g.vip, '', '', '', '', '', '그룹 ' + g.group, '', '', '']); });
    return { rows: rows, errors: ips.errors || [] };
  }
  var toCsv = function (rows) { return '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n'); };

  // ---------- 점검 명령 ----------
  // u: 1 = 출처 미확인(확인 필요)
  var CHK = {
    base: { cisco: ['show ip interface brief', 'show interfaces description', 'show ip route summary', 'show logging | include %'], nxos: ['show ip interface brief', 'show interface status', 'show ip route summary', 'show logging last 50'], arista: ['show ip interface brief', 'show interfaces status', 'show ip route summary', 'show logging last 10 minutes'], huawei: ['display ip interface brief', 'display interface brief', 'display ip routing-table statistics', 'display logbuffer'], juniper: ['show interfaces terse', 'show route summary', 'show log messages | last 50'] },
    ospf: { cisco: ['show ip ospf neighbor', 'show ip ospf interface brief'], nxos: ['show ip ospf neighbors', 'show ip ospf interface brief'], arista: ['show ip ospf neighbor', 'show ip ospf interface brief'], huawei: ['display ospf peer brief', 'display ospf interface'], juniper: ['show ospf neighbor', 'show ospf interface'] },
    bgp: { cisco: ['show ip bgp summary', 'show ip bgp neighbors | include BGP state'], nxos: ['show ip bgp summary'], arista: ['show ip bgp summary'], huawei: ['display bgp peer', 'display bgp routing-table'], juniper: ['show bgp summary'] },
    static: { cisco: ['show ip route static'], nxos: ['show ip route static'], arista: ['show ip route static'], huawei: ['display ip routing-table protocol static'], juniper: ['show route protocol static'] },
    vrf: { cisco: ['show vrf', 'show ip route vrf <VRF>'], nxos: ['show vrf', 'show ip route vrf <VRF>'], arista: ['show vrf', 'show ip route vrf <VRF>'], huawei: ['display ip vpn-instance', 'display ip routing-table vpn-instance <VRF>'], juniper: ['show route instance', 'show route table <VRF>.inet.0'] },
    fhrp: { cisco: ['show vrrp brief', 'show standby brief'], nxos: ['show vrrp', 'show hsrp brief'], arista: ['show vrrp'], huawei: ['display vrrp brief'], juniper: ['show vrrp summary'] },
    bfd: { cisco: ['show bfd neighbors'], nxos: ['show bfd neighbors'], arista: ['show bfd peers'], huawei: ['display bfd session all'], juniper: ['show bfd session'] },
    lacp: { cisco: ['show etherchannel summary', 'show lacp neighbor'], nxos: ['show port-channel summary'], arista: ['show port-channel summary', 'show lacp neighbor'], huawei: ['display eth-trunk'], juniper: ['show lacp interfaces'] },
    stp: { cisco: ['show spanning-tree summary', 'show spanning-tree root'], nxos: ['show spanning-tree summary'], arista: ['show spanning-tree'], huawei: ['display stp brief'], juniper: ['show spanning-tree bridge'] },
    vlan: { cisco: ['show vlan brief', 'show interfaces trunk'], nxos: ['show vlan brief', 'show interface trunk'], arista: ['show vlan', 'show interfaces trunk'], huawei: ['display vlan', 'display port vlan'], juniper: ['show vlans', 'show ethernet-switching interface'] },
    acl: { cisco: ['show access-lists', 'show ip interface | include line protocol|access list'], nxos: ['show access-lists'], arista: ['show ip access-lists'], huawei: ['display acl all'], juniper: ['show firewall'] },
    pbr: { cisco: ['show route-map', 'show ip policy'], arista: [['show policy-map type pbr', 1]], huawei: [['display traffic policy user-defined', 1]] },
    qos: { cisco: ['show policy-map interface'], arista: [['show policy-map interface', 1]], huawei: [['display traffic policy user-defined', 1]] },
    mlag: { nxos: ['show vpc', 'show vpc consistency-parameters global'], arista: ['show mlag', 'show mlag config-sanity'] },
    evpn: { nxos: ['show nve peers', 'show bgp l2vpn evpn summary'], arista: ['show vxlan vtep', 'show bgp evpn summary'], huawei: ['display vxlan tunnel', ['display bgp evpn peer', 1]] },
    flow: { cisco: ['show flow monitor', 'show flow exporter'], arista: ['show sflow'], huawei: [['display sflow', 1]] },
    pfc: { arista: [['show priority-flow-control', 1]], huawei: [['display dcb pfc', 1]] },
    portsec: { cisco: ['show port-security'] },
  };
  var BACKUP = { cisco: 'show running-config', nxos: 'show running-config', arista: 'show running-config', huawei: 'display current-configuration', juniper: 'show configuration | display set' };
  var SAVE = { cisco: 'copy running-config startup-config', nxos: 'copy running-config startup-config', arista: 'copy running-config startup-config', huawei: 'save', juniper: 'commit confirmed 5   (이상 없으면 5분 안에 commit)' };
  var LABEL = { base: '기본 상태', ospf: 'OSPF', bgp: 'BGP', static: 'Static', vrf: 'VRF', fhrp: 'VRRP·HSRP', bfd: 'BFD', lacp: 'LACP', stp: 'STP', vlan: 'VLAN', acl: 'ACL', pbr: 'PBR', qos: 'QoS', mlag: 'MLAG·vPC', evpn: 'VxLAN·EVPN', flow: 'NetFlow·sFlow', pfc: 'PFC', portsec: 'Port-Security' };
  function checksFor(topo, node) {
    var f = FN(); var v = node.vendor; var key = v === 'cisco' && isNx(node) ? 'nxos' : v;
    if (!CHK.base[key]) return { skip: (VN[v] || v || '벤더 미지정') + ': 점검 명령은 Cisco·Arista·Huawei·Juniper만 제공합니다' };
    var cfg = f.deviceConfig(topo, node.id);
    var kinds = { base: 1 };
    (cfg.status || []).forEach(function (s) { if (s.ok) kinds[s.kind] = 1; });
    if (topo.links.some(function (l) { return l.lag && (l.a.node === node.id || l.b.node === node.id); })) kinds.lacp = 1;
    var ips = f.alloc(topo); var pings = [];
    topo.links.forEach(function (l) { var a = ips.links[l.id]; if (!a) return; if (l.a.node === node.id) pings.push('ping ' + a.b.split('/')[0]); else if (l.b.node === node.id) pings.push('ping ' + a.a.split('/')[0]); });
    var groups = [];
    Object.keys(LABEL).forEach(function (k) { if (!kinds[k]) return; var list = (CHK[k] || {})[key]; if (!list) { if (k !== 'base') groups.push({ label: LABEL[k], cmds: [], none: true }); return; } groups.push({ label: LABEL[k], cmds: list.map(function (c) { return Array.isArray(c) ? { t: c[0], u: 1 } : { t: c }; }) }); });
    if (pings.length) groups.push({ label: '이웃 연결 확인 (VRF 연결은 VRF 옵션을 붙이세요)', cmds: pings.slice(0, 16).map(function (t) { return { t: t }; }) });
    return { key: key, groups: groups, backup: BACKUP[key], save: SAVE[key] };
  }
  function checksText(topo, nodes) {
    var out = ['# NetOps 작업 전·후 점검 명령 — ' + topo.name, '# 사용법: 작업 전에 한 번 실행해 결과를 저장하고, 작업 후 같은 명령을 실행해 비교합니다.', ''];
    nodes.forEach(function (n) {
      var c = checksFor(topo, n);
      out.push('===== ' + n.hostname + ' (' + (VN[n.vendor] || n.vendor || '-') + ' ' + (n.model || '') + ') =====');
      if (c.skip) { out.push('  ' + c.skip, ''); return; }
      out.push('[작업 전] 설정 백업', '  ' + c.backup, '[작업 전·후 공통] 상태 확인');
      c.groups.forEach(function (g) { out.push('  -- ' + g.label); if (g.none) out.push('     (이 벤더용 명령 미등록 — 장비 문서 확인)'); g.cmds.forEach(function (x) { out.push('  ' + x.t + (x.u ? '      <- 확인 필요(출처 미확인)' : '')); }); });
      out.push('[작업 후] 이상 없으면 저장', '  ' + c.save, '');
    });
    return out.join('\n');
  }

  // ---------- 변경 이력 (이 기기에 저장) ----------
  var dbp = null;
  function hdb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) { try { var r = indexedDB.open('netops-hist', 1); r.onupgradeneeded = function () { var s = r.result.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true }); s.createIndex('topo', 'topoId'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; } catch (e) { rej(e); } });
    return dbp;
  }
  function hAdd(rec) { return hdb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('snaps', 'readwrite'); tx.objectStore('snaps').add(rec); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }); }).then(function () { return hTrim(rec.topoId); }).catch(function () {}); }
  function hList(topoId) { return hdb().then(function (db) { return new Promise(function (res) { var out = []; var rq = db.transaction('snaps').objectStore('snaps').index('topo').openCursor(IDBKeyRange.only(topoId)); rq.onsuccess = function () { var c = rq.result; if (c) { out.push(c.value); c.continue(); } else res(out.sort(function (a, b) { return b.at - a.at; })); }; rq.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  function hDel(id) { return hdb().then(function (db) { return new Promise(function (res) { var tx = db.transaction('snaps', 'readwrite'); tx.objectStore('snaps').delete(id); tx.oncomplete = res; tx.onerror = res; }); }).catch(function () {}); }
  function hTrim(topoId) { return hList(topoId).then(function (l) { return Promise.all(l.slice(25).map(function (x) { return hDel(x.id); })); }); }
  var slim = function (t) { return JSON.parse(JSON.stringify(t)); };
  window.__nxOnSave = function (before, after, rep) {
    try {
      var add = 0, del = 0; ((rep && rep.nodes) || []).forEach(function (n) { add += n.added.length; del += n.removed.length; });
      hAdd({ topoId: after.id, at: Date.now(), kind: 'save', label: '라우팅·기능 저장 — CONFIG 바뀐 장비 ' + ((rep && rep.changed) || 0) + '대 (+' + add + ' / −' + del + '줄)', before: slim(before), after: slim(after) });
    } catch (e) { /* 이력 실패는 저장을 막지 않음 */ }
  };

  // ---------- 창 ----------
  var ov = null; var state = { tab: 'rollback', node: '', basis: 'all', hist: [] };
  var TABS = [['rollback', '원복 CONFIG'], ['compare', '장비↔설계 비교'], ['ip', 'IP 계획표'], ['check', '점검 명령'], ['history', '변경 이력']];
  function close() { if (ov) { ov.remove(); ov = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function nodesSel(topo) { return state.node ? topo.nodes.filter(function (n) { return n.id === state.node; }) : topo.nodes; }
  var pre = function (t) { return '<pre style="max-height:46vh;overflow:auto;white-space:pre;margin:0;font-family:var(--f-mono);font-size:.76rem;line-height:1.5;background:var(--surface-2,var(--bg));border:1px solid var(--line);border-radius:6px;padding:10px 12px">' + esc(t) + '</pre>'; };
  var nodeSelect = function (topo, all) { return '<label class="f" style="width:200px">장비<select data-nx="node">' + (all ? '<option value="">전체</option>' : '') + topo.nodes.map(function (n) { return '<option value="' + n.id + '"' + (state.node === n.id ? ' selected' : '') + '>' + esc(n.hostname) + '</option>'; }).join('') + '</select></label>'; };
  var outText = '';
  function body() {
    var topo = CTX().topo; var f = FN();
    if (!topo || !f) return '<p class="muted">구성도를 불러오는 중입니다. 잠시 뒤 다시 여세요.</p>';
    if (!topo.nodes.length) return '<p class="muted">구성도에 장비가 없습니다.</p>';
    var h = ''; outText = '';
    try {
      if (state.tab === 'rollback') {
        var basis = state.basis === 'all' ? null : state.hist.filter(function (x) { return String(x.id) === String(state.basis); })[0];
        var skips = []; var parts = [];
        nodesSel(basis ? basis.after : topo).forEach(function (n) { var r = rollbackFor(n, basis ? basis.after : topo, basis ? basis.before : null); if (r.text) parts.push(r.text); else skips.push(n.hostname + ': ' + r.skip); });
        outText = parts.join('\n\n');
        h += '<div class="row">' + nodeSelect(topo, true) + '<label class="f" style="flex:1 1 260px">기준<select data-nx="basis"><option value="all">앱이 만든 설정 전체를 지우기</option>' + state.hist.filter(function (x) { return x.kind === 'save'; }).map(function (x) { return '<option value="' + x.id + '"' + (String(state.basis) === String(x.id) ? ' selected' : '') + '>' + esc(new Date(x.at).toLocaleString('ko-KR') + ' 저장의 변경분만') + '</option>'; }).join('') + '</select></label></div>';
        h += '<div class="notice small">변경 작업이 실패했을 때 되돌리는 명령 초안입니다. <b>no / undo / delete 규칙으로 자동 생성</b>한 것이라, 적용 전 장비에서 한 줄씩 확인하세요. "저장의 변경분만"을 고르면 그 저장에서 늘어난 줄만 지우고, 지워졌던 줄은 다시 넣습니다.</div>';
        h += outText ? pre(outText) : '<p class="muted">되돌릴 내용이 없습니다.</p>';
        if (skips.length) h += '<ul class="small muted" style="margin:6px 0 0;padding-left:18px">' + skips.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      } else if (state.tab === 'compare') {
        var ups = topo.nodes.filter(function (n) { return n.parsed && ['cisco', 'huawei', 'juniper', 'arista'].indexOf(n.vendor) >= 0; });
        if (!ups.length) return '<p class="muted">업로드한 CONFIG가 있는 장비가 없습니다. <b>업로드·검증</b> 메뉴에서 장비 CONFIG를 올리면, 지금 장비 설정과 앱 설계의 차이를 여기서 봅니다. (Cisco·Huawei·Juniper·Arista)</p>';
        if (!ups.some(function (n) { return n.id === state.node; })) state.node = ups[0].id;
        var node = ups.filter(function (n) { return n.id === state.node; })[0];
        var c = compareNode(topo, node);
        h += '<div class="row"><label class="f" style="width:220px">장비 (업로드본 있음)<select data-nx="node">' + ups.map(function (n) { return '<option value="' + n.id + '"' + (n.id === state.node ? ' selected' : '') + '>' + esc(n.hostname) + '</option>'; }).join('') + '</select></label><span class="small muted" style="align-self:end">업로드 ' + esc(node.parsedFile || '') + ' · 인터페이스 장비 ' + c.upIf + ' / 설계 ' + c.deIf + '</span></div>';
        var need = c.rows.filter(function (r) { return r.kind !== '장비에만 있음'; });
        h += '<div class="notice small">앱 설계(구성도·라우팅·기능)에 있는 항목을 기준으로 지금 장비 설정과 비교합니다. <b>추가 필요 ' + need.filter(function (r) { return /추가/.test(r.kind); }).length + '건 · 변경 필요 ' + need.filter(function (r) { return /변경/.test(r.kind); }).length + '건</b> · 장비에만 있음 ' + (c.rows.length - need.length) + '건(참고). 비밀번호 등은 업로드 때 버려져 비교하지 않습니다.</div>';
        if (c.rows.length) {
          h += '<div class="tw" style="max-height:44vh;overflow:auto"><table><thead><tr><th>구분</th><th>항목</th><th>장비 (업로드)</th><th>설계 (앱)</th><th>판정</th></tr></thead><tbody>' + c.rows.map(function (r) { return '<tr><td class="small">' + esc(r.cat) + '</td><td class="mono small">' + esc(r.item) + '</td><td class="mono small">' + esc(r.up) + '</td><td class="mono small">' + esc(r.de) + '</td><td><span class="badge ' + (/추가/.test(r.kind) ? 'accent' : /변경/.test(r.kind) ? 'warn' : '') + '">' + esc(r.kind) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
          outText = toCsv([['장비', '구분', '항목', '장비(업로드)', '설계(앱)', '판정']].concat(c.rows.map(function (r) { return [node.hostname, r.cat, r.item, r.up, r.de, r.kind]; })));
        } else h += '<p>설계 항목과 장비 설정이 일치합니다.</p>';
        if (c.onlyDevice.length) h += '<details class="small" style="margin-top:6px"><summary>설계(구성도)에 없는 장비 IP 인터페이스 ' + c.onlyDevice.length + '개</summary><div class="mono">' + esc(c.onlyDevice.join(' · ')) + '</div></details>';
      } else if (state.tab === 'ip') {
        var t = ipTable(topo);
        outText = toCsv(t.rows);
        h += '<div class="notice small">연결별 IP·Loopback·가상 IP를 표로 모았습니다. CSV는 엑셀에서 바로 열립니다(한글 깨짐 방지 처리).<br><b>자동 배정 주소는 연결·장비별로 고정</b>됩니다. 앞쪽 연결을 지우거나 새로 추가해도 기존 주소는 바뀌지 않고, 직접 입력한 주소·Loopback은 자동 배정에서 제외됩니다.</div>';
        h += '<div class="row">' + (state.ipcf ? '<span class="small">자동 배정된 모든 주소를 처음부터 다시 정할까요? (직접 입력한 주소는 그대로)</span><button class="btn sm danger" data-nx="ipreset2">전체 재배정</button><button class="btn sm quiet" data-nx="ipno">취소</button>' : '<button class="btn sm quiet" data-nx="ipreset">IP 전체 재배정…</button><span class="small muted">빈 번호를 앞에서부터 다시 채웁니다. 구성도에서 Ctrl+Z로 취소할 수 있습니다.</span>') + '</div>';
        if (t.errors.length) h += '<div class="notice small" style="border-left-color:var(--bad)">' + t.errors.map(esc).join('<br>') + '</div>';
        h += '<div class="tw" style="max-height:48vh;overflow:auto"><table><thead><tr>' + t.rows[0].map(function (c2) { return '<th>' + esc(c2) + '</th>'; }).join('') + '</tr></thead><tbody>' + t.rows.slice(1).map(function (r) { return '<tr>' + r.map(function (c2, i) { return '<td class="' + (i === 0 ? 'small' : 'mono small') + '">' + esc(c2) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      } else if (state.tab === 'check') {
        outText = checksText(topo, nodesSel(topo));
        h += '<div class="row">' + nodeSelect(topo, true) + '</div><div class="notice small">장비에 들어간 라우팅·기능에 맞춰 <b>작업 전 백업 → 전·후 같은 명령으로 비교 → 저장</b> 순서로 묶었습니다. "확인 필요" 표시는 출처를 확인하지 못한 명령입니다.</div>' + pre(outText);
      } else if (state.tab === 'history') {
        h += '<div class="row"><button class="btn sm" data-nx="snap">지금 상태 기록</button><span class="small muted">라우팅·기능을 <b>저장</b>할 때마다 자동으로 남습니다(구성도당 최근 25개). 이력은 <b>이 기기에만</b> 저장되고 다른 기기와 공유되지 않습니다.</span></div>';
        if (!state.hist.length) h += '<p class="muted">아직 이력이 없습니다.</p>';
        else h += '<div class="tw" style="max-height:50vh;overflow:auto"><table><thead><tr><th>시각</th><th>내용</th><th>장비·연결</th><th></th></tr></thead><tbody>' + state.hist.map(function (x) { return '<tr><td class="small nowrap">' + esc(new Date(x.at).toLocaleString('ko-KR')) + '</td><td class="small">' + esc(x.label) + '</td><td class="small">' + x.after.nodes.length + '대 · ' + x.after.links.length + '개</td><td class="nowrap">' + (state.confirm === x.id ? '<span class="small">이 시점으로 되돌릴까요? </span><button class="btn sm danger" data-nx="restore2" data-id="' + x.id + '">되돌리기</button> <button class="btn sm quiet" data-nx="nocf">취소</button>' : '<button class="btn sm quiet" data-nx="restore" data-id="' + x.id + '">이 시점으로</button>' + (x.kind === 'save' ? ' <button class="btn sm quiet" data-nx="rb" data-id="' + x.id + '">원복 CONFIG</button>' : '') + ' <button class="btn sm quiet" data-nx="hdel" data-id="' + x.id + '">지우기</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
        h += '<p class="small muted">"이 시점으로"는 구성도 전체(장비·연결·라우팅·기능)를 그때 상태로 바꿉니다. 되돌린 직후에는 구성도의 <b>되돌리기(Ctrl+Z)</b>로 취소할 수 있습니다.</p>';
      }
    } catch (e) { return '<div class="notice" style="border-left-color:var(--bad)">계산 중 문제가 생겼습니다: ' + esc(e && e.message) + '</div>'; }
    if (outText) h += '<div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn sm quiet" data-nx="copy">복사</button><button class="btn sm" data-nx="file">파일 저장</button></div>';
    return h;
  }
  function render() {
    if (!ov) return;
    var topo = CTX().topo;
    ov.querySelector('.nx-tabs').innerHTML = TABS.map(function (t) { return '<button class="chip" data-nx="tab" data-tab="' + t[0] + '" aria-pressed="' + (state.tab === t[0]) + '">' + t[1] + '</button>'; }).join('');
    ov.querySelector('.nx-title').textContent = '운용 도구' + (topo ? ' — ' + topo.name : '');
    ov.querySelector('.modal-body .nx-b').innerHTML = body();
  }
  function loadHist() { var topo = CTX().topo; if (!topo) return Promise.resolve(); return hList(topo.id).then(function (l) { state.hist = l; }); }
  function open(tab) {
    close();
    if (tab) state.tab = tab;
    state.confirm = null;
    ov = document.createElement('div'); ov.className = 'modal-bg'; ov.id = 'nx-tools';
    ov.innerHTML = '<div class="modal wide" role="dialog" aria-modal="true" aria-label="운용 도구" tabindex="-1"><div class="row modal-head"><h2 class="nx-title">운용 도구</h2><span class="spacer"></span><button class="btn sm quiet" data-nx="close">닫기</button></div><div class="modal-body"><div class="chips nx-tabs" style="margin:0 0 12px"></div><div class="nx-b stack"></div></div></div>';
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.addEventListener('change', function (e) { var k = e.target.getAttribute('data-nx'); if (k === 'node') { state.node = e.target.value; render(); } else if (k === 'basis') { state.basis = e.target.value; render(); } });
    ov.addEventListener('click', function (e) {
      var a = e.target.closest('[data-nx]'); if (!a || a.tagName === 'SELECT') return;
      var k = a.getAttribute('data-nx'); var id = Number(a.getAttribute('data-id')); var topo = CTX().topo;
      var rec = state.hist.filter(function (x) { return x.id === id; })[0];
      if (k === 'close') close();
      else if (k === 'tab') { state.tab = a.getAttribute('data-tab'); state.confirm = null; if (state.tab !== 'compare' && state.tab !== 'rollback' && state.tab !== 'check') state.node = state.node; render(); }
      else if (k === 'copy') copy(outText);
      else if (k === 'file') { var nm = { rollback: '-rollback.txt', compare: '-compare.csv', ip: '-ip-plan.csv', check: '-check-commands.txt' }[state.tab] || '.txt'; saveFile(topo.name + nm, outText); }
      else if (k === 'snap') { var raw = CTX().raw || topo; hAdd({ topoId: topo.id, at: Date.now(), kind: 'manual', label: '직접 기록', before: slim(raw), after: slim(raw) }).then(loadHist).then(function () { render(); toast('지금 상태를 기록했습니다'); }); }
      else if (k === 'restore') { if (document.getElementById('btn-save')) { toast('저장 안 된 변경이 있습니다 — 먼저 저장하거나 취소하세요'); return; } state.confirm = id; render(); }
      else if (k === 'nocf') { state.confirm = null; render(); }
      else if (k === 'restore2' && rec) { var c = CTX(); if (!c.updateTopo) { toast('되돌리기를 쓸 수 없습니다'); return; } var snap = slim(rec.after); c.updateTopo(topo.id, function (cur) { snap.id = cur.id; return snap; }); state.confirm = null; toast('그 시점으로 되돌렸습니다 — 구성도에서 Ctrl+Z로 취소할 수 있습니다'); setTimeout(render, 300); }
      else if (k === 'rb' && rec) { state.tab = 'rollback'; state.basis = String(rec.id); state.node = ''; render(); }
      else if (k === 'hdel') { hDel(id).then(loadHist).then(render); }
      else if (k === 'ipreset') { state.ipcf = true; render(); }
      else if (k === 'ipno') { state.ipcf = false; render(); }
      else if (k === 'ipreset2') { state.ipcf = false; if (window.netopsIpReset && window.netopsIpReset()) toast('자동 배정 주소를 다시 정했습니다'); else toast('재배정할 수 없습니다'); setTimeout(render, 900); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    render();
    loadHist().then(render);
    ov.querySelector('.modal').focus();
  }
  // ---------- IP 배정 고정 (연결 ID·장비 ID별 저장) ----------
  function ipMem(t) {
    var F = window.__nxFn; if (!F || !F.alloc) return null;
    var a = F.alloc(t), mem = { links: {}, loops: {} };
    Object.keys(a.links || {}).forEach(function (id) { var x = a.links[id]; if (!x.manual && x.net) mem.links[id] = { net: x.net, prefix: x.prefix, plan: x.plan }; });
    var man = {}; (t.nodes || []).forEach(function (n) { if (n.loopback) man[n.id] = 1; });
    Object.keys(a.loops || {}).forEach(function (id) { if (!man[id] && a.loops[id]) mem.loops[id] = a.loops[id]; });
    return mem;
  }
  var lastRaw = null;
  function ipWatch() {
    try {
      var c = CTX(), t = c.raw; if (!t || !c.updateTopo || t === lastRaw) return; lastRaw = t;
      var mem = ipMem(t); if (!mem) return;
      if (JSON.stringify(mem) === JSON.stringify(t.ipAlloc || { links: {}, loops: {} })) return;
      c.updateTopo(t.id, function (x) { x.ipAlloc = mem; return x; }, { skipHistory: true });
    } catch (e) { }
  }
  setInterval(ipWatch, 700);
  window.netopsIpReset = function () {
    var c = CTX(), t = c.raw; if (!t || !c.updateTopo) return false;
    var x0 = structuredClone(t); delete x0.ipAlloc; var mem = ipMem(x0) || { links: {}, loops: {} };
    c.updateTopo(t.id, function (x) { x.ipAlloc = mem; return x; });
    return true;
  };
  // ---------- 전체 백업 보강: 형식 버전 · 내 자료(모델·틀·카드) · 변경 이력 · 업로드 원본 ----------
  function hAll() { return hdb().then(function (db) { return new Promise(function (res) { var q = db.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  function hPutAll(list) { return hdb().then(function (db) { return new Promise(function (res) { var tx = db.transaction('snaps', 'readwrite'), st = tx.objectStore('snaps'); list.forEach(function (r) { try { st.put(r); } catch (e) { } }); tx.oncomplete = res; tx.onerror = res; }); }).catch(function () { }); }
  window.__nxBackupExtra = function (z) {
    var my = window.__nxMyRaw ? window.__nxMyRaw.read().catch(function () { return null; }) : Promise.resolve(null);
    var raw = window.__nxRawAll ? window.__nxRawAll() : Promise.resolve([]);
    return Promise.all([my, hAll(), raw]).then(function (r) {
      z.format = { name: 'netops-backup', version: 5, app: '7.1', note: '구성도·설정(인벤토리·모델 목록 포함)·작업 + 내 자료(모델·틀·카드)·변경 이력·업로드 원본(비밀 줄 삭제본)' };
      z.extra = { myPack: r[0] ? { models: r[0].modelsText, templates: r[0].templates, cards: r[0].cardsText } : null, history: r[1], rawConfigs: r[2] };
      z.counts = { topos: Object.keys(z.topos || {}).length, jobs: (z.jobs || []).length, history: r[1].length, rawConfigs: r[2].length, myTemplates: r[0] ? (r[0].templates || []).length : 0 };
      return z;
    });
  };
  window.__nxRestoreExtra = function (b) {
    var x = b && b.extra; if (!x) return Promise.resolve(null);
    var jobs = [];
    if (x.myPack && window.__nxMyRaw) jobs.push(window.__nxMyRaw.write({ modelsText: x.myPack.models || '', templates: x.myPack.templates || [], cardsText: x.myPack.cards == null ? null : x.myPack.cards }).then(function () { if (window.__nxSyncCatalog) window.__nxSyncCatalog(false); }).catch(function () { }));
    if (x.history && x.history.length) jobs.push(hPutAll(x.history));
    if (x.rawConfigs && x.rawConfigs.length && window.__nxRawPut) x.rawConfigs.forEach(function (r) { jobs.push(window.__nxRawPut(r)); });
    return Promise.all(jobs).then(function () { return x; });
  };
  // 저장 실패로 보관 중인 변경이 있으면 창 닫기 전에 경고
  window.addEventListener('beforeunload', function (e) { var q = window.__nxSaveQ; if (q && q.list().some(function (i) { return i.state === 'failed'; })) { e.preventDefault(); e.returnValue = ''; } });
  window.__nxTools = { open: open, _t: { toBlocks: toBlocks, diffBlocks: diffBlocks, rollbackLines: rollbackLines, toCsv: toCsv } };

  // 왼쪽 메뉴 '운용 작업' 아래 '운용 도구 5종'
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6.5a4 4 0 0 0-5.2 5.2L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.4-.6-.6-2.4z"></path></svg>';
  function ensure() {
    var anchor = document.getElementById('nav-tasks'); var mine = document.getElementById('nav-tools');
    if (!anchor) { if (mine) mine.style.display = 'none'; return; }
    if (!mine) { mine = document.createElement('button'); mine.id = 'nav-tools'; mine.type = 'button'; mine.addEventListener('click', function () { open(); var sc = document.querySelector('.nav-scrim'); if (sc && window.innerWidth < 900) sc.click(); }); }
    if (mine.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', mine);
    var cls = anchor.className.replace(/\b(active|is-active|current|on)\b/g, '').replace(/\s+/g, ' ').trim();
    if (mine.className !== cls) mine.className = cls;
    if (!mine.firstChild) mine.innerHTML = ICON + '<span>운용 도구 5종</span>';
    if (mine.style.display) mine.style.display = '';
    var cnt = anchor.parentElement && anchor.parentElement.querySelector('.sec-count');
    if (cnt) { var n = anchor.parentElement.querySelectorAll('.nav-item').length; if (cnt.textContent !== String(n)) cnt.textContent = String(n); }
  }
  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensure(); }); });
  function start() { ensure(); mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
