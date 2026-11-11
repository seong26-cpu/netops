/* NetOps — CONFIG 파서 보강 (앱 파서 결과에 빠진 문법을 덧붙임)
   IOS XR(ipv4 address·vrf RT 블록·router static·OSPF area interface·BGP vrf neighbor), NX-OS(OS 판별·vrf neighbor),
   Junos(OSPF unit→물리 포트), Nokia SR OS(port·static·OSPF·BGP·VPRN), EXOS(static·OSPF·BGP).
   줄 번호는 업로드 원본 기준 그대로 둔다. 실패해도 원래 결과를 그대로 돌려준다. */
(function () {
  'use strict';
  var isIp = function (s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s || ''); };
  var m2p = function (m) { return String(m).split('.').reduce(function (a, o) { return a + ((Number(o) >>> 0).toString(2).match(/1/g) || []).length; }, 0); };
  function ifo(d, name, ln) { return d.ifaces[name] || (d.ifaces[name] = { name: name, line: ln, fhrp: [], vlans: [] }); }
  function vrfo(d, name, ln) { var v = d.vrfs[name] || (d.vrfs[name] = { name: name, line: ln, rtImp: [], rtExp: [], routes: [] }); v.rtImp = v.rtImp || []; v.rtExp = v.rtExp || []; return v; }
  function ospfo(d, pid, vrf, ln) { var o = d.ospf.find(function (x) { return String(x.pid) === String(pid) && (x.vrf || '') === (vrf || ''); }); if (!o) { o = { pid: String(pid), vrf: vrf || '', rid: '', line: ln, networks: [], passive: [] }; d.ospf.push(o); } return o; }
  function bgpo(d, as, ln) { return d.bgp || (d.bgp = { as: as || '', line: ln, rid: '', clusterId: '', neighbors: {}, networks: [], evpnPeers: [] }); }
  function nbo(d, vrf, ip, ln) { var b = bgpo(d, '', ln), k = (vrf || '') + '|' + ip; return b.neighbors[k] || (b.neighbors[k] = { ip: ip, vrf: vrf || '', line: ln }); }
  function addRt(v, kind, rt) { rt = String(rt).replace(/^target:/, ''); if (kind !== 'export' && v.rtImp.indexOf(rt) < 0) v.rtImp.push(rt); if (kind !== 'import' && v.rtExp.indexOf(rt) < 0) v.rtExp.push(rt); }
  function pushStatic(d, vrf, prefix, nh, ln) { var p = prefix.split('/'); if (d.statics.some(function (s) { return s.line === ln && s.prefix === prefix; })) return; d.statics.push({ vrf: vrf || '', prefix: prefix, net: p[0], len: Number(p[1]), nh: isIp(nh) ? nh : '', iface: isIp(nh) ? '' : (nh || ''), line: ln }); }
  function setOspfIf(d, name, pid, area, ln) { var i = ifo(d, name, ln); i.ospf = Object.assign({}, i.ospf || {}, { area: normArea(area), pid: String(pid), line: (i.ospf && i.ospf.line) || ln }); return i; }
  function normArea(a) { a = String(a); return /^\d+$/.test(a) ? [a >>> 24 & 255, a >>> 16 & 255, a >>> 8 & 255, a & 255].join('.') : a; }
  // 들여쓰기 기준 블록 순회: fn(trimmed, path[부모 줄들], lineNo)
  function walk(text, fn, skip) {
    var L = String(text).split(/\r?\n/), st = [];
    for (var i = 0; i < L.length; i++) {
      var raw = L[i]; if (!raw.trim()) continue;
      var ind = raw.match(/^\s*/)[0].length, s = raw.trim();
      if (skip.test(s)) continue;
      while (st.length && st[st.length - 1].ind >= ind) st.pop();
      fn(s, st.map(function (x) { return x.s; }), i + 1);
      st.push({ ind: ind, s: s });
    }
  }
  var find = function (path, re) { for (var i = path.length - 1; i >= 0; i--) { var m = path[i].match(re); if (m) return m; } return null; };

  /* ── Cisco 계열 (IOS XR · NX-OS · IOS) ── */
  function cisco(d, text) {
    var xrHdr = text.match(/^!! IOS XR Configuration\s+(\S+)/m);
    var isXR = !!xrHdr || /^\s*ipv4 address\s+\d/m.test(text) || /^interface (TenGigE|HundredGigE|FortyGigE|TwentyFiveGigE|Bundle-Ether)\S*/m.test(text) || /^router static\s*$/m.test(text);
    var isNX = /^feature\s+\S+/m.test(text) || /^vrf context\s/m.test(text) || /^\s*vrf member\s/m.test(text);
    if (isXR) { d.os = 'IOS XR' + (xrHdr ? ' ' + xrHdr[1] : (d.os || '').replace(/^\D+/, ' ').replace(/^ $/, '')); d.osFamily = 'iosxr'; d.notes.push('IOS XR: 검증은 업로드 CONFIG 기준으로 하지만, 앱이 만드는 Cisco CONFIG는 IOS 문법이라 IOS XR에 그대로 쓰면 안 됩니다.'); }
    else if (isNX) { d.os = (d.os || 'NX-OS').replace('IOS/NX-OS', 'NX-OS'); d.osFamily = 'nxos'; }
    else if (/^IOS\/NX-OS/.test(d.os || '')) { d.os = d.os.replace('IOS/NX-OS', /^\s*(boot system|license udi|ip cef|service timestamps)/m.test(text) ? 'IOS' : 'IOS'); d.osFamily = 'ios'; }
    walk(text, function (s, path, ln) {
      var m, top = path[0] || '';
      // 인터페이스 (XR)
      if ((m = top.match(/^interface\s+(.+)$/)) && path.length === 1) {
        var io = ifo(d, m[1].trim(), ln), mm;
        if ((mm = s.match(/^ipv4 address\s+(\d+\.\d+\.\d+\.\d+)(?:\/(\d+)|\s+(\d+\.\d+\.\d+\.\d+))?(\s+secondary)?/)) && !mm[4] && !io.ip) { io.ip = mm[1] + '/' + (mm[2] || (mm[3] ? m2p(mm[3]) : 32)); io.ipLine = ln; }
        else if ((mm = s.match(/^vrf\s+(\S+)$/)) && isXR) io.vrf = mm[1];
        else if ((mm = s.match(/^mtu\s+(\d+)/)) && !io.mtu) io.mtu = Number(mm[1]);
        return;
      }
      // VRF RT 블록 (XR: import route-target ↵ 값)
      if ((m = top.match(/^vrf\s+(\S+)$/)) && isXR) {
        var par = path[path.length - 1] || '', k = par.match(/^(import|export) route-target/);
        if (k && /^\S+:\S+$/.test(s)) addRt(vrfo(d, m[1], ln), k[1], s);
        return;
      }
      // router static (XR)
      if (top === 'router static') {
        var vm = find(path, /^vrf\s+(\S+)$/), af = find(path, /^address-family ipv4/);
        if (af && (m = s.match(/^(\d+\.\d+\.\d+\.\d+\/\d+)\s+(\S+)(?:\s+(\S+))?/))) pushStatic(d, vm ? vm[1] : '', m[1], isIp(m[2]) ? m[2] : (isIp(m[3]) ? m[3] : m[2]), ln);
        return;
      }
      // router ospf (XR: area ↵ interface)
      if ((m = top.match(/^router ospf\s+(\S+)/)) && isXR) {
        var vr = find(path, /^vrf\s+(\S+)$/), ar = find(path, /^area\s+(\S+)/), o = ospfo(d, m[1], vr ? vr[1] : '', ln), im;
        if (ar && (im = s.match(/^interface\s+(\S+)/))) setOspfIf(d, im[1], m[1], ar[1], ln);
        else if ((im = find(path, /^interface\s+(\S+)/)) && ar) {
          if (/^passive( enable)?$/.test(s)) { if (o.passive.indexOf(im[1]) < 0) o.passive.push(im[1]); }
          else if ((m = s.match(/^network\s+(point-to-point|broadcast)/))) (ifo(d, im[1], ln).ospf || {}).network = m[1];
          else if ((m = s.match(/^cost\s+(\d+)/))) (ifo(d, im[1], ln).ospf || {}).cost = Number(m[1]);
        }
        else if ((m = s.match(/^router-id\s+(\S+)/)) && !vr) o.rid = m[1];
        return;
      }
      // router bgp: vrf ↵ neighbor ↵ remote-as (XR·NX-OS)
      if ((m = top.match(/^router bgp\s+(\S+)/))) {
        var v2 = path[1] && path[1].match(/^vrf\s+(\S+)$/), nb = find(path, /^neighbor\s+(\d+\.\d+\.\d+\.\d+)$/);
        if (v2 && nb) {
          var n = nbo(d, v2[1], nb[1], ln);
          if ((m = s.match(/^remote-as\s+(\S+)/))) n.remoteAs = m[1];
          else if ((m = s.match(/^update-source\s+(\S+)/))) n.updSrc = m[1];
          else if (/^bfd/.test(s)) n.bfd = true;
          else if (/^shutdown/.test(s)) n.shutdown = true;
        } else if (v2 && (m = s.match(/^neighbor\s+(\d+\.\d+\.\d+\.\d+)$/))) nbo(d, v2[1], m[1], ln);
        else if (isXR && !v2 && (m = s.match(/^bgp router-id\s+(\S+)/))) bgpo(d, '', ln).rid = m[1];
        return;
      }
    }, /^!/);
    if (isXR) l2mtu(d);
  }

  /* ── Junos: OSPF가 unit(xe-0/0/0.0)에 걸렸는데 IP는 물리 이름에 있는 경우 연결 ── */
  function l2mtu(d) { Object.values(d.ifaces).forEach(function (i) { if (i.mtu && !i.mtuL2) { i.mtuL2 = i.mtu; i.mtu = i.mtu - 14; } }); }
  function junos(d) {
    l2mtu(d);
    Object.keys(d.ifaces).forEach(function (k) {
      var m = k.match(/^(.+)\.0$/), i = d.ifaces[k];
      if (m && i.ospf && !i.ip && d.ifaces[m[1]]) { var b = d.ifaces[m[1]]; b.ospf = Object.assign({}, i.ospf, b.ospf || {}); }
    });
    d.ospf.forEach(function (o) { (o.passive || []).slice().forEach(function (p) { var m = p.match(/^(.+)\.0$/); if (m && o.passive.indexOf(m[1]) < 0) o.passive.push(m[1]); }); });
  }

  /* ── Nokia SR OS (classic CLI) ── */
  function sros(d, text) {
    // 'interface "to-CE" create' → 이름에서 create 제거
    Object.keys(d.ifaces).forEach(function (k) { var nk = k.replace(/\s+create$/, '').replace(/"/g, ''); if (nk !== k) { var o = d.ifaces[k]; delete d.ifaces[k]; o.name = nk; if (!d.ifaces[nk]) d.ifaces[nk] = o; } });
    walk(text, function (s, path, ln) {
      var m, inVprn = find(path, /^vprn\s+(\d+)(?:\s+name\s+"([^"]+)")?/), vrf = inVprn ? (inVprn[2] || ('vprn' + inVprn[1])) : '';
      if ((m = s.match(/^vprn\s+(\d+)(?:\s+name\s+"([^"]+)")?/))) { vrfo(d, m[2] || ('vprn' + m[1]), ln); return; }
      if (inVprn && path[path.length - 1].match(/^vprn\s/)) {
        var v = vrfo(d, vrf, ln);
        if ((m = s.match(/^route-distinguisher\s+(\S+)/))) v.rd = m[1];
        else if ((m = s.match(/^vrf-target\s+(?:(import|export)\s+)?(target:\S+)/))) addRt(v, m[1] || 'both', m[2]);
      }
      var im = find(path, /^interface\s+"([^"]+)"/);
      if (im && path[path.length - 1].match(/^interface\s+"/)) {
        var io = ifo(d, im[1], ln);
        if ((m = s.match(/^port\s+(\S+)/))) io.port = m[1];
        else if ((m = s.match(/^sap\s+(\S+)/))) io.port = io.port || m[1];
        if (vrf) io.vrf = vrf;
      }
      if ((m = s.match(/^interface\s+"([^"]+)"/)) && vrf) ifo(d, m[1], ln).vrf = vrf;
      if ((m = s.match(/^autonomous-system\s+(\d+)/))) bgpo(d, m[1], ln).as = d.bgp.as || m[1];
      else if ((m = s.match(/^router-id\s+(\S+)/)) && !vrf) { d.ridS = m[1]; if (d.bgp) d.bgp.rid = m[1]; d.ospf.forEach(function (o) { o.rid = o.rid || m[1]; }); }
      // static
      var se = find(path, /^static-route-entry\s+(\S+)/);
      if (se && (m = s.match(/^next-hop\s+(\S+)/))) pushStatic(d, vrf, se[1], m[1], ln);
      else if ((m = s.match(/^static-route\s+(\S+)\s+next-hop\s+(\S+)/))) pushStatic(d, vrf, m[1], m[2], ln);
      // OSPF
      var op = find(path, /^ospf(?:\s+(\d+))?(?:\s+\S+)?$/), ar = find(path, /^area\s+(\S+)/);
      if (op && ar) {
        var pid = op[1] || '0', o = ospfo(d, pid, vrf, ln); o.rid = o.rid || d.ridS || '';
        var oi = s.match(/^interface\s+"([^"]+)"/);
        if (oi) setOspfIf(d, oi[1], pid, ar[1], ln);
        else { var pi = find(path, /^interface\s+"([^"]+)"/); if (pi && ar) { if (s === 'passive') { if (o.passive.indexOf(pi[1]) < 0) o.passive.push(pi[1]); } else if ((m = s.match(/^interface-type\s+(\S+)/))) (ifo(d, pi[1], ln).ospf || {}).network = m[1]; else if ((m = s.match(/^metric\s+(\d+)/))) (ifo(d, pi[1], ln).ospf || {}).cost = Number(m[1]); } }
      }
      // BGP
      if (find(path, /^bgp$/)) {
        var nb = find(path, /^neighbor\s+(\d+\.\d+\.\d+\.\d+)/);
        if ((m = s.match(/^neighbor\s+(\d+\.\d+\.\d+\.\d+)/))) nbo(d, vrf, m[1], ln);
        else if (nb) { var n = nbo(d, vrf, nb[1], ln); if ((m = s.match(/^peer-as\s+(\d+)/))) n.remoteAs = m[1]; else if (/^type internal/.test(s)) n.internal = true; else if ((m = s.match(/^local-address\s+(\S+)/))) n.updSrc = m[1]; }
      }
    }, /^(#|exit\b|echo\s)/);
    if (d.bgp) Object.values(d.bgp.neighbors).forEach(function (n) { if (!n.remoteAs && n.internal) n.remoteAs = d.bgp.as; if (!n.updSrc && n.remoteAs && n.remoteAs === d.bgp.as) n.updSrc = 'system'; /* SR OS iBGP 기본 소스 = system 주소 */ });
    d.notes = d.notes.filter(function (x) { return !/호스트명·IP 인터페이스만/.test(x); });
    d.notes.push('Nokia SR OS: 인터페이스·Static·OSPF·BGP·VPRN(RD·RT)을 읽습니다. ACL(filter)·QoS는 아직 해석하지 않습니다.');
  }

  /* ── Extreme EXOS ── */
  function exos(d, text) {
    var L = String(text).split(/\r?\n/), m;
    var verm = text.match(/^#\s*(?:Software Version|ExtremeXOS version)\s+(\S+)/mi); if (verm && !d.os) d.os = 'EXOS ' + verm[1];
    L.forEach(function (raw, i) {
      var s = raw.trim(), ln = i + 1;
      if ((m = s.match(/^configure iproute add default\s+(\S+)/i))) pushStatic(d, '', '0.0.0.0/0', m[1], ln);
      else if ((m = s.match(/^configure iproute add\s+(\d+\.\d+\.\d+\.\d+)(?:\/(\d+)|\s+(\d+\.\d+\.\d+\.\d+))\s+(\d+\.\d+\.\d+\.\d+)/i))) pushStatic(d, '', m[1] + '/' + (m[2] || m2p(m[3])), m[4], ln);
      else if ((m = s.match(/^configure ospf routerid\s+(\S+)/i))) ospfo(d, '0', '', ln).rid = m[1];
      else if ((m = s.match(/^configure ospf add vlan\s+(\S+)\s+area\s+(\S+)(.*)$/i))) { ospfo(d, '0', '', ln); var io = setOspfIf(d, m[1].replace(/"/g, ''), '0', m[2], ln); if (/passive/i.test(m[3])) { var o = ospfo(d, '0', '', ln); if (o.passive.indexOf(io.name) < 0) o.passive.push(io.name); } }
      else if ((m = s.match(/^configure bgp as-number\s+(\d+)/i))) bgpo(d, m[1], ln).as = m[1];
      else if ((m = s.match(/^configure bgp routerid\s+(\S+)/i))) bgpo(d, '', ln).rid = m[1];
      else if ((m = s.match(/^create bgp neighbor\s+(\S+)\s+remote-as-number\s+(\d+)/i))) nbo(d, '', m[1], ln).remoteAs = m[2];
    });
    d.notes = d.notes.filter(function (x) { return !/호스트명·IP 인터페이스만/.test(x); });
    d.notes.push('EXOS: VLAN IP·Static·OSPF·BGP 이웃을 읽습니다. ACL·QoS는 아직 해석하지 않습니다.');
  }

  /* ── VOSS · ALE · A10: Static 경로 ── */
  function statics(d, text, v) {
    String(text).split(/\r?\n/).forEach(function (raw, i) {
      var s = raw.trim(), ln = i + 1, m;
      if (v === 'voss' && (m = s.match(/^ip route\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/))) pushStatic(d, '', m[1] + '/' + m2p(m[2]), m[3], ln);
      else if (v === 'ale' && (m = s.match(/^ip static-route\s+(\d+\.\d+\.\d+\.\d+\/\d+)\s+gateway\s+(\S+)/))) pushStatic(d, '', m[1], m[2], ln);
      else if (v === 'a10' && (m = s.match(/^ip route\s+(\d+\.\d+\.\d+\.\d+)\s*\/(\d+)\s+(\S+)/))) pushStatic(d, '', m[1] + '/' + m[2], m[3], ln);
      else if (v === 'a10' && (m = s.match(/^ip route\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/))) pushStatic(d, '', m[1] + '/' + m2p(m[2]), m[3], ln);
    });
    if (d.statics.length) d.notes = d.notes.map(function (x) { return x.replace('호스트명·IP 인터페이스만 읽습니다', '호스트명·IP 인터페이스·Static 경로만 읽습니다'); });
  }
  window.__nxEnrich = function (d, text, vendor) {
    try {
      var v = d.vendor || vendor;
      if (v === 'cisco' || v === 'arista') cisco(d, text);
      else if (v === 'juniper') junos(d);
      else if (v === 'nokia') sros(d, text);
      else if (v === 'exos') exos(d, text);
      else if (v === 'voss' || v === 'ale' || v === 'a10') statics(d, text, v);
    } catch (e) { (d.notes || (d.notes = [])).push('보강 해석 중 오류: ' + e.message); }
    return d;
  };
})();

/* ── 추가 검증 (앱 검증기 끝에서 호출): OS 계열별 문법 확인 ── */
(function () {
  'use strict';
  window.__nxExtra = function (topo, devs, add) {
    Object.keys(devs).forEach(function (id) {
      var x = devs[id], d = x && x.dev, node = x && x.node; if (!node) return;
      var isNX = (d && d.osFamily === 'nxos') || /nx/i.test(node.os || '') || /nexus|^n\d?k|^n9k|^n3k|^n5k|^n7k/i.test(node.model || '');
      var isXR = (d && d.osFamily === 'iosxr') || /ios ?xr/i.test(node.os || '') || /asr9|ncs-?5|ncs-?540|^asr 9|xrv/i.test(node.model || '');
      if (d && node.vendor === 'cisco' && isNX) {
        d.ospf.forEach(function (o) { (o.networks || []).forEach(function (nw) { add('error', '라우팅(OSPF)', id, nw.line, 'NX-OS는 router ospf 아래 network 명령을 지원하지 않습니다 (' + nw.net + '/' + nw.prefix + ')', 'NX-OS는 인터페이스 아래 ip router ospf <태그> area <Area>로 OSPF에 넣음 — 이 줄은 거부되거나 OSPF가 동작하지 않음', '해당 인터페이스에 ip router ospf ' + o.pid + ' area ' + nw.area + ' 를 넣으세요'); }); });
        var f = (d.features || []).map(function (s) { return String(s).toLowerCase(); });
        if (d.ospf.length && f.indexOf('ospf') < 0) add('error', '라우팅(OSPF)', id, d.ospf[0].line, 'NX-OS에 feature ospf가 없습니다', 'NX-OS는 기능을 먼저 켜야 router ospf 명령을 받음', 'feature ospf 를 넣으세요');
        if (d.bgp && f.indexOf('bgp') < 0) add('error', '라우팅(BGP·RR)', id, d.bgp.line, 'NX-OS에 feature bgp가 없습니다', 'NX-OS는 기능을 먼저 켜야 router bgp 명령을 받음', 'feature bgp 를 넣으세요');
      }
      if (node.vendor === 'cisco' && isXR && x.origin === '생성') add('warn', '생성 CONFIG', id, null, node.hostname + '(IOS XR)용 생성 CONFIG는 IOS 문법입니다', '앱의 Cisco 생성기는 IOS/IOS XE·NX-OS 기준 — IOS XR은 ipv4 address·router static·RPL 등 문법이 달라 그대로 적용 불가', 'IOS XR 장비는 업로드 CONFIG로 검증만 하고, 적용 CONFIG는 직접 작성하세요');
    });
  };
})();
