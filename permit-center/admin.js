/* ===== 가상인허가센터 관리자 모드 =====
   공용 설정은 저장소의 permit-center/config/settings-vN.json (N이 가장 큰 파일)에 보관한다.
   관리자가 "전체 적용"을 누르면 다음 번호 파일을 만드는 GitHub 페이지가 내용이 채워진 채 열리고, 커밋하면 1~2분 뒤 모든 직원에게 반영된다. */
(function () {
'use strict';
var REPO = 'juaworld/juadesign', DIR = 'permit-center/config/';
var DEFAULT_HASH = 'c4bd736248b9eeba158d908b5fee0250fe0d290703fec83bfc5aa7393dba88cf'; // 초기 비밀번호 hanbaek2026
var CACHE = 'vpc2_settings', UNLOCK = 'vpc2_admin';
var ZONE_LIST = ['제1종전용주거지역','제2종전용주거지역','제1종일반주거지역','제2종일반주거지역','제3종일반주거지역','준주거지역','중심상업지역','일반상업지역','근린상업지역','유통상업지역','전용공업지역','일반공업지역','준공업지역','보전녹지지역','생산녹지지역','자연녹지지역','보전관리지역','생산관리지역','계획관리지역','농림지역','자연환경보전지역'];
var PARK_LIST = ['공장','창고시설','제1종근린생활시설','제2종근린생활시설','업무시설','판매시설','숙박시설','기타'];
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };

window.VPC_SETTINGS = { v: 0, vworldKey: '', adminHash: DEFAULT_HASH, notice: '', overrides: {} };
try { var c = JSON.parse(get(CACHE)); if (c && c.v) window.VPC_SETTINGS = Object.assign(window.VPC_SETTINGS, c); } catch (e) {}

function sha(t) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }); }
function probe(n, last) {
  return fetch('config/settings-v' + n + '.json', { cache: 'no-store' }).then(function (r) { if (!r.ok) return last; return r.json().then(function (j) { j.v = n; return probe(n + 1, j); }); }).catch(function () { return last; });
}
function loadSettings() {
  var start = Math.max(1, (window.VPC_SETTINGS.v || 0));
  return probe(start, null).then(function (j) {
    if (j) { window.VPC_SETTINGS = Object.assign({ v: 0, vworldKey: '', adminHash: DEFAULT_HASH, notice: '', overrides: {} }, j); set(CACHE, JSON.stringify(window.VPC_SETTINGS)); }
    applyNotice(); if (window.VPC) window.VPC.renderAll();
  });
}
function applyNotice() {
  var n = document.getElementById('vpcNotice');
  if (!n) { n = document.createElement('div'); n.id = 'vpcNotice'; n.className = 'wrap'; var m = document.querySelector('main'); m.parentNode.insertBefore(n, m); }
  var t = window.VPC_SETTINGS.notice;
  n.innerHTML = t ? '<p class="notice">' + esc(t) + '</p>' : '';
}

