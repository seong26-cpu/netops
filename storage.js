/* NetOps 공개판 — 내 저장소(PC 폴더) 연동 · 표준 CONFIG 팩
   저장 순서: ① 내가 지정한 PC 폴더(Chrome·Edge PC) ② 이 브라우저 임시 저장(IndexedDB) ③ 백업 파일
   폴더 구조:  <지정 폴더>/data/*.json (구성도·설정·작업)  /standard-pack/*.txt  /backup/*.json  /exports/*.txt
   앱 본체(React)보다 먼저 읽혀야 한다 (window.__nxStore 를 앱이 시작할 때 기다림). */
(function () {
  'use strict';
  var HAS_FS = typeof window.showDirectoryPicker === 'function';
  var state = { kind: 'none', name: '', handle: null }; // kind: folder | reconnect | none | unsupported
  if (!HAS_FS) state.kind = 'unsupported';
  window.__nxStoreState = state;

  /* ── 폴더 핸들 보관용 작은 IndexedDB ── */
  function kv() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('netops-store', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  // (자동 테스트용 대체 경로 — 일반 사용에서는 window.__nxDirProvider 가 없음)
  var TP = window.__nxDirProvider || null;
  function kvGet(k) { if (TP && k === 'dir') return TP.get(); return kvGet0(k); }
  function kvSet(k, v) { if (TP && k === 'dir') return TP.set(v); return kvSet0(k, v); }
  function kvGet0(k) { return kv().then(function (d) { return new Promise(function (res) { var q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function kvSet0(k, v) { return kv().then(function (d) { return new Promise(function (res) { var t = d.transaction('kv', 'readwrite'); if (v == null) t.objectStore('kv').delete(k); else t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); }).catch(function () {}); }

  /* ── 폴더 읽기·쓰기 ── */
  function sub(dir, name) { return dir.getDirectoryHandle(name, { create: true }); }
  function writeText(dir, name, text) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return w.write(text).then(function () { return w.close(); }); });
  }
  function readDocs(root) {
    return sub(root, 'data').then(function (d) {
      var out = {}, jobs = [];
      var it = d.values();
      function step() {
        return it.next().then(function (r) {
          if (r.done) return Promise.all(jobs).then(function () { return out; });
          var h = r.value;
          if (h.kind === 'file' && /\.json$/.test(h.name)) {
            jobs.push(h.getFile().then(function (f) { return f.text(); }).then(function (t) {
              try { var j = JSON.parse(t); out[h.name.replace(/\.json$/, '')] = j && j.app === 'netops-doc' ? j.v : j; } catch (e) { /* 깨진 파일은 건너뜀 */ }
            }));
          }
          return step();
        });
      }
      return step();
    });
  }
  // 앱 저장소가 쓰는 collection 모양 (doc().set/delete, onSnapshot)
  function folderCol(root) {
    var dataDir = sub(root, 'data');
    var safe = function (k) { return String(k).replace(/[^\w.-]/g, '_'); };
    return {
      doc: function (key) {
        return {
          set: function (body) { return dataDir.then(function (d) { return writeText(d, safe(key) + '.json', JSON.stringify({ app: 'netops-doc', key: key, at: body.at || Date.now(), v: body.v }, null, 1)); }); },
          delete: function () { return dataDir.then(function (d) { return d.removeEntry(safe(key) + '.json').catch(function () {}); }); }
        };
      },
      onSnapshot: function (cb, err) {
        var off = false;
        readDocs(root).then(function (docs) {
          if (off) return;
          var arr = Object.keys(docs).map(function (k) { return { id: k, data: function () { return { v: docs[k] }; } }; });
          cb({ metadata: { fromCache: false }, size: arr.length, docs: arr, docChanges: function () { return []; } });
        }).catch(function (e) { if (err) err(e); });
        return function () { off = true; };
      }
    };
  }

  /* ── 시작: 저장된 폴더가 있고 권한이 살아 있으면 그 폴더 사용 ── */
  window.__nxStore = (!HAS_FS ? Promise.resolve(null) : kvGet('dir').then(function (h) {
    if (!h) return null;
    state.handle = h; state.name = h.name;
    return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p !== 'granted') { state.kind = 'reconnect'; return null; }
      state.kind = 'folder';
      return { col: folderCol(h), name: h.name };
    });
  }).catch(function () { return null; }));
  // 5초 넘게 걸리면 이 브라우저 저장으로 시작
  window.__nxStore = Promise.race([window.__nxStore, new Promise(function (r) { setTimeout(function () { r(null); }, 5000); })]);

  /* ── 이 브라우저(IndexedDB 'netops' docs)에 있는 내용 읽기 → 폴더 연결 전 백업용 ── */
  function browserDocs() {
    return new Promise(function (res) {
      var r = indexedDB.open('netops');
      r.onsuccess = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('docs')) { d.close(); return res({}); }
        var st = d.transaction('docs').objectStore('docs'), out = {};
        var c = st.openCursor();
        c.onsuccess = function () { var cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } else { d.close(); res(out); } };
        c.onerror = function () { res({}); };
      };
      r.onerror = function () { res({}); };
    });
  }
  function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }

  /* ── 폴더 지정 / 다시 연결 / 해제 ── */
  function pickFolder() {
    if (!HAS_FS) { toast('이 브라우저는 폴더 지정이 안 돼요. PC의 Chrome·Edge에서 열어 주세요.'); return; }
    window.showDirectoryPicker({ id: 'netops', mode: 'readwrite', startIn: 'documents' }).then(function (h) {
      return h.requestPermission({ mode: 'readwrite' }).then(function (p) {
        if (p !== 'granted') throw new Error('권한이 허용되지 않았어요');
        busy('폴더를 준비하는 중…');
        return Promise.all([readDocs(h), browserDocs()]).then(function (r) {
          var inFolder = Object.keys(r[0]).length, inBrowser = r[1];
          var jobs = [];
          // 폴더에 이미 데이터가 있으면 폴더 내용이 우선 → 지금 브라우저 내용은 backup/ 에 보관 (잃어버리지 않게)
          if (inFolder && Object.keys(inBrowser).length) {
            jobs.push(sub(h, 'backup').then(function (b) { return writeText(b, 'browser-' + stamp() + '.json', JSON.stringify({ app: 'netops', version: 4, exportedAt: new Date().toISOString(), settings: inBrowser.settings, topos: Object.keys(inBrowser).filter(function (k) { return /^t_/.test(k); }).reduce(function (a, k) { a[k.slice(2)] = inBrowser[k]; return a; }, {}), jobs: (inBrowser.jobs || {}).items || [] }, null, 1)); }));
          }
          jobs.push(writePack(h, true));
          jobs.push(writeText(h, 'README-NetOps.txt', README));
          return Promise.all(jobs).then(function () { return kvSet('dir', h); }).then(function () {
            try { localStorage.setItem('nx-onboard', 'done'); } catch (e) { /* */ }
            busy((inFolder ? '폴더의 저장 내용을 불러옵니다' : '지금 내용을 폴더로 옮깁니다') + ' — 화면을 다시 엽니다…');
            setTimeout(function () { location.reload(); }, 900);
          });
        });
      });
    }).catch(function (e) { busy(null); if (e && e.name !== 'AbortError') toast('폴더 지정 실패: ' + (e.message || e)); });
  }
  function reconnect() {
    if (!state.handle) return pickFolder();
    state.handle.requestPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') location.reload(); else toast('권한을 허용해야 폴더에 저장돼요');
    }).catch(function () { pickFolder(); });
  }
  function disconnect() {
    kvSet('dir', null).then(function () { toast('폴더 연결을 해제했어요 — 이제 이 브라우저에만 저장돼요'); setTimeout(function () { location.reload(); }, 900); });
  }

  /* ── 표준 CONFIG 팩 ── */
  var packP = null;
  function loadBase() { if (window.__nxPack) return Promise.resolve(window.__nxPack); return packP || (packP = fetch('./packs/standard-pack.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function (e) { packP = null; throw e; })); }
  /* ── 내 모델 자료 (사용자가 직접 넣는 자료) ──
     폴더: my-pack/my-models.txt (한 줄 = 벤더, 모델, OS, 포트구성, 출처URL)  ·  my-pack/templates/*.txt (@vendor: @os: @title: @comment: 머리줄 + CONFIG 줄, 맨 앞 ? = 확인 필요)
     폴더가 없으면 이 브라우저(localStorage nx-mypack)에 저장 */
  var MY_SAMPLE_MODELS = '# 내 모델 자료 — 한 줄에 하나: 벤더, 모델, OS, 포트구성, 출처URL(선택)\n# 포트구성 예: 48x1G-UTP+4x10G-OPTIC  (속도 1G·10G·100G, 매체 UTP·OPTIC)\n# 포트 이름을 직접 정하기: 그룹 뒤에 @시작이름\n#   4x10G-OPTIC@xe-0/1/0      → xe-0/1/0, xe-0/1/1, xe-0/1/2, xe-0/1/3\n#   6x100G-OPTIC@Ethernet{49}/1 → Ethernet49/1 … Ethernet54/1  ({ } 안 숫자가 1씩 증가)\n#   비워 두면 벤더 기본 규칙으로 자동 생성\n# 예) Cisco, C9300-48T, IOS-XE, 48x1G-UTP, https://...\n';
  var MY_SAMPLE_TPL = '@vendor: Cisco\n@os: IOS-XE\n@title: 우리 회사 표준 (예시)\n@comment: !\nhostname {{HOSTNAME}}\nntp server {{NTP1}}\n?예시: 맨 앞에 ? 를 붙인 줄은 [확인 필요]로 주석 처리돼요\n';
  var MY_SAMPLE_CARDS = '# 내 카드(라인카드·업링크 모듈) — 한 줄에 하나: 벤더, 카드명, 포트구성, 출처URL(선택)\n# 포트구성에서 $S 는 슬롯(또는 스택 멤버) 번호로 바뀜\n# 예) Juniper, EX-UM-4X4SFP, 4x10G-OPTIC@xe-0/2/0\n# 예) Cisco, C9300-NM-8X, 8x10G-OPTIC@TenGigabitEthernet$S/1/1\n';
  function parseCards(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) { var l = raw.replace(/\s+#.*$/, '').trim(); if (!l || l[0] === '#') return; var f = l.split(/\t|,/).map(function (x) { return x.trim(); }); if (f.length >= 3 && f[0] && f[1] && f[2]) out.push({ vendor: f[0], card: f[1], ports: f[2], src: f[3] || '', note: '내 자료', mine: 1 }); });
    return out;
  }
  function parseModels(text, srcName) {
    var out = [], bad = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, i) {
      var l = raw.replace(/\s+#.*$/, '').trim(); if (!l || l[0] === '#') return;
      var f = l.split(/\t|,/).map(function (x) { return x.trim(); });
      if (f.length < 3 || !f[0] || !f[1]) { bad.push((srcName || '') + ' ' + (i + 1) + '번째 줄'); return; }
      out.push({ vendor: f[0], model: f[1], os: f[2] || '', ports: f[3] || '', src: f[4] || '', note: '내 자료', chk: 1, mine: 1 });
    });
    return { models: out, bad: bad };
  }
  function parseTemplate(text, name) {
    var it = { id: 'my-' + String(name || 'tpl').replace(/\.txt$/i, '').replace(/[^\w.-]/g, '_'), vendor: '', os: '', title: '', comment: '!', sources: ['내 자료: ' + (name || '')], lines: [], mine: 1, file: name };
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var m = raw.match(/^@(vendor|os|title|comment|source)\s*:\s*(.*)$/i);
      if (m) { var k = m[1].toLowerCase(); if (k === 'source') it.sources = [m[2].trim()]; else it[k] = m[2].trim(); return; }
      if (!raw.trim()) return;
      if (raw[0] === '?') it.lines.push({ t: raw.slice(1), v: 0 }); else it.lines.push({ t: raw, v: 1 });
    });
    if (!it.title) it.title = (it.vendor + ' ' + it.os).trim() || it.id;
    return it.lines.length ? it : null;
  }
  function readFileText(dir, name) { return dir.getFileHandle(name).then(function (h) { return h.getFile(); }).then(function (f) { return f.text(); }); }
  function myLocal() { try { return JSON.parse(localStorage.getItem('nx-mypack') || 'null') || { models: MY_SAMPLE_MODELS, templates: [], cards: MY_SAMPLE_CARDS }; } catch (e) { return { models: MY_SAMPLE_MODELS, templates: [], cards: MY_SAMPLE_CARDS }; } }
  function saveMyLocal(o) { try { localStorage.setItem('nx-mypack', JSON.stringify(o)); return true; } catch (e) { return false; } }
  // 내 자료 원문 읽기 → { modelsText, templates:[{name,text}] }
  function readMyRaw() {
    if (state.kind !== 'folder') { var o = myLocal(); return Promise.resolve({ modelsText: o.models, templates: o.templates || [], cardsText: o.cards || MY_SAMPLE_CARDS }); }
    return sub(state.handle, 'my-pack').then(function (d) {
      return readFileText(d, 'my-models.txt').catch(function () { return MY_SAMPLE_MODELS; }).then(function (mt) {
        return sub(d, 'templates').then(function (td) {
          var list = [], it = td.values();
          function step() { return it.next().then(function (r) { if (r.done) return list; var h = r.value; if (h.kind === 'file' && /\.txt$/i.test(h.name)) return h.getFile().then(function (f) { return f.text(); }).then(function (t) { list.push({ name: h.name, text: t }); return step(); }); return step(); }); }
          return step().then(function (tl) { return readFileText(d, 'my-cards.txt').catch(function () { return MY_SAMPLE_CARDS; }).then(function (ct) { return { modelsText: mt, templates: tl.sort(function (a, b) { return a.name < b.name ? -1 : 1; }), cardsText: ct }; }); });
        });
      });
    });
  }
  function writeMyRaw(raw) {
    if (state.kind !== 'folder') return Promise.resolve(saveMyLocal({ models: raw.modelsText, templates: raw.templates, cards: raw.cardsText == null ? MY_SAMPLE_CARDS : raw.cardsText }));
    return sub(state.handle, 'my-pack').then(function (d) {
      return writeText(d, 'my-models.txt', raw.modelsText).then(function () { return raw.cardsText == null ? null : writeText(d, 'my-cards.txt', raw.cardsText); }).then(function () { return sub(d, 'templates'); }).then(function (td) {
        return Promise.all(raw.templates.map(function (t) { return writeText(td, t.name, t.text); }));
      });
    });
  }
  function removeMyTemplate(name) {
    if (state.kind !== 'folder') { var o = myLocal(); o.templates = (o.templates || []).filter(function (t) { return t.name !== name; }); saveMyLocal(o); return Promise.resolve(); }
    return sub(state.handle, 'my-pack').then(function (d) { return sub(d, 'templates'); }).then(function (td) { return td.removeEntry(name); });
  }
  // 기본 팩 + 내 자료 합치기
  function loadPack() {
    return loadBase().then(function (base) {
      return readMyRaw().catch(function () { return { modelsText: '', templates: [], cardsText: '' }; }).then(function (raw) {
        var pm = parseModels(raw.modelsText, 'my-models.txt');
        var items = raw.templates.map(function (t) { return parseTemplate(t.text, t.name); }).filter(Boolean);
        var pack = JSON.parse(JSON.stringify(base));
        pack.items = pack.items.concat(items); pack.ports = pack.ports.concat(pm.models); pack.cards = (pack.cards || []).concat(parseCards(raw.cardsText));
        pack.myRaw = raw; pack.myBad = pm.bad; pack.myCount = { models: pm.models.length, templates: items.length };
        return pack;
      });
    });
  }
  function portLine(p) { return [p.vendor, p.model, p.os, p.ports, (p.src || '').split(' , ')[0]].join(', ').replace(/(, )+$/, ''); }
  var VALS = {};
  function vals(pack) { var o = {}; pack.vars.forEach(function (v) { o[v.k] = VALS[v.k] != null && VALS[v.k] !== '' ? VALS[v.k] : v.def; }); return o; }
  function renderItem(it, pack, values, raw) {
    var V = values || {};
    if (raw) pack.vars.forEach(function (v) { V[v.k] = '{{' + v.k + '}}'; });
    var sub2 = function (t) { return t.replace(/\{\{(\w+)\}\}/g, function (m, k) { return V[k] != null ? V[k] : m; }); };
    var c = it.comment || '!';
    var ok = it.lines.filter(function (l) { return l.v; }).map(function (l) { return sub2(l.t); });
    var un = it.lines.filter(function (l) { return !l.v; }).map(function (l) { return c + ' ' + sub2(l.t); });
    var out = [c + ' NetOps 표준 팩 ' + pack.version + ' — ' + it.title, c + ' 출처: ' + it.sources.join(' , ')];
    if (it.note) out.push(c + ' 참고: ' + it.note);
    out.push(c + ' <...-직접입력> 칸은 장비에 넣기 전에 바꾸세요. 이 파일에 비밀번호를 저장하지 마세요.');
    out = out.concat(ok);
    if (un.length) { out.push(c + ' ── [확인 필요] 아래 줄은 문법을 공식 자료로 확인하지 못했어요. 장비 매뉴얼로 확인 후 맨 앞 "' + c + ' "를 지우고 쓰세요 ──'); out = out.concat(un); }
    return out.join('\n') + '\n';
  }
  function portsText(pack) { return pack.ports.filter(function (p) { return p.chk; }).map(portLine).join('\n'); }
  function portsDoc(pack) { return pack.ports.map(function (p) { return (p.chk ? '' : '# [확인 필요] ') + portLine(p) + (p.note ? '    # ' + p.note : '') + (p.nameRule ? '    # 이름: ' + p.nameRule + (p.nameChk ? ' (문서 확인)' : '') : ''); }).join('\n'); }
  function writePack(root, raw) {
    return loadBase().then(function (pack) {
      return sub(root, 'standard-pack').then(function (d) {
        var jobs = pack.items.map(function (it) { return writeText(d, it.id + '.txt', renderItem(it, pack, {}, raw)); });
        jobs.push(writeText(d, 'model-ports.txt', '# 설정 › 모델 목록에 붙여넣는 형식 (벤더, 모델, OS, 포트구성, 출처)\n# 포트 이름 직접 지정: 4x10G-OPTIC@xe-0/1/0 , 6x100G-OPTIC@Ethernet{49}/1\n# ' + (pack.portRule || '') + '\n' + portsDoc(pack) + '\n'));
        // 내 자료 폴더와 예시 파일 (이미 있으면 그대로 둠)
        jobs.push(sub(root, 'my-pack').then(function (m) {
          return m.getFileHandle('my-models.txt').catch(function () { return writeText(m, 'my-models.txt', MY_SAMPLE_MODELS); }).then(function () { return m.getFileHandle('my-cards.txt').catch(function () { return writeText(m, 'my-cards.txt', MY_SAMPLE_CARDS); }); }).then(function () { return sub(m, 'templates'); })
            .then(function (t) { return t.getFileHandle('_example.txt.sample').catch(function () { return writeText(t, '_example.txt.sample', MY_SAMPLE_TPL); }); });
        }));
        jobs.push(writeText(d, 'index.json', JSON.stringify(pack, null, 1)));
        return Promise.all(jobs);
      });
    });
  }
  /* 압축 없는 ZIP (폴더 지정이 안 되는 브라우저용) */
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var DD = (function () { var d = new Date(); return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(); })();
  function zip(files) {
    var enc = new TextEncoder(), parts = [], cen = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(12, DD, true); h.setUint16(26, name.length, true);
      parts.push(h.buffer, name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(14, DD, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cen.push(c.buffer, name);
      off += 30 + name.length + data.length;
    });
    var cs = cen.reduce(function (a, b) { return a + (b.byteLength || b.length); }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [e.buffer]), { type: 'application/zip' });
  }
  function download(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function packZip() {
    loadBase().then(function (pack) {
      var files = pack.items.map(function (it) { return { name: 'standard-pack/' + it.id + '.txt', text: renderItem(it, pack, {}, true) }; });
      files.push({ name: 'standard-pack/model-ports.txt', text: portsDoc(pack) + '\n' }, { name: 'my-pack/my-models.txt', text: MY_SAMPLE_MODELS }, { name: 'my-pack/templates/_example.txt.sample', text: MY_SAMPLE_TPL }, { name: 'standard-pack/index.json', text: JSON.stringify(pack, null, 1) }, { name: 'README-NetOps.txt', text: README });
      download('netops-standard-pack-' + pack.version + '.zip', zip(files));
    }).catch(function () { toast('표준 팩을 불러오지 못했어요 (인터넷 연결 확인)'); });
  }

  /* 모델 목록에 포트 구성 바로 넣기: 설정 화면의 입력칸을 채우고 '목록에 추가'를 누름 */
  function addPorts(lines) {
    var go = function () {
      var ta = document.getElementById('cat-in');
      if (!ta) return false;
      var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, lines); ta.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(function () {
        var btn = Array.prototype.find.call(ta.parentElement.querySelectorAll('button'), function (b) { return /목록에 추가/.test(b.textContent) && !b.disabled; });
        if (btn) btn.click(); else toast('설정 › 모델 목록 칸에 넣어 두었어요. 확인 후 "목록에 추가"를 누르세요');
        ta.scrollIntoView({ block: 'center' });
      }, 250);
      return true;
    };
    close();
    var nav = document.getElementById('nav-settings');
    if (nav) nav.click(); else location.hash = 'settings';
    var n = 0; var t = setInterval(function () { if (go() || ++n > 20) clearInterval(t); }, 150);
  }

  /* ── 화면 ── */
  var css = '' +
    '.sx-ov{position:fixed;inset:0;z-index:1000;background:rgba(10,14,20,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.sx-card{background:var(--surface,#fff);color:var(--ink,#111418);width:min(760px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:14px;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.3);font:14px/1.55 "Noto Sans KR",Inter,system-ui,sans-serif;border:1px solid var(--line,#e4e7ec)}' +
    '.sx-card h3{margin:0 0 4px;font-size:18px}.sx-card h4{margin:16px 0 6px;font-size:14.5px}' +
    '.sx-mu{color:var(--muted,#5b6573);font-size:13px}.sx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}' +
    '.sx-b{font:inherit;font-weight:600;border-radius:9px;padding:9px 14px;border:1px solid var(--line,#d0d5dd);background:var(--surface-2,#f3f5f7);color:var(--ink,#111418);cursor:pointer}' +
    '.sx-b.p{background:var(--accent,#2b59ff);border-color:var(--accent,#2b59ff);color:#fff}.sx-b.w{color:var(--bad,#b4321f)}.sx-b:disabled{opacity:.5;cursor:default}' +
    '.sx-opt{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:12px 0}' +
    '.sx-o{border:1px solid var(--line,#e4e7ec);border-radius:12px;padding:12px;background:var(--surface-2,#f7f8fa);display:flex;flex-direction:column;gap:6px}' +
    '.sx-o b{font-size:14.5px}.sx-o.rec{border-color:var(--accent,#2b59ff);box-shadow:0 0 0 1px var(--accent,#2b59ff) inset}' +
    '.sx-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:1px 6px;background:var(--accent,#2b59ff);color:#fff;margin-left:6px}' +
    '.sx-st{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--surface-2,#f3f5f7);border:1px solid var(--line,#e4e7ec)}' +
    '.sx-dot{width:10px;height:10px;border-radius:50%;flex:none}.sx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}' +
    '.sx-grid label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--muted,#5b6573)}' +
    '.sx-grid input,.sx-card select{font:inherit;color:var(--ink,#111418);background:var(--surface,#fff);border:1px solid var(--line,#d0d5dd);border-radius:8px;padding:7px 9px;min-width:0}' +
    '.sx-pre{font:12.5px/1.5 "JetBrains Mono",ui-monospace,monospace;background:var(--surface-2,#f3f5f7);border:1px solid var(--line,#e4e7ec);border-radius:10px;padding:10px 12px;white-space:pre;overflow:auto;max-height:340px;margin:8px 0}' +
    '.sx-x{float:right;background:none;border:0;font-size:22px;line-height:1;color:var(--muted,#5b6573);cursor:pointer}' +
    '.sx-tree{font:12.5px/1.6 "JetBrains Mono",ui-monospace,monospace;color:var(--muted,#5b6573);margin:6px 0 0;padding-left:4px}' +
    '#btn-folder{white-space:nowrap}@media (max-width:640px){#btn-folder .t{display:none}}' +
    '#btn-manual-pdf{display:none!important}' +
    '.sx-busy{position:fixed;left:50%;top:20px;transform:translateX(-50%);z-index:1002;background:#111418;color:#fff;padding:10px 16px;border-radius:10px;font:13.5px "Noto Sans KR",system-ui,sans-serif}' +
    '.sx-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:max(20px,env(safe-area-inset-bottom));z-index:1003;background:#111418;color:#fff;padding:9px 14px;border-radius:8px;font:13px "Noto Sans KR",system-ui,sans-serif;max-width:92vw}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  function toast(m) { var t = document.createElement('div'); t.className = 'sx-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  var busyEl = null;
  function busy(m) { if (!m) { if (busyEl) busyEl.remove(); busyEl = null; return; } if (!busyEl) { busyEl = document.createElement('div'); busyEl.className = 'sx-busy'; document.body.appendChild(busyEl); } busyEl.textContent = m; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var ov = null;
  function close() { if (ov) { ov.remove(); ov = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function shell(html) {
    close();
    ov = document.createElement('div'); ov.className = 'sx-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="sx-card" id="sx-card"><button class="sx-x" data-a="close" aria-label="닫기">×</button>' + html + '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) return close(); var a = e.target.closest('[data-a]'); if (a) act(a.getAttribute('data-a'), a); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    return ov;
  }

  function statusHtml() {
    var map = {
      folder: ['#1f7a4e', '<b>폴더에 저장 중</b> — 📁 ' + esc(state.name), '모든 변경이 이 폴더의 <span class="mono">data/*.json</span> 파일로 자동 저장돼요. 이 브라우저에도 사본이 남아요.'],
      reconnect: ['#c26a00', '<b>폴더 다시 연결 필요</b> — 📁 ' + esc(state.name), '브라우저를 다시 열면 보안상 권한을 한 번 더 물어요. 아래 <b>폴더 다시 연결</b>을 누르세요. (Chrome에서 "방문할 때마다 허용"을 고르면 다음부터는 안 물어요)'],
      none: ['#b4321f', '<b>이 브라우저에만 임시 저장 중</b>', '브라우저 기록을 지우면 사라질 수 있어요. <b>저장 폴더 지정</b>을 권장해요.'],
      unsupported: ['#b4321f', '<b>이 브라우저에만 임시 저장 중</b> (폴더 지정 미지원 브라우저)', '폴더 지정은 PC의 <b>Chrome·Edge</b>에서만 돼요. 여기서는 <b>설정 › 백업 파일 저장</b>으로 내 저장소(드라이브·USB 등)에 보관하세요.']
    }[state.kind];
    return '<div class="sx-st"><span class="sx-dot" style="background:' + map[0] + '"></span><div>' + map[1] + '<div class="sx-mu">' + map[2] + '</div></div></div>';
  }

  function openStorage() {
    loadPack().catch(function () {});
    var b = '';
    if (state.kind === 'folder') b = '<button class="sx-b" data-a="pick">다른 폴더로 변경</button><button class="sx-b" data-a="writeall">표준 팩 다시 받기(폴더)</button><button class="sx-b w" data-a="disc">연결 해제</button>';
    else if (state.kind === 'reconnect') b = '<button class="sx-b p" data-a="recon">폴더 다시 연결</button><button class="sx-b" data-a="pick">다른 폴더 지정</button><button class="sx-b w" data-a="disc">연결 해제</button>';
    else if (state.kind === 'none') b = '<button class="sx-b p" data-a="pick">📁 저장 폴더 지정</button>';
    var h = '<h3>저장소 · 표준 CONFIG 팩</h3><p class="sx-mu">NetOps는 계정·서버 없이 <b>내 저장소</b>에만 저장해요. 운영자를 포함해 다른 사람은 내 내용을 볼 수 없어요.</p>' +
      statusHtml() + '<div class="sx-row">' + b + '<button class="sx-b" data-a="backup">백업 파일 저장·복원 (설정 화면)</button></div>' +
      '<div class="sx-tree">📁 ' + esc(state.name || '내 폴더') + '<br>├ data/ — 구성도·설정·작업 (자동 저장)<br>├ standard-pack/ — 벤더·OS별 표준 CONFIG, 모델 포트 구성<br>├ exports/ — 여기서 만든 CONFIG<br>├ my-pack/ — 내 모델 자료 (직접 추가·파일 넣기)<br>└ backup/ — 폴더 연결 전 브라우저 내용 보관</div>' +
      '<p class="sx-mu">💡 고른 폴더가 <b>구글 드라이브·OneDrive 동기화 폴더</b>나 <b>USB</b>면, 다른 PC에서도 같은 폴더를 지정해 이어서 쓸 수 있어요.</p>' +
      '<h4>표준 CONFIG 팩 <span class="sx-mu" id="sx-pv"></span></h4>' +
      '<p class="sx-mu">벤더·OS별 기본 보안·관리 틀(hostname·SSH·계정·NTP·Syslog·SNMPv3·배너). 공식 자료로 문법을 확인한 줄만 그대로 나오고, 확인 못 한 줄은 <b>[확인 필요]</b>로 주석 처리돼요. 앱을 열어 둔 상태면 인터넷 없이도 써요.</p>' +
      '<div class="sx-row"><select id="sx-item" aria-label="벤더·OS"></select><button class="sx-b" data-a="zip">팩 전체 ZIP 받기</button></div>' +
      '<div class="sx-grid" id="sx-vars"></div>' +
      '<pre class="sx-pre" id="sx-out">불러오는 중…</pre>' +
      '<div class="sx-row"><button class="sx-b p" data-a="copy">복사</button><button class="sx-b" data-a="savecfg">' + (state.kind === 'folder' ? '폴더(exports)에 저장' : '파일로 받기') + '</button><span class="sx-mu">비밀번호 칸은 화면에서만 쓰고 저장하지 않아요.</span></div>' +
      '<h4>모델별 포트 구성 <span class="sx-mu" id="sx-pc"></span></h4><p class="sx-mu">데이터시트로 확인한 모델 + <b>내 모델 자료</b>예요. 누르면 <b>설정 › 모델 목록</b>에 바로 추가돼요. <b>[확인 필요]</b> 줄은 빠져요.</p><pre class="sx-pre" id="sx-ports"></pre>' +
      '<div class="sx-row"><button class="sx-b p" data-a="ports">모델 목록에 추가</button></div>' +
      '<h4>내 모델 자료 — 직접 추가</h4><p class="sx-mu">' + (state.kind === 'folder' ? '저장 위치: 📁 <b>' + esc(state.name) + '/my-pack/</b> — 이 폴더에 <span class="mono">my-models.txt</span>나 <span class="mono">templates/*.txt</span> 파일을 직접 넣어도 돼요.' : '저장 위치: <b>이 브라우저</b> (폴더를 지정하면 폴더의 my-pack/ 에 저장돼요). <b>내보내기</b>로 파일 보관을 권장해요.') + '</p>' +
      '<label class="sx-mu" for="sx-my-models">모델 (한 줄: 벤더, 모델, OS, 포트구성, 출처URL)</label><textarea id="sx-my-models" rows="5" class="sx-pre" style="width:100%;white-space:pre;box-sizing:border-box"></textarea>' +
      '<div class="sx-row"><button class="sx-b p" data-a="mysave">모델 저장</button><span class="sx-mu" id="sx-my-msg"></span></div>' +
      '<label class="sx-mu" for="sx-my-tpl">내 CONFIG 틀 (@vendor: @os: @title: @comment: 머리줄 + CONFIG, {{HOSTNAME}} 같은 변수 사용, 맨 앞 ? = 확인 필요)</label>' +
      '<div class="sx-row"><select id="sx-my-list" aria-label="내 틀 목록"></select><input id="sx-my-name" placeholder="파일 이름 (예: our-iosxe.txt)" style="font:inherit;padding:7px 9px;border:1px solid var(--line,#d0d5dd);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#111418);min-width:0;flex:1"></div>' +
      '<textarea id="sx-my-tpl" rows="7" class="sx-pre" style="width:100%;white-space:pre;box-sizing:border-box"></textarea>' +
      '<div class="sx-row"><button class="sx-b p" data-a="tplsave">틀 저장</button><button class="sx-b w" data-a="tpldel">이 틀 삭제</button></div>' +
      '<div class="sx-row"><button class="sx-b" data-a="myexport">내 자료 내보내기 (파일)</button><label class="sx-b" style="display:inline-flex;align-items:center">내 자료 가져오기<input type="file" id="sx-my-import" accept=".txt,.json,.csv" multiple hidden></label>' + (state.kind === 'folder' ? '<button class="sx-b" data-a="myreload">폴더 다시 읽기</button>' : '') + '</div>';
    shell(h);
    loadPack().then(function (pack) {
      document.getElementById('sx-pv').textContent = 'v' + pack.version + ' · ' + pack.items.length + '종';
      var sel = document.getElementById('sx-item');
      sel.innerHTML = pack.items.map(function (it) { var u = it.lines.filter(function (l) { return !l.v; }).length; return '<option value="' + it.id + '">' + (it.mine ? '★ 내 틀 · ' : '') + esc(it.vendor + ' · ' + it.os + (it.mine ? ' — ' + it.title : '')) + (u ? ' (확인 필요 ' + u + '줄)' : '') + '</option>'; }).join('');
      var last = null; try { last = localStorage.getItem('nx-pack-item'); } catch (e) { /* */ }
      if (last && pack.items.some(function (i) { return i.id === last; })) sel.value = last;
      document.getElementById('sx-vars').innerHTML = pack.vars.map(function (v) {
        return '<label>' + esc(v.label) + '<input data-k="' + v.k + '" ' + (v.secret ? 'type="password" autocomplete="new-password" ' : '') + 'placeholder="' + esc(v.def) + '" value="' + esc(VALS[v.k] || '') + '"></label>';
      }).join('');
      document.getElementById('sx-ports').textContent = portsDoc(pack);
      var vc = {}; pack.ports.forEach(function (p) { vc[p.vendor] = (vc[p.vendor] || 0) + 1; });
      document.getElementById('sx-pc').textContent = pack.ports.length + '개 · ' + Object.keys(vc).map(function (k) { return k + ' ' + vc[k]; }).join(' · ');
      fillMine(pack);
      var draw = function () { var it = pack.items.find(function (i) { return i.id === sel.value; }); document.getElementById('sx-out').textContent = renderItem(it, pack, vals(pack)); try { localStorage.setItem('nx-pack-item', sel.value); } catch (e) { /* */ } };
      sel.addEventListener('change', draw);
      document.getElementById('sx-vars').addEventListener('input', function (e) { var k = e.target.getAttribute('data-k'); if (k) { VALS[k] = e.target.value; draw(); } });
      draw();
    }).catch(function () { var o = document.getElementById('sx-out'); if (o) o.textContent = '표준 팩을 불러오지 못했어요. 인터넷에 연결된 상태로 한 번 열면 그 뒤로는 오프라인에서도 열려요.'; });
  }

  function openWelcome() {
    var rec = state.kind === 'unsupported' ? '' : ' rec';
    shell('<h3>👋 NetOps에 오신 걸 환영해요</h3><p class="sx-mu">계정·로그인 없이 쓰는 멀티벤더 네트워크 운용 콘솔이에요. 먼저 <b>어디에 저장할지</b> 골라 주세요.' + (location.protocol === 'file:' ? ' <b>로컬판</b>이라 인터넷·서버 없이 이 파일 하나로 동작해요.' : '') + ' 나중에 왼쪽 메뉴 <b>관리 › 저장소·표준 팩</b>에서 바꿀 수 있어요.</p>' +
      '<div class="sx-opt">' +
      '<div class="sx-o' + rec + '"><b>📁 내 PC 폴더' + (rec ? '<span class="sx-tag">추천</span>' : '') + '</b><span class="sx-mu">고른 폴더에 파일로 자동 저장. 표준 CONFIG 팩도 그 폴더에 미리 내려받아요. (PC Chrome·Edge)</span>' +
      (HAS_FS ? '<button class="sx-b p" data-a="pick">폴더 고르기</button>' : '<span class="sx-mu"><b>이 브라우저는 지원 안 함</b> — PC의 Chrome·Edge로 여세요</span>') + '</div>' +
      '<div class="sx-o"><b>🌐 이 브라우저에만</b><span class="sx-mu">바로 시작. 기록을 지우면 사라질 수 있으니 <b>설정 › 백업 파일 저장</b>으로 내 드라이브·USB에 보관하세요.</span><button class="sx-b" data-a="local">이대로 시작</button></div>' +
      '</div><div class="sx-row"><button class="sx-b" data-a="zip">표준 CONFIG 팩 ZIP만 받기</button><span class="sx-mu">비밀번호·장비 출력은 어디에도 저장하지 않아요.</span></div>');
  }

  function act(a) {
    if (a === 'close') close();
    else if (a === 'pick') pickFolder();
    else if (a === 'recon') reconnect();
    else if (a === 'disc') { if (ov && ov.querySelector('[data-a="disc"]').getAttribute('data-sure')) disconnect(); else { var d = ov.querySelector('[data-a="disc"]'); d.setAttribute('data-sure', '1'); d.textContent = '한 번 더 누르면 해제 (폴더 파일은 남아요)'; } }
    else if (a === 'local') { try { localStorage.setItem('nx-onboard', 'done'); } catch (e) { /* */ } close(); toast('이 브라우저에 저장해요 — 설정 › 백업 파일 저장으로 가끔 보관하세요'); }
    else if (a === 'zip') packZip();
    else if (a === 'backup') { close(); var n = document.getElementById('nav-settings'); if (n) n.click(); }
    else if (a === 'writeall') { if (state.kind === 'folder') writePack(state.handle, true).then(function () { toast('standard-pack 폴더에 다시 받았어요'); }).catch(function (e) { toast('실패: ' + e.message); }); }
    else if (a === 'copy') { var t = document.getElementById('sx-out').textContent; var done = function () { toast('복사했어요'); }; if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function () { selectPre(); }); else selectPre(); }
    else if (a === 'savecfg') {
      var sel = document.getElementById('sx-item'), txt = document.getElementById('sx-out').textContent;
      var name = (VALS.HOSTNAME || 'device') + '-' + sel.value + '-' + stamp() + '.txt';
      if (state.kind === 'folder') sub(state.handle, 'exports').then(function (d) { return writeText(d, name, txt); }).then(function () { toast('exports/' + name + ' 저장'); }).catch(function (e) { toast('저장 실패: ' + e.message); });
      else download(name, new Blob([txt], { type: 'text/plain' }));
    }
    else if (a === 'ports') syncCatalog(true).then(function (r) { if (!r) loadPack().then(function (p) { addPorts(portsText(p)); }); else if (!r.added) toast('모델 목록에 이미 모두 들어 있어요'); });
    else if (a === 'mysave') readMyRaw().then(function (raw) { raw.modelsText = document.getElementById('sx-my-models').value; var pm = parseModels(raw.modelsText); return writeMyRaw(raw).then(function () { toast('내 모델 ' + pm.models.length + '개 저장' + (pm.bad.length ? ' (형식 오류 ' + pm.bad.length + '줄)' : '')); syncCatalog(false); refreshPack(); }); }).catch(function (e) { toast('저장 실패: ' + e.message); });
    else if (a === 'tplsave') {
      var txt2 = document.getElementById('sx-my-tpl').value, nm = document.getElementById('sx-my-name').value.trim();
      var it2 = parseTemplate(txt2, nm || 'my-template.txt');
      if (!it2 || !it2.vendor) { toast('@vendor: 줄과 CONFIG 줄이 필요해요'); return; }
      if (!nm) nm = (it2.vendor + '-' + it2.os).replace(/[^\w.-]+/g, '_').toLowerCase() + '.txt';
      readMyRaw().then(function (raw) { upsert(raw, { name: nm, text: txt2 }); return writeMyRaw(raw); }).then(function () { toast('틀 저장: ' + nm); try { localStorage.setItem('nx-pack-item', 'my-' + nm.replace(/\.txt$/i, '').replace(/[^\w.-]/g, '_')); } catch (e) { /* */ } openStorage(); }).catch(function (e) { toast('저장 실패: ' + e.message); });
    }
    else if (a === 'tpldel') { var nm2 = document.getElementById('sx-my-list').value; if (!nm2) return; removeMyTemplate(nm2).then(function () { toast('삭제: ' + nm2); refreshPack(); }); }
    else if (a === 'myexport') readMyRaw().then(function (raw) { download('netops-my-pack-' + stamp() + '.json', new Blob([JSON.stringify({ app: 'netops-mypack', exportedAt: new Date().toISOString(), models: raw.modelsText, templates: raw.templates, cards: raw.cardsText }, null, 1)], { type: 'application/json' })); });
    else if (a === 'myreload') { syncCatalog(false); refreshPack(); }
  }
  function fillMine(pack) {
    var raw = pack.myRaw || { modelsText: MY_SAMPLE_MODELS, templates: [] };
    var mm = document.getElementById('sx-my-models'); if (!mm) return;
    mm.value = raw.modelsText || MY_SAMPLE_MODELS;
    var ls = document.getElementById('sx-my-list');
    ls.innerHTML = '<option value="">+ 새 틀</option>' + raw.templates.map(function (t) { return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'; }).join('');
    var show = function () { var t = raw.templates.find(function (x) { return x.name === ls.value; }); document.getElementById('sx-my-tpl').value = t ? t.text : MY_SAMPLE_TPL; document.getElementById('sx-my-name').value = t ? t.name : ''; };
    ls.onchange = show; show();
    var msg = document.getElementById('sx-my-msg');
    msg.textContent = '내 모델 ' + pack.myCount.models + '개 · 내 틀 ' + pack.myCount.templates + '개' + (pack.myBad.length ? ' · 형식 오류: ' + pack.myBad.join(', ') : '');
    var imp = document.getElementById('sx-my-import');
    imp.onchange = function () { var fl = Array.prototype.slice.call(imp.files || []); imp.value = ''; importMine(fl); };
  }
  function refreshPack() { var keep = document.getElementById('sx-item') && document.getElementById('sx-item').value; try { if (keep) localStorage.setItem('nx-pack-item', keep); } catch (e) { /* */ } openStorage(); }
  function importMine(files) {
    if (!files || !files.length) return;
    readMyRaw().then(function (raw) {
      var jobs = Array.prototype.map.call(files, function (f) { return f.text().then(function (t) { return { name: f.name, text: t }; }); });
      return Promise.all(jobs).then(function (list) {
        var nM = 0, nT = 0;
        list.forEach(function (f) {
          if (/\.json$/i.test(f.name)) {
            try { var j = JSON.parse(f.text); if (j.app === 'netops-mypack') { if (j.models) { raw.modelsText = mergeLines(raw.modelsText, j.models); nM++; } if (j.cards) raw.cardsText = mergeLines(raw.cardsText || '', j.cards); (j.templates || []).forEach(function (t) { upsert(raw, t); nT++; }); } } catch (e) { /* */ }
          } else if (/^\s*@(vendor|os|title)\s*:/im.test(f.text)) { upsert(raw, { name: f.name.replace(/\.(csv)$/i, '.txt'), text: f.text }); nT++; }
          else { raw.modelsText = mergeLines(raw.modelsText, f.text); nM++; }
        });
        return writeMyRaw(raw).then(function () { toast('가져옴: 모델 파일 ' + nM + '개 · 틀 ' + nT + '개'); syncCatalog(false); refreshPack(); });
      });
    }).catch(function (e) { toast('가져오기 실패: ' + e.message); });
  }
  function mergeLines(a, b) { var seen = {}; return (String(a || '').replace(/\s+$/, '') + '\n' + String(b || '')).split(/\r?\n/).filter(function (l) { var k = l.trim(); if (!k || k[0] === '#') return true; if (seen[k]) return false; seen[k] = 1; return true; }).join('\n') + '\n'; }
  function upsert(raw, t) { var name = /\.txt$/i.test(t.name) ? t.name : t.name + '.txt'; raw.templates = raw.templates.filter(function (x) { return x.name !== name; }); raw.templates.push({ name: name, text: t.text }); }
  function selectPre() { var el = document.getElementById('sx-out'); var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('선택된 내용을 Ctrl+C로 복사하세요'); }

  var README = 'NetOps 저장 폴더\n================\n' +
    'data/           구성도·설정·작업 기록 (NetOps가 자동 저장. 직접 고치지 마세요)\n' +
    'standard-pack/  벤더·OS별 표준 CONFIG 틀 + 모델 포트 구성 ({{변수}}는 NetOps 화면에서 채워 쓰기)\n' +
    'exports/        NetOps에서 만든 CONFIG\n' +
    'my-pack/        내 모델 자료: my-models.txt(벤더, 모델, OS, 포트구성, 출처) · my-cards.txt(라인카드·모듈) · templates/*.txt(내 CONFIG 틀) — 직접 넣어도 됨\n' +
    'backup/         폴더 연결 전 브라우저에 있던 내용\n\n' +
    '* 비밀번호·장비 출력(running-config 원문)은 저장하지 않습니다.\n' +
    '* [확인 필요] 줄은 공식 자료로 문법을 확인하지 못한 줄입니다. 장비 매뉴얼로 확인 후 쓰세요.\n' +
    '* 이 폴더를 다른 PC에서 NetOps 저장 폴더로 지정하면 같은 내용으로 이어서 쓸 수 있습니다.\n';

  /* ── 왼쪽 메뉴 '관리 › 저장소·표준 팩' + 상단 '저장 폴더 지정' 버튼 ── */
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5 12 16l2.5-2.5"/></svg>';
  function ensure() {
    var set = document.getElementById('nav-settings'), mine = document.getElementById('nav-storage');
    if (set) {
      if (!mine) { mine = document.createElement('button'); mine.id = 'nav-storage'; mine.type = 'button'; mine.addEventListener('click', function (e) { e.preventDefault(); openStorage(); var sc = document.querySelector('.nav-scrim'); if (sc && window.innerWidth < 900) sc.click(); }); }
      if (mine.previousElementSibling !== set) set.insertAdjacentElement('afterend', mine);
      var cls = set.className.replace(/\b(active|is-active|current|on)\b/g, '').replace(/\s+/g, ' ').trim();
      if (mine.className !== cls) mine.className = cls;
      var html = ICON + '<span>저장소·표준 팩</span>';
      if (mine.getAttribute('data-h') !== html) { mine.innerHTML = html; mine.setAttribute('data-h', html); }
      var cnt = set.parentElement && set.parentElement.querySelector('.sec-count');
      if (cnt) { var n = set.parentElement.querySelectorAll('.nav-item').length; if (cnt.textContent !== String(n)) cnt.textContent = String(n); }
    }
    // 상단 저장 상태 배지 옆 버튼
    var help = document.getElementById('btn-help'), btn = document.getElementById('btn-folder');
    var anchor = document.getElementById('btn-theme') || help;
    if (anchor && state.kind !== 'folder') {
      if (!btn) { btn = document.createElement('button'); btn.id = 'btn-folder'; btn.type = 'button'; btn.className = 'btn sm'; btn.addEventListener('click', function () { if (state.kind === 'reconnect') reconnect(); else if (state.kind === 'none') pickFolder(); else openStorage(); }); }
      var label = state.kind === 'reconnect' ? '폴더 다시 연결' : state.kind === 'none' ? '저장 폴더 지정' : '저장 방법';
      var bh = '📁<span class="t"> ' + label + '</span>';
      if (btn.getAttribute('data-h') !== bh) { btn.innerHTML = bh; btn.setAttribute('data-h', bh); btn.title = label; }
      if (btn.nextElementSibling !== anchor) anchor.insertAdjacentElement('beforebegin', btn);
    } else if (btn && state.kind === 'folder') btn.remove();
  }
  /* ── 표준 팩·내 모델 자료 → 설정 › 모델 목록 자동 반영 ──
     구성도 속성의 '모델' 목록은 설정 › 모델 목록(catalog)에서 나온다. 팩을 받기만 하면 비어 있으므로,
     팩 버전이나 내 모델 자료가 바뀔 때마다 빠진 모델만 자동으로 넣는다 (사용자가 지운 모델은 같은 버전에서 다시 넣지 않음). */
  function hash(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h); }
  function syncCatalog(force) {
    var api = window.__nxStoreApi, cat = window.__nxCat;
    if (!api || !api.ready || !cat) return Promise.resolve(null);
    return loadPack().then(function (pack) {
      var text = portsText(pack), sig = pack.version + ':' + hash(text);
      var old = null; try { old = localStorage.getItem('nx-autoports-sig'); } catch (e) { /* */ }
      if (!force && old === sig) return null;
      var parsed = cat.parse(text), cur = (window.__nxStoreApi.settings || {}).catalog || [];
      var key = function (r) { return r.vendor + '|' + String(r.model).toUpperCase(); };
      var have = {}; cur.forEach(function (r) { have[key(r)] = r; });
      // 없는 모델 + 팩에서 포트 구성이 바뀐 모델(포트 이름 규칙 보완 등)
      var add = parsed.ok.filter(function (r) { var h = have[key(r)]; return !h || (r.ports && r.ports.length && JSON.stringify(h.ports || []) !== JSON.stringify(r.ports)); });
      try { localStorage.setItem('nx-autoports-sig', sig); } catch (e) { /* */ }
      if (!add.length) return { added: 0, bad: parsed.bad.length };
      window.__nxStoreApi.saveSettings({ catalog: cat.merge(cur, add) });
      return { added: add.length, bad: parsed.bad.length };
    }).then(function (r) { if (r && r.added) toast('표준 팩·내 자료 모델 ' + r.added + '개를 모델 목록에 자동으로 넣었어요' + (r.bad ? ' (형식 오류 ' + r.bad + '줄 제외)' : '')); return r; })
      .catch(function () { return null; });
  }
  window.__nxSyncCatalog = syncCatalog;
  window.__nxMyRaw = { read: readMyRaw, write: writeMyRaw };
  function autoSync() { var n = 0; var t = setInterval(function () { var api = window.__nxStoreApi; if ((api && api.ready && window.__nxCat) || ++n > 60) { clearInterval(t); setTimeout(function () { syncCatalog(false); }, 600); } }, 300); }

  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensure(); }); });
  function start() {
    ensure(); mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    window.__nxStore.then(function () {
      ensure(); autoSync();
      var seen = null; try { seen = localStorage.getItem('nx-onboard'); } catch (e) { /* */ }
      if (!seen && state.kind !== 'folder' && state.kind !== 'reconnect') setTimeout(openWelcome, 700);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // 다른 보조 스크립트용: 저장 폴더의 하위 폴더에 텍스트 파일 쓰기·읽기 (폴더 모드일 때만)
  function saveExtra(dirName, name, text) { if (state.kind !== 'folder') return Promise.resolve(false); return sub(state.handle, dirName).then(function (d) { return writeText(d, name, text); }).then(function () { return true; }); }
  function readExtra(dirName, name) { if (state.kind !== 'folder') return Promise.resolve(null); return sub(state.handle, dirName).then(function (d) { return readFileText(d, name); }).catch(function () { return null; }); }
  window.netopsStorage = { loadPack: loadPack, saveExtra: saveExtra, readExtra: readExtra, toast: toast, download: download, stamp: stamp, open: openStorage, welcome: openWelcome, pick: pickFolder, state: state, _render: renderItem, _zip: zip };
})();
