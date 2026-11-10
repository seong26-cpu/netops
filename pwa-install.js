/* NetOps — 휴대폰 앱 설치 (왼쪽 메뉴 '지원' 아래 '앱 설치')
   앱 본체(React)와 따로 동작하는 보조 스크립트. 설치 창은 이 파일이 직접 그린다. */
(function () {
  'use strict';
  var bip = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); bip = e; refresh(); });
  window.addEventListener('appinstalled', function () { bip = null; refresh(); toast('앱으로 설치했어요. 홈 화면의 NetOps 아이콘으로 여세요.'); });

  var isStandalone = function () { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; };
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(ua);

  var css = '' +
    '.nx-ov{position:fixed;inset:0;z-index:1000;background:rgba(10,14,20,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom))}' +
    '@media(min-width:640px){.nx-ov{align-items:center}}' +
    '.nx-card{--bg:#fff;--fg:#14191f;--mu:#5b6573;--ln:#e3e7ec;--ac:#111418;--acfg:#fff;--soft:#f3f5f7;background:var(--bg);color:var(--fg);width:min(460px,100%);border-radius:16px;padding:20px 20px 16px;box-shadow:0 18px 50px rgba(0,0,0,.3);font:14px/1.55 "Noto Sans KR",Inter,system-ui,sans-serif;max-height:calc(100vh - 32px);overflow:auto}' +
    ':root[data-theme=dark] .nx-card{--bg:#1a1f26;--fg:#e9edf2;--mu:#9aa5b3;--ln:#2c343e;--ac:#e9edf2;--acfg:#111418;--soft:#222831}' +
    '.nx-card h3{margin:0 0 6px;font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}' +
    '.nx-card p{margin:6px 0;color:var(--mu)}.nx-card b{color:var(--fg)}' +
    '.nx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-weight:600;border-radius:10px;padding:11px 18px;border:0;cursor:pointer;background:var(--ac);color:var(--acfg)}' +
    '.nx-btn.q{background:var(--soft);color:var(--fg)}.nx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}' +
    '.nx-steps{margin:8px 0;padding-left:20px;color:var(--fg)}.nx-steps li{margin:4px 0}' +
    '.nx-url{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12.5px;background:var(--soft);border:1px solid var(--ln);border-radius:8px;padding:8px 10px;overflow-wrap:anywhere;user-select:all;color:var(--fg)}' +
    '.nx-ok{background:#e7f5ec;color:#1f7a4e;border-radius:8px;padding:8px 10px;margin:8px 0}:root[data-theme=dark] .nx-ok{background:#16301f;color:#7fd3a0}' +
    '.nx-x{float:right;background:none;border:0;font-size:20px;line-height:1;color:var(--mu);cursor:pointer;padding:2px 6px}' +
    '.nx-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:max(20px,env(safe-area-inset-bottom));z-index:1001;background:#111418;color:#fff;padding:9px 14px;border-radius:8px;font:13px "Noto Sans KR",system-ui,sans-serif}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function toast(msg) { var t = document.createElement('div'); t.className = 'nx-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800); }
  var url = location.origin + location.pathname.replace(/index\.html$/, '');

  function body() {
    if (isStandalone()) return '<div class="nx-ok">지금 <b>설치한 앱</b>으로 실행 중이에요.</div><p>저장은 <b>관리 › 저장소·표준 팩</b>에서 지정한 폴더(또는 이 브라우저)에 돼요.</p>';
    var h = '<p>홈 화면에 아이콘이 생기고, 주소창 없이 앱처럼 열려요.</p>';
    if (bip) h += '<div class="nx-row"><button class="nx-btn" data-nx="install">앱 설치하기</button></div>';
    else if (inApp) h += '<p><b>카카오톡·네이버 등 앱 안 브라우저</b>에서는 설치가 안 돼요. 오른쪽 위 메뉴에서 <b>다른 브라우저로 열기</b>(아이폰은 Safari, 안드로이드는 Chrome)를 누른 뒤 다시 오세요.</p>';
    else if (isIOS) h += '<ol class="nx-steps"><li><b>Safari</b>로 이 페이지를 엽니다</li><li>주소창 옆 <b>⋯</b> → <b>공유</b> (iOS 18 이하는 아래쪽 <b>□↑</b> 공유 버튼)</li><li><b>홈 화면에 추가</b> → 오른쪽 위 <b>추가</b></li></ol>';
    else if (isAndroid) h += '<ol class="nx-steps"><li><b>Chrome</b>으로 이 페이지를 엽니다</li><li>오른쪽 위 <b>⋮</b> → <b>앱 설치</b> (또는 <b>홈 화면에 추가</b>)</li><li><b>설치</b>를 누릅니다</li></ol>';
    else h += '<p>PC Chrome·Edge: 주소창 오른쪽 <b>설치 아이콘(⊕)</b> 또는 메뉴 <b>⋮ → 앱 설치</b>. 휴대폰에서 설치하려면 아래 주소를 휴대폰으로 여세요.</p>';
    h += '<p style="margin-top:12px">휴대폰에서 열 주소</p><div class="nx-url" id="nx-url">' + url + '</div><div class="nx-row"><button class="nx-btn q" data-nx="copy">주소 복사</button></div>';
    h += '<p>설치한 앱과 웹은 같은 주소·같은 저장소를 써요. 다른 PC에서는 같은 저장 폴더(동기화 폴더·USB)를 지정하면 이어서 쓸 수 있어요.</p>';
    return h;
  }
  var ov = null;
  function open() {
    close();
    ov = document.createElement('div'); ov.className = 'nx-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '휴대폰 앱으로 설치');
    ov.innerHTML = '<div class="nx-card"><button class="nx-x" data-nx="close" aria-label="닫기">×</button><h3>📲 휴대폰 앱으로 설치</h3><div id="nx-body">' + body() + '</div></div>';
    ov.addEventListener('click', function (e) {
      var a = e.target.closest('[data-nx]'); if (e.target === ov) return close();
      if (!a) return;
      var k = a.getAttribute('data-nx');
      if (k === 'close') close();
      else if (k === 'install' && bip) { bip.prompt(); bip.userChoice.then(function (c) { if (c.outcome === 'accepted') toast('설치를 시작했어요'); bip = null; refresh(); }).catch(function () {}); }
      else if (k === 'copy') {
        var done = function () { toast('주소를 복사했어요'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { selectUrl(); });
        else selectUrl();
      }
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
    var b = ov.querySelector('.nx-btn'); if (b) b.focus();
  }
  function selectUrl() { var el = document.getElementById('nx-url'); if (!el) return; var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('주소를 길게 눌러 복사하세요'); }
  function esc(e) { if (e.key === 'Escape') close(); }
  function close() { if (ov) { ov.remove(); ov = null; document.removeEventListener('keydown', esc); } }
  function refresh() { var b = document.getElementById('nx-body'); if (b) b.innerHTML = body(); }
  window.netopsInstall = open;

  // 왼쪽 메뉴 '지원' 묶음의 '도움말·매뉴얼' 아래에 '앱 설치' 항목 추가
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2"></rect><path d="M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5M11 18.5h2"></path></svg>';
  function ensure() {
    var help = document.getElementById('nav-help');
    var mine = document.getElementById('nav-install');
    if (!help) { if (mine) mine.style.display = 'none'; return; }
    if (!mine) {
      mine = document.createElement('button');
      mine.id = 'nav-install'; mine.type = 'button';
      mine.addEventListener('click', function (e) { e.preventDefault(); open(); var sc = document.querySelector('.nav-scrim'); if (sc && window.innerWidth < 900) sc.click(); });
    }
    if (mine.previousElementSibling !== help) help.insertAdjacentElement('afterend', mine);
    var cls = help.className.replace(/\b(active|is-active|current|on)\b/g, '').replace(/\s+/g, ' ').trim();
    if (mine.className !== cls) mine.className = cls;
    var html = ICON + '<span>앱 설치' + (isStandalone() ? ' (설치됨)' : '') + '</span>';
    if (mine.getAttribute('data-h') !== html) { mine.innerHTML = html; mine.setAttribute('data-h', html); }
    if (mine.style.display) mine.style.display = '';
    // '지원' 묶음 개수 표시(+1)
    var cnt = help.parentElement && help.parentElement.querySelector('.sec-count');
    if (cnt) { var n = help.parentElement.querySelectorAll('.nav-item').length; if (cnt.textContent !== String(n)) cnt.textContent = String(n); }
  }
  var pending = false;
  var mo = new MutationObserver(function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; ensure(); }); });
  function start() { ensure(); mo.observe(document.getElementById('root') || document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  if (/[#&]install\b/.test(location.hash)) setTimeout(open, 600);
})();
