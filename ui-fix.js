/* NetOps — 화면 보정 (밝은 화면 기본 · 속성 창 겹침 해결 · 경계선 끌어서 크기 조절)
   앱 본체(React)와 따로 동작하는 보조 스크립트. index.html <head>에서 가장 먼저 읽는다. */
(function () {
  'use strict';
  var root = document.documentElement;
  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경은 무시 */ } }

  /* ── 1. 화면 밝기: 기본 '밝게', 위쪽 버튼으로 밝게 → 어둡게 → 시스템 ── */
  var MODES = ['light', 'dark', 'system'];
  var LABEL = { light: '밝게', dark: '어둡게', system: '시스템' };
  var mode = get('nx-theme', 'light'); if (MODES.indexOf(mode) < 0) mode = 'light';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effective() { return mode === 'system' ? (mq && mq.matches ? 'dark' : 'light') : mode; }
  function applyTheme() {
    root.setAttribute('data-theme', effective());           // 시스템도 실제 값으로 고정 → 부가 창까지 같은 색
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', effective() === 'dark' ? '#111418' : '#ffffff');
    var b = document.getElementById('btn-theme');
    if (b) { b.innerHTML = ICON[mode]; b.title = '화면: ' + LABEL[mode] + ' (눌러서 바꾸기)'; b.setAttribute('aria-label', '화면 밝기: ' + LABEL[mode]); }
  }
  applyTheme();
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (mode === 'system') applyTheme(); });

  var SV = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    light: SV + '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: SV + '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    system: SV + '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };

  /* ── 2. 배치: 화면 폭별로 겹치지 않게 (기존 !important 규칙보다 우선하도록 html 접두) ── */
  var css = '' +
    'html .canvas-grid{position:relative;grid-template-columns:var(--nx-pal,216px) minmax(0,1fr) var(--nx-props,360px)!important}' +
    'html .canvas-grid.no-pal{grid-template-columns:minmax(0,1fr) var(--nx-props,360px)!important}' +
    'html .canvas-grid.no-panel{grid-template-columns:var(--nx-pal,216px) minmax(0,1fr)!important}' +
    'html .canvas-grid.no-pal.no-panel{grid-template-columns:minmax(0,1fr)!important}' +
    'html .canvas-grid>*{min-width:0}' +
    'html .canvas-grid>.props{grid-column:auto!important}' +
    /* 중간 폭(태블릿·좁은 PC): 팔레트+구성도, 속성 창은 아래 한 줄 전체 */
    '@media (max-width:1100px){' +
      'html .canvas-grid,html .canvas-grid.no-panel{grid-template-columns:var(--nx-pal,200px) minmax(0,1fr)!important}' +
      'html .canvas-grid.no-pal,html .canvas-grid.no-pal.no-panel{grid-template-columns:minmax(0,1fr)!important}' +
      'html .canvas-grid>.props{grid-column:1 / -1!important;position:static!important;max-height:none!important}' +
      '.nx-split.r{display:none}}' +
    /* 휴대폰: 위에서 아래로 한 줄씩 (팔레트 → 구성도 → 속성) */
    '@media (max-width:640px){' +
      'html .canvas-grid,html .canvas-grid.no-pal,html .canvas-grid.no-panel,html .canvas-grid.no-pal.no-panel{grid-template-columns:minmax(0,1fr)!important}' +
      'html .canvas-grid>.palette{max-height:var(--nx-palh,170px)!important;overflow-y:auto!important;position:static!important}' +
      'html .canvas-grid>.props{grid-column:auto!important}' +
      '.nx-split.l,.nx-split.r{display:none}}' +
    /* 경계선 손잡이 */
    '.nx-split{position:absolute;top:0;bottom:0;width:12px;margin-left:-6px;cursor:col-resize;z-index:5;touch-action:none;display:flex;justify-content:center}' +
    '.nx-split::before{content:"";width:2px;height:100%;border-radius:2px;background:transparent;transition:background .15s}' +
    '.nx-split::after{content:"";position:absolute;top:50%;left:50%;width:6px;height:36px;margin:-18px 0 0 -3px;border-radius:3px;background:var(--line,#d9dde3);opacity:.9}' +
    '.nx-split:hover::before,.nx-split.on::before{background:var(--accent,#2b59ff)}' +
    '.nx-split:hover::after,.nx-split.on::after{background:var(--accent,#2b59ff)}' +
    '.nx-hsplit{display:none;height:14px;margin:-6px 0;cursor:row-resize;touch-action:none;position:relative;z-index:5}' +
    '.nx-hsplit::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:5px;margin:-2.5px 0 0 -22px;border-radius:3px;background:var(--line,#d9dde3)}' +
    '.nx-hsplit.on::after{background:var(--accent,#2b59ff)}' +
    '@media (max-width:640px){.nx-hsplit{display:block}}' +
    'body.nx-dragging{user-select:none;-webkit-user-select:none;cursor:col-resize}' +
    'body.nx-dragging.v{cursor:row-resize}' +
    '#btn-theme{display:inline-flex;align-items:center;justify-content:center}';
  var st = document.createElement('style'); st.id = 'nx-ui-fix'; st.textContent = css;
  (document.head || root).appendChild(st);

  /* 저장된 폭 적용 */
  var LIM = { pal: [150, 420], props: [280, 640], palh: [90, 520] };
  function clamp(v, k) { return Math.max(LIM[k][0], Math.min(LIM[k][1], Math.round(v))); }
  function setVar(k, v) { root.style.setProperty('--nx-' + k, v + 'px'); }
  ['pal', 'props', 'palh'].forEach(function (k) { var v = parseFloat(get('nx-w-' + k, '')); if (v) setVar(k, clamp(v, k)); });

  /* ── 3. 경계선 끌기 (마우스·터치 공통 Pointer Events, 두 번 누르면 기본값) ── */
  var DEF = { pal: 216, props: 360, palh: 170 };
  function drag(handle, key, calc, vertical) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.preventDefault();
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
      handle.classList.add('on'); document.body.classList.add('nx-dragging'); if (vertical) document.body.classList.add('v');
      var last = null;
      function mv(ev) { last = Math.min(clamp(calc(ev), key), roomFor(key)); setVar(key, last); position(); }
      function up() {
        handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        handle.classList.remove('on'); document.body.classList.remove('nx-dragging', 'v');
        if (last) set('nx-w-' + key, String(last));
        window.dispatchEvent(new Event('resize'));          // 구성도 캔버스가 새 폭에 맞춰 다시 그리도록
      }
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', function () { root.style.removeProperty('--nx-' + key); set('nx-w-' + key, ''); position(); window.dispatchEvent(new Event('resize')); });
    handle.addEventListener('keydown', function (e) {       // 키보드: ←/→ (또는 ↑/↓) 로 16px씩
      var d = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[e.key]; if (!d) return;
      e.preventDefault();
      var cur = parseFloat(getComputedStyle(root).getPropertyValue('--nx-' + key)) || DEF[key];
      if (key === 'props') d = -d;
      var v = clamp(cur + d, key); setVar(key, v); set('nx-w-' + key, String(v)); position(); window.dispatchEvent(new Event('resize'));
    });
  }
  /* 구성도 칸이 360px 아래로 줄지 않도록 최대 폭 제한 */
  function roomFor(key) {
    var g = document.querySelector('.canvas-grid'); if (!g || key === 'palh') return 9999;
    var gap = parseFloat(getComputedStyle(g).columnGap) || 12;
    var other = g.querySelector(':scope>' + (key === 'pal' ? '.props' : '.palette'));
    var ow = 0; if (other) { var r = other.getBoundingClientRect(); var gr = g.getBoundingClientRect(); if (r.top < gr.top + 40) ow = r.width + gap; }
    return Math.max(LIM[key][0], Math.floor(g.clientWidth - ow - gap - 360));
  }
  function mk(cls, label, orient) {
    var h = document.createElement('div');
    h.className = cls; h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', orient); h.tabIndex = 0;
    h.setAttribute('aria-label', label); h.title = label + ' — 끌어서 크기 조절, 두 번 누르면 기본값';
    return h;
  }

  function position() {
    var g = document.querySelector('.canvas-grid'); if (!g) return;
    var gr = g.getBoundingClientRect();
    var pal = g.querySelector(':scope>.palette'), props = g.querySelector(':scope>.props');
    var L = g.querySelector(':scope>.nx-split.l'), R = g.querySelector(':scope>.nx-split.r');
    var gap = parseFloat(getComputedStyle(g).columnGap) || 12;
    if (L) { if (pal) { L.style.display = ''; L.style.left = (pal.getBoundingClientRect().right - gr.left + gap / 2) + 'px'; } else L.style.display = 'none'; }
    if (R) {
      var pr = props && props.getBoundingClientRect();
      if (pr && pr.top < gr.top + 40) { R.style.display = ''; R.style.left = (pr.left - gr.left - gap / 2) + 'px'; } else R.style.display = 'none';
    }
  }

  function ensure() {
    var b = document.getElementById('btn-theme'), help = document.getElementById('btn-help');
    if (help) {
      if (!b) {
        b = document.createElement('button'); b.id = 'btn-theme'; b.type = 'button';
        b.addEventListener('click', function () { mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; set('nx-theme', mode); applyTheme(); toast('화면: ' + LABEL[mode]); });
      }
      if (b.className !== help.className) b.className = help.className;
      if (b.nextElementSibling !== help) help.insertAdjacentElement('beforebegin', b);
      if (!b.innerHTML) applyTheme();
    }
    var g = document.querySelector('.canvas-grid'); if (!g) return;
    if (!g.querySelector(':scope>.nx-split.l')) {
      var L = mk('nx-split l', '장비 팔레트 경계선', 'vertical');
      drag(L, 'pal', function (ev) { var p = g.querySelector(':scope>.palette'); return p ? ev.clientX - p.getBoundingClientRect().left : DEF.pal; });
      g.appendChild(L);
    }
    if (!g.querySelector(':scope>.nx-split.r')) {
      var R = mk('nx-split r', '속성 창 경계선', 'vertical');
      drag(R, 'props', function (ev) { var p = g.querySelector(':scope>.props'); return p ? p.getBoundingClientRect().right - ev.clientX : DEF.props; });
      g.appendChild(R);
    }
    var pal = g.querySelector(':scope>.palette'), H = document.getElementById('nx-hsplit');
    if (pal) {
      if (!H) {
        H = mk('nx-hsplit', '장비 팔레트 높이', 'horizontal'); H.id = 'nx-hsplit';
        drag(H, 'palh', function (ev) { var p = document.querySelector('.canvas-grid>.palette'); return p ? ev.clientY - p.getBoundingClientRect().top : DEF.palh; }, true);
      }
      if (H.previousElementSibling !== pal) pal.insertAdjacentElement('afterend', H);
    } else if (H) H.remove();
    position();
  }

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'nx-toast'; t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:max(20px,env(safe-area-inset-bottom));z-index:1001;background:#111418;color:#fff;padding:9px 14px;border-radius:8px;font:13px "Noto Sans KR",system-ui,sans-serif';
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 1600);
  }

  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensure(); }); });
  function start() { ensure(); mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('resize', function () { requestAnimationFrame(position); });
  window.netopsTheme = function (m) { if (MODES.indexOf(m) >= 0) { mode = m; set('nx-theme', m); applyTheme(); } return mode; };
})();
