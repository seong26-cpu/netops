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
  function loadPack() { return packP || (packP = fetch('./packs/standard-pack.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function (e) { packP = null; throw e; })); }
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
  function portsText(pack) { return pack.ports.map(function (p) { return p.line; }).join('\n'); }
  function writePack(root, raw) {
    return loadPack().then(function (pack) {
      return sub(root, 'standard-pack').then(function (d) {
        var jobs = pack.items.map(function (it) { return writeText(d, it.id + '.txt', renderItem(it, pack, {}, raw)); });
        jobs.push(writeText(d, 'model-ports.txt', '# 설정 › 모델 목록에 붙여넣는 형식 (벤더, 모델, OS, 포트구성)\n' + pack.ports.map(function (p) { return p.line + '    # ' + p.src; }).join('\n') + '\n'));
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
    loadPack().then(function (pack) {
      var files = pack.items.map(function (it) { return { name: 'standard-pack/' + it.id + '.txt', text: renderItem(it, pack, {}, true) }; });
      files.push({ name: 'standard-pack/model-ports.txt', text: portsText(pack) + '\n' }, { name: 'standard-pack/index.json', text: JSON.stringify(pack, null, 1) }, { name: 'README-NetOps.txt', text: README });
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
      '<div class="sx-tree">📁 ' + esc(state.name || '내 폴더') + '<br>├ data/ — 구성도·설정·작업 (자동 저장)<br>├ standard-pack/ — 벤더·OS별 표준 CONFIG, 모델 포트 구성<br>├ exports/ — 여기서 만든 CONFIG<br>└ backup/ — 폴더 연결 전 브라우저 내용 보관</div>' +
      '<p class="sx-mu">💡 고른 폴더가 <b>구글 드라이브·OneDrive 동기화 폴더</b>나 <b>USB</b>면, 다른 PC에서도 같은 폴더를 지정해 이어서 쓸 수 있어요.</p>' +
      '<h4>표준 CONFIG 팩 <span class="sx-mu" id="sx-pv"></span></h4>' +
      '<p class="sx-mu">벤더·OS별 기본 보안·관리 틀(hostname·SSH·계정·NTP·Syslog·SNMPv3·배너). 공식 자료로 문법을 확인한 줄만 그대로 나오고, 확인 못 한 줄은 <b>[확인 필요]</b>로 주석 처리돼요. 앱을 열어 둔 상태면 인터넷 없이도 써요.</p>' +
      '<div class="sx-row"><select id="sx-item" aria-label="벤더·OS"></select><button class="sx-b" data-a="zip">팩 전체 ZIP 받기</button></div>' +
      '<div class="sx-grid" id="sx-vars"></div>' +
      '<pre class="sx-pre" id="sx-out">불러오는 중…</pre>' +
      '<div class="sx-row"><button class="sx-b p" data-a="copy">복사</button><button class="sx-b" data-a="savecfg">' + (state.kind === 'folder' ? '폴더(exports)에 저장' : '파일로 받기') + '</button><span class="sx-mu">비밀번호 칸은 화면에서만 쓰고 저장하지 않아요.</span></div>' +
      '<h4>모델별 포트 구성</h4><p class="sx-mu">데이터시트로 확인한 모델의 포트 구성이에요. 누르면 <b>설정 › 모델 목록</b>에 바로 추가돼요.</p><pre class="sx-pre" id="sx-ports"></pre>' +
      '<div class="sx-row"><button class="sx-b p" data-a="ports">모델 목록에 추가</button></div>';
    shell(h);
    loadPack().then(function (pack) {
      document.getElementById('sx-pv').textContent = 'v' + pack.version + ' · ' + pack.items.length + '종';
      var sel = document.getElementById('sx-item');
      sel.innerHTML = pack.items.map(function (it) { var u = it.lines.filter(function (l) { return !l.v; }).length; return '<option value="' + it.id + '">' + esc(it.vendor + ' · ' + it.os) + (u ? ' (확인 필요 ' + u + '줄)' : '') + '</option>'; }).join('');
      var last = null; try { last = localStorage.getItem('nx-pack-item'); } catch (e) { /* */ }
      if (last && pack.items.some(function (i) { return i.id === last; })) sel.value = last;
      document.getElementById('sx-vars').innerHTML = pack.vars.map(function (v) {
        return '<label>' + esc(v.label) + '<input data-k="' + v.k + '" ' + (v.secret ? 'type="password" autocomplete="new-password" ' : '') + 'placeholder="' + esc(v.def) + '" value="' + esc(VALS[v.k] || '') + '"></label>';
      }).join('');
      document.getElementById('sx-ports').textContent = pack.ports.map(function (p) { return p.line + '    # ' + p.src; }).join('\n');
      var draw = function () { var it = pack.items.find(function (i) { return i.id === sel.value; }); document.getElementById('sx-out').textContent = renderItem(it, pack, vals(pack)); try { localStorage.setItem('nx-pack-item', sel.value); } catch (e) { /* */ } };
      sel.addEventListener('change', draw);
      document.getElementById('sx-vars').addEventListener('input', function (e) { var k = e.target.getAttribute('data-k'); if (k) { VALS[k] = e.target.value; draw(); } });
      draw();
    }).catch(function () { var o = document.getElementById('sx-out'); if (o) o.textContent = '표준 팩을 불러오지 못했어요. 인터넷에 연결된 상태로 한 번 열면 그 뒤로는 오프라인에서도 열려요.'; });
  }

  function openWelcome() {
    var rec = state.kind === 'unsupported' ? '' : ' rec';
    shell('<h3>👋 NetOps에 오신 걸 환영해요</h3><p class="sx-mu">계정·로그인 없이 쓰는 멀티벤더 네트워크 운용 콘솔이에요. 먼저 <b>어디에 저장할지</b> 골라 주세요. 나중에 왼쪽 메뉴 <b>관리 › 저장소·표준 팩</b>에서 바꿀 수 있어요.</p>' +
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
    else if (a === 'ports') loadPack().then(function (p) { addPorts(portsText(p)); });
  }
  function selectPre() { var el = document.getElementById('sx-out'); var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('선택된 내용을 Ctrl+C로 복사하세요'); }

  var README = 'NetOps 저장 폴더\n================\n' +
    'data/           구성도·설정·작업 기록 (NetOps가 자동 저장. 직접 고치지 마세요)\n' +
    'standard-pack/  벤더·OS별 표준 CONFIG 틀 + 모델 포트 구성 ({{변수}}는 NetOps 화면에서 채워 쓰기)\n' +
    'exports/        NetOps에서 만든 CONFIG\n' +
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
  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensure(); }); });
  function start() {
    ensure(); mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    window.__nxStore.then(function () {
      ensure();
      var seen = null; try { seen = localStorage.getItem('nx-onboard'); } catch (e) { /* */ }
      if (!seen && state.kind !== 'folder' && state.kind !== 'reconnect') setTimeout(openWelcome, 700);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.netopsStorage = { open: openStorage, welcome: openWelcome, pick: pickFolder, state: state, _render: renderItem, _zip: zip };
})();