/* ---------- UI ---------- */
function dlg() {
  var d = document.getElementById('admDlg'); if (d) return d;
  d = document.createElement('dialog'); d.id = 'admDlg'; document.body.appendChild(d);
  d.addEventListener('click', onClick); d.addEventListener('change', onChange);
  return d;
}
function unlocked() { try { return sessionStorage.getItem(UNLOCK) === '1'; } catch (e) { return false; } }
function open() { var d = dlg(); render(); if (!d.open) d.showModal(); }
var draft = null;
function render() {
  var d = dlg(), S = window.VPC_SETTINGS;
  if (!unlocked()) {
    d.innerHTML = '<h3>관리자 모드</h3><p class="hint">설정은 관리자만 수정할 수 있습니다. 직원은 여기서 아무것도 입력할 필요가 없습니다.</p>' +
      '<input type="password" id="admPw" placeholder="관리자 비밀번호" style="width:100%"><p id="admMsg" class="hint"></p>' +
      '<p class="adm-btns"><button data-a="close">닫기</button> <button class="primary" data-a="login">들어가기</button></p>';
    setTimeout(function () { var i = document.getElementById('admPw'); if (i) { i.focus(); i.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); }); } }, 30);
    return;
  }
  if (!draft) draft = JSON.parse(JSON.stringify(S));
  var p = window.VPC.cur().p, reg = p.region, raw = reg ? window.VPC.regionRaw(reg) : null, ov = (draft.overrides[reg] = draft.overrides[reg] || {});
  var zoneRows = ZONE_LIST.map(function (z) {
    var b = ov.bcr && ov.bcr[z] != null ? ov.bcr[z] : '', f = ov.far && ov.far[z] != null ? ov.far[z] : '';
    return '<tr' + (z === p.zone ? ' class="hl"' : '') + '><td>' + z + '</td><td class="sub">' + (raw && raw.bcr[z] != null ? raw.bcr[z] + '%' : '-') + ' / ' + (raw && raw.far[z] != null ? raw.far[z] + '%' : '-') + '</td>' +
      '<td><input data-ov="bcr" data-k="' + z + '" value="' + esc(b) + '" inputmode="decimal" placeholder="자동"></td><td><input data-ov="far" data-k="' + z + '" value="' + esc(f) + '" inputmode="decimal" placeholder="자동"></td></tr>';
  }).join('');
  var parkRows = PARK_LIST.map(function (u) {
    var v = ov.park && ov.park[u] != null ? ov.park[u] : '', a = raw && raw.park ? raw.park[u] : null;
    return '<tr' + (u === p.use ? ' class="hl"' : '') + '><td>' + u + '</td><td class="sub">' + (a === 'national' ? '시행령' : a ? a + '㎡' : '-') + '</td><td><input data-ov="park" data-k="' + u + '" value="' + esc(v) + '" inputmode="decimal" placeholder="자동"></td></tr>';
  }).join('');
  var nOv = Object.keys(draft.overrides).filter(function (k) { var o = draft.overrides[k]; return o && (Object.keys(o.bcr || {}).length || Object.keys(o.far || {}).length || Object.keys(o.park || {}).length || o.disabledPct != null || (o.scapeTiers || []).length); }).length;
  d.innerHTML = '<h3>관리자 설정 <small class="hint">공용 설정 v' + (S.v || 0) + ' · 보정된 지자체 ' + nOv + '곳</small></h3>' +
    '<section class="adm-sec"><h4>VWorld API 키 (전 직원 공용)</h4><input id="admKey" type="password" autocomplete="off" style="width:100%" value="' + esc(draft.vworldKey) + '" placeholder="vworld.kr 인증키 — 서비스 URL에 juaworld.github.io 등록 필요">' +
    '<label class="ck"><input type="checkbox" id="admShow"> 키 보이기</label><p class="hint">브라우저에서 호출하는 키라서 공개 저장소에 저장되어도 VWorld에 등록한 도메인에서만 동작합니다.</p></section>' +
    '<section class="adm-sec"><h4>공지 문구 (상단 표시)</h4><input id="admNotice" style="width:100%" value="' + esc(draft.notice) + '" placeholder="예: 경관심의 일정은 매월 둘째 주 화요일"></section>' +
    '<section class="adm-sec"><h4>지자체 조례값 보정 — ' + esc(reg || '지자체 미선택') + '</h4>' +
    (reg ? '<p class="hint">자동 추출값이 틀리거나 비어 있을 때만 입력하세요. 비우면 자동값을 씁니다. 다른 지자체는 ① 프로젝트에서 지자체를 바꾼 뒤 다시 여세요.</p>' +
      '<details open><summary>건폐율·용적률 (%)</summary><table class="ntab"><thead><tr><th>용도지역</th><th>자동값 건폐/용적</th><th>건폐율</th><th>용적률</th></tr></thead><tbody>' + zoneRows + '</tbody></table></details>' +
      '<details><summary>부설주차 기준 (시설면적 ㎡당 1대)</summary><table class="ntab"><thead><tr><th>용도</th><th>자동값</th><th>보정</th></tr></thead><tbody>' + parkRows + '</tbody></table></details>' +
      '<div class="grid" style="margin-top:10px"><label>장애인전용주차 비율 (%)<input data-ovs="disabledPct" value="' + esc(ov.disabledPct != null ? ov.disabledPct : '') + '" placeholder="' + esc(raw && raw.disabledPct != null ? raw.disabledPct : '조례 미확인') + '"></label>' +
      '<label>조경 비율 일괄 (%)<input data-ovs="scapeRate" value="' + esc(ov.scapeTiers && ov.scapeTiers[0] ? ov.scapeTiers[0].rate : '') + '" placeholder="자동(연면적 구간별)"></label></div>' : '<p class="hint">① 프로젝트에서 지자체를 먼저 선택하세요.</p>') + '</section>' +
    '<section class="adm-sec"><h4>관리자 비밀번호 변경</h4><input id="admNewPw" type="password" style="width:100%" placeholder="새 비밀번호 (비우면 유지)"></section>' +
    '<p id="admMsg" class="hint"></p>' +
    '<p class="adm-btns"><button data-a="logout" class="ghost">잠그기</button> <button data-a="close">닫기</button> <button data-a="local">이 브라우저에만 적용</button> <button class="primary" data-a="publish">전체 직원에게 적용</button></p>' +
    '<p class="hint">"전체 직원에게 적용"을 누르면 GitHub 새 파일 화면이 내용이 채워진 채 열립니다. 거기서 초록색 "Commit changes"만 누르면 1~2분 뒤 모든 직원 화면에 반영됩니다.</p>';
}
function login() {
  var pw = (document.getElementById('admPw') || {}).value || '';
  sha(pw).then(function (h) {
    if (h === (window.VPC_SETTINGS.adminHash || DEFAULT_HASH)) { try { sessionStorage.setItem(UNLOCK, '1'); } catch (e) {} draft = null; render(); }
    else document.getElementById('admMsg').textContent = '비밀번호가 맞지 않습니다.';
  });
}
function collect() {
  var key = document.getElementById('admKey'); if (key) draft.vworldKey = key.value.trim();
  var nt = document.getElementById('admNotice'); if (nt) draft.notice = nt.value.trim();
  Object.keys(draft.overrides).forEach(function (k) {
    var o = draft.overrides[k];
    ['bcr', 'far', 'park'].forEach(function (t) { if (o[t]) Object.keys(o[t]).forEach(function (z) { if (o[t][z] === '' || o[t][z] == null) delete o[t][z]; }); if (o[t] && !Object.keys(o[t]).length) delete o[t]; });
    if (!Object.keys(o).length) delete draft.overrides[k];
  });
  var np = document.getElementById('admNewPw');
  return np && np.value ? sha(np.value).then(function (h) { draft.adminHash = h; }) : Promise.resolve();
}
function onChange(e) {
  var el = e.target, reg = window.VPC.cur().p.region; if (!reg || !draft) return;
  var o = draft.overrides[reg] = draft.overrides[reg] || {};
  if (el.dataset.ov) { o[el.dataset.ov] = o[el.dataset.ov] || {}; var v = el.value.trim(); if (v === '') delete o[el.dataset.ov][el.dataset.k]; else o[el.dataset.ov][el.dataset.k] = parseFloat(v); }
  if (el.dataset.ovs === 'disabledPct') { if (el.value.trim() === '') delete o.disabledPct; else o.disabledPct = parseFloat(el.value); }
  if (el.dataset.ovs === 'scapeRate') { if (el.value.trim() === '') delete o.scapeTiers; else o.scapeTiers = [{ min: 0, max: null, rate: parseFloat(el.value), factory: false }]; }
  if (el.id === 'admShow') document.getElementById('admKey').type = el.checked ? 'text' : 'password';
}
function onClick(e) {
  var a = e.target.dataset && e.target.dataset.a; if (!a) return;
  var d = dlg();
  if (a === 'close') { d.close(); return; }
  if (a === 'login') { login(); return; }
  if (a === 'logout') { try { sessionStorage.removeItem(UNLOCK); } catch (x) {} draft = null; render(); return; }
  if (a === 'local' || a === 'publish') {
    collect().then(function () {
      var out = { vworldKey: draft.vworldKey, adminHash: draft.adminHash, notice: draft.notice, overrides: draft.overrides, updated: new Date().toISOString().slice(0, 10) };
      var next = (window.VPC_SETTINGS.v || 0) + 1;
      window.VPC_SETTINGS = Object.assign({ v: window.VPC_SETTINGS.v || 0 }, out);
      set(CACHE, JSON.stringify(window.VPC_SETTINGS)); applyNotice(); window.VPC.renderAll();
      if (a === 'local') { document.getElementById('admMsg').textContent = '이 브라우저에 적용했습니다. 다른 직원에게는 아직 반영되지 않았습니다.'; return; }
      var json = JSON.stringify(out, null, 1);
      var url = 'https://github.com/' + REPO + '/new/main?filename=' + encodeURIComponent(DIR + 'settings-v' + next + '.json') + '&value=' + encodeURIComponent(json) + '&message=' + encodeURIComponent('가상인허가센터 공용 설정 v' + next);
      window.open(url, '_blank', 'noopener');
      document.getElementById('admMsg').textContent = 'GitHub 창에서 "Commit changes"를 누르면 설정 v' + next + '가 전체에 반영됩니다.';
    });
  }
}

var css = document.createElement('style');
css.textContent = '#admDlg{width:min(760px,calc(100% - 32px));max-height:calc(100vh - 40px);overflow:auto}#admDlg input{width:100%}#admDlg td input{padding:4px 6px}#admDlg .ck input{width:auto}.adm-sec{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.adm-btns{text-align:right;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}.notice{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:8px 12px;margin:12px 0 0;font-weight:600}';
document.head.appendChild(css);
document.addEventListener('DOMContentLoaded', function () {
  var b = document.getElementById('keyBtn'); if (b) { b.textContent = '관리자'; b.addEventListener('click', open); }
  var kd = document.getElementById('keyDlg'); if (kd) kd.remove();
  applyNotice(); loadSettings();
});
})();
