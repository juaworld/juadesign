/* ===== 가상인허가센터 앱 ===== (템플릿 리터럴 미사용: 업로드 호환) */
(function () {
'use strict';
var $ = function (s, el) { return (el || document).querySelector(s); };
var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
var fmt = function (n, d) { d = d == null ? 1 : d; return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString('ko-KR'); };
var uid = function () { return Math.random().toString(36).slice(2, 10); };
var nospace = function (s) { return String(s || '').replace(/\s+/g, ''); };
var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
var lsSet = function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

/* ---------- 데이터 ---------- */
var D = { regions: null, national: null, meta: null, detail: {} };
function loadJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
function regionOf(p) {
  var r = D.regions && p.region ? D.regions.regions[p.region] : null;
  var o = window.VPC_SETTINGS && VPC_SETTINGS.overrides ? VPC_SETTINGS.overrides[p.region] : null;
  if (!r || !o) return r;
  var park = Object.assign({}, r.park, o.park || {});
  return Object.assign({}, r, { bcr: Object.assign({}, r.bcr, o.bcr || {}), far: Object.assign({}, r.far, o.far || {}), park: park, disabledPct: o.disabledPct != null ? o.disabledPct : r.disabledPct,
    scapeTiers: o.scapeTiers && o.scapeTiers.length ? o.scapeTiers : r.scapeTiers, has: Object.assign({}, r.has, Object.keys(o.park || {}).length ? { park: true } : {}), overridden: true });
}
function regionDetail(p) { var r = regionOf(p); return r ? D.detail[r.id] : null; }
function ensureDetail(p) {
  var r = regionOf(p); if (!r || D.detail[r.id]) return Promise.resolve();
  return loadJSON('data/r/' + r.id + '.json').then(function (j) { D.detail[r.id] = j; renderAll(); }).catch(function () {});
}
function ev(id) { return D.national && D.national.evidence ? D.national.evidence[id] : null; }

/* ---------- 상태 ---------- */
var STORE = 'vpc2_state', KEYSTORE = 'vpc2_vwkey';
var DEFAULT_P = {
  name: '새 프로젝트', address: '', pnu: '', landUses: [], region: '', zone: '계획관리지역', use: '공장', nbSub: '', owner: '민간', work: '신축',
  siteArea: '', bldgArea: '', gfa: '', gfaFar: '', addArea: '', floorsAbove: '', floorsBelow: '0', height: '', eaves: '', span: '', cantilever: false, flatSlab: false,
  excavation: '0', hvac: '있음', emp50: '', landCat: '', cutFill: '', growthPlan: false, devCmteEx: '', stWall: '', stChimney: '', stTower: '', stTank: '', stPv: '', stMast: '', stShelter: '', stPark: false, stSilo: false, siteAreaAuto: false, locks: {}, lockOrig: {}, aslLimit: '', aslSrc: '', groundEl: '', parcels: [], zoneMix: [], hLimitNote: '', eumPrice: '', eumMark3: '', heightDistrict: false, heritageZone: false, flightZone: false, hLimit: '', hLimitSrc: '', northDist: '', rooms: '', households: '', industrialComplex: false, landscapeDistrict: false, keyLandscapeArea: false,
  districtPlan: false, greenbelt: false, separateAdd: false, mountain: '없음', parkingFloor: false, combustible750: false, trafficZone: '',
  parkingPlan: '', disabledParkingPlan: '', landscapePlan: '', bcrLimit: '', farLimit: '', epi: '', bf: {}, scapeAns: {}
};
var state = loadState();
function newProject(name) { var p = JSON.parse(JSON.stringify(DEFAULT_P)); p.name = name || '새 프로젝트'; return { id: uid(), p: p, files: [], manual: {}, created: new Date().toISOString() }; }
function loadState() {
  try { var s = JSON.parse(lsGet(STORE)); if (s && s.projects && s.projects.length) { s.projects.forEach(function (x) { x.p = Object.assign(JSON.parse(JSON.stringify(DEFAULT_P)), x.p); ['height', 'eaves', 'span', 'northDist', 'cutFill', 'hLimit'].forEach(function (k) { if (num(x.p[k]) > 300) x.p[k] = String(Math.round(num(x.p[k])) / 1000); }); }); return s; } } catch (e) {}
  var pr = newProject('예시: 화성시 공장 신축');
  Object.assign(pr.p, { region: '경기도 화성시', siteArea: '6500', bldgArea: '2400', gfa: '3200', gfaFar: '3200', floorsAbove: '2', height: '14.5', eaves: '11', span: '24', parkingPlan: '12', disabledParkingPlan: '1', landscapePlan: '700' });
  return { cur: pr.id, projects: [pr] };
}
function save() { if (!lsSet(STORE, JSON.stringify(state))) toast('브라우저 저장 실패 — 백업 버튼으로 내려받아 두세요'); }
function cur() { return state.projects.filter(function (x) { return x.id === state.cur; })[0] || state.projects[0]; }
var fileText = {};

/* ---------- 지자체 반영 값 ---------- */
function limits(p) {
  var r = regionOf(p), z = ZONES[p.zone] || [0, 0];
  var bcr = num(p.bcrLimit) || (r && r.bcr[p.zone]) || z[0];
  var far = num(p.farLimit) || (r && r.far[p.zone]) || z[1];
  var ovr = window.VPC_SETTINGS && VPC_SETTINGS.overrides ? VPC_SETTINGS.overrides[p.region] || {} : {};
  var bcrSrc = num(p.bcrLimit) ? '직접 입력' : (ovr.bcr && ovr.bcr[p.zone] != null ? '관리자 보정' : r && r.bcr[p.zone] ? '조례' : '국토계획법 시행령 상한');
  var farSrc = num(p.farLimit) ? '직접 입력' : (ovr.far && ovr.far[p.zone] != null ? '관리자 보정' : r && r.far[p.zone] ? '조례' : '국토계획법 시행령 상한');
  var nat = (D.national && D.national.parkNat) || {};
  var natUnit = function (u) { return (typeof nat[u] === 'number' ? nat[u] : null) || PARK_NAT[u] || PARK_NAT['기타']; };
  var pu = r && r.park ? r.park[p.use] : null, parkUnit, parkSrc;
  if (typeof pu === 'number') { parkUnit = pu; parkSrc = ovr.park && ovr.park[p.use] != null ? '관리자 보정' : '조례 별표'; }
  else if (pu === 'national') { parkUnit = natUnit(p.use); parkSrc = '조례 → 주차장법 시행령 별표1'; }
  else if (r && r.park && typeof r.park['기타'] === 'number' && !PARK_NAT[p.use]) { parkUnit = r.park['기타']; parkSrc = '조례 별표(그 밖의 건축물)'; }
  else { parkUnit = natUnit(p.use); parkSrc = r && r.has && r.has.park ? '조례에 별도 항목 없음 → 주차장법 시행령 별표1' : '주차장법 시행령 별표1'; }
  var mix = (p.zoneMix || []).filter(function (m) { return m.area > 0 && ZONES[m.zone]; });
  if (mix.length > 1) {
    var tot = mix.reduce(function (a, m) { return a + m.area; }, 0), small = Math.min.apply(null, mix.map(function (m) { return m.area; }));
    var zv = function (z, k) { return (k === 'b' ? (r && r.bcr[z]) || ZONES[z][0] : (r && r.far[z]) || ZONES[z][1]); };
    var wb = Math.round(mix.reduce(function (a, m) { return a + zv(m.zone, 'b') * m.area; }, 0) / tot * 100) / 100, wf = Math.round(mix.reduce(function (a, m) { return a + zv(m.zone, 'f') * m.area; }, 0) / tot * 100) / 100;
    var mixTxt = mix.map(function (m) { return m.zone + ' ' + fmt(m.area) + '㎡(' + zv(m.zone, 'b') + '/' + zv(m.zone, 'f') + '%)'; }).join(' + ');
    var how = small <= 330 ? '가장 작은 부분 ' + fmt(small) + '㎡ ≤ 330㎡ → 전체 대지 가중평균 적용' : '가장 작은 부분 ' + fmt(small) + '㎡ > 330㎡ → 부분별로 각각 적용(아래 값은 전체 상한)';
    if (!num(p.bcrLimit)) { bcr = wb; bcrSrc = '용도지역 혼재 가중평균: ' + mixTxt + ' — ' + how + ' (국토계획법 제84조)'; }
    if (!num(p.farLimit)) { far = wf; farSrc = '용도지역 혼재 가중평균 (국토계획법 제84조)'; }
  }
  var dis = r && r.disabledPct != null ? r.disabledPct : null;
  return { bcr: bcr, far: far, bcrSrc: bcrSrc, farSrc: farSrc, parkUnit: parkUnit, parkSrc: parkSrc, disPct: dis == null ? 4 : dis, disSrc: dis == null ? '조례값 미확인 → 상한 4% 적용' : '조례 ' + dis + '%' };
}

/* ---------- 경관조례 조항 판정 ---------- */
function splitClauses(text) {
  var t = String(text || '').replace(/\s+/g, ' ');
  var body = t.replace(/^제\d+조(의\d+)?\([^)]*\)\s*/, '');
  var paras = body.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).filter(function (x) { return x.trim(); });
  var out = [];
  paras.forEach(function (pa, pi) {
    var parts = pa.split(/(?<=[^\d제])(?=\d{1,2}\.\s?[「가-힣(])/);
    if (parts.length > 1) { var intro = parts[0]; parts.slice(1).forEach(function (it, ii) { out.push({ key: 'c' + pi + '_' + ii, intro: intro, text: it.trim() }); }); }
    else out.push({ key: 'c' + pi, intro: '', text: pa.trim() });
  });
  return out;
}
function koN(s) {
  s = String(s).replace(/,/g, '').replace(/\s/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  var m = s.match(/^(?:(\d+)만)?(?:(\d+)?천)?(?:(\d+)?백)?(\d+)?$/); if (!m) return NaN;
  var t = 0; if (m[1]) t += +m[1] * 10000; if (s.indexOf('천') >= 0) t += (m[2] ? +m[2] : 1) * 1000; if (s.indexOf('백') >= 0) t += (m[3] ? +m[3] : 1) * 100; if (m[4]) t += +m[4]; return t;
}
var ZONE_GROUP = { '녹지지역': /녹지/, '관리지역': /관리지역/, '농림지역': /농림/, '자연환경보전지역': /자연환경보전/, '공업지역': /공업/, '상업지역': /상업/, '주거지역': /주거/ };
var HO = { '단독주택': 1, '공동주택': 2, '제1종근린생활시설': 3, '제2종근린생활시설': 4, '문화및집회시설': 5, '종교시설': 6, '판매시설': 7, '의료시설': 9, '교육연구시설': 10, '노유자시설': 11, '수련시설': 12, '운동시설': 13, '업무시설': 14, '숙박시설': 15, '위락시설': 16, '공장': 17, '창고시설': 18, '위험물저장및처리시설': 19, '자동차관련시설': 20, '방송통신시설': 24 };
var USE_KW = { '공동주택': ['공동주택'], '공장': ['공장'], '창고시설': ['창고'], '숙박시설': ['숙박'], '판매시설': ['판매시설'], '업무시설': ['업무시설'], '문화및집회시설': ['문화 및 집회', '문화및집회'], '위락시설': ['위락'], '의료시설': ['의료시설'], '종교시설': ['종교시설'], '교육연구시설': ['교육연구'], '운동시설': ['운동시설'] };
function evalScapeClause(c, p, ctx) {
  var t = c.intro + ' ' + c.text, res = { met: [], fail: [], ask: null };
  if (/삭제/.test(c.text) && c.text.length < 20) { res.fail.push('삭제된 조항'); return res; }
  if (/경관위원회|공동위원회|심의를 생략|운영한다|준용하여|심의한다\./.test(c.text) && !/건축물/.test(c.text)) { res.fail.push('절차 규정'); return res; }
  var hasK = /중점경관관리구역/.test(c.text), hasD = /경관지구/.test(c.text.replace(/중점경관관리구역/g, ''));
  if (hasK || hasD) { if ((hasK && p.keyLandscapeArea) || (hasD && p.landscapeDistrict)) res.met.push(hasK && p.keyLandscapeArea ? '중점경관관리구역' : '경관지구'); else res.fail.push((hasD ? '경관지구' : '') + (hasD && hasK ? '·' : '') + (hasK ? '중점경관관리구역' : '') + ' 아님'); }
  if (/지방자치단체|공공기관|지방공기업|공공건축물/.test(c.text.replace(/지방자치단체의 조례/g, '')) && !/경관지구|중점/.test(c.text)) { if (p.owner !== '민간') res.met.push('공공 건축주'); else res.fail.push('민간 건축주'); }
  var zg = Object.keys(ZONE_GROUP).filter(function (g) { return t.indexOf(g) >= 0; });
  if (zg.length) { if (zg.some(function (g) { return ZONE_GROUP[g].test(p.zone); })) res.met.push(p.zone); else res.fail.push(zg.join('·') + ' 아님'); }
  var plain = c.text.replace(/「[^」]*」/g, '').replace(/별표\s*1\s*제\d+호(의\d+)?(\s*[가-힣]목)?/g, '').replace(/다만[^.]*제외[^.]*\./g, '');
  var uses = Object.keys(USE_KW).filter(function (u) { return USE_KW[u].some(function (k) { return plain.indexOf(k) >= 0; }); });
  if (uses.length) { if (uses.indexOf(p.use) >= 0) res.met.push(p.use); else res.fail.push(uses.join('·') + ' 용도 아님'); }
  var rng = c.text.match(/별표\s*1\s*제(\d+)호부터\s*제(\d+)호까지/), ho = HO[p.use] || 99;
  if (rng) { if (ho >= +rng[1] && ho <= +rng[2]) res.met.push('별표1 제' + rng[1] + '~' + rng[2] + '호 용도'); else res.fail.push('별표1 제' + rng[1] + '~' + rng[2] + '호 용도 아님'); }
  var exm = c.text.match(/다만[^.]*?((?:제\d+호[,·ㆍ및\s]*)+)[^.]*?제외/);
  if (exm && exm[1].match(/\d+/g).map(Number).indexOf(ho) >= 0) res.fail.push('단서에서 ' + p.use + '(제' + ho + '호) 제외');
  if (/제2조제17호/.test(t)) { if (ctx.multiuse) res.met.push('다중이용건축물'); else res.fail.push('다중이용건축물 아님'); }
  var size = [], sizeOk = false, m;
  if ((m = t.match(/(\d+)\s*층\s*(이상|초과)/))) { size.push(m[0]); if (num(p.floorsAbove) > +m[1] || (m[2] === '이상' && num(p.floorsAbove) >= +m[1])) sizeOk = true; }
  if ((m = t.match(/높이\s*(\d+(?:\.\d+)?)\s*미터\s*(이상|초과)/))) { size.push(m[0]); if (num(p.height) >= +m[1]) sizeOk = true; }
  if ((m = t.match(/연면적[^0-9천만]{0,15}([\d,천만]+)\s*(?:제곱미터|㎡)\s*(이상|초과)/))) { size.push(m[0]); if (num(p.gfa) >= koN(m[1])) sizeOk = true; }
  if ((m = t.match(/(\d+)\s*세대\s*이상/))) { size.push(m[0]); if (num(p.households) >= +m[1]) sizeOk = true; }
  if ((m = t.match(/건폐율\s*(\d+)\s*퍼센트를?\s*초과/))) { size.push(m[0]); if (num(p.siteArea) && num(p.bldgArea) / num(p.siteArea) * 100 > +m[1]) sizeOk = true; }
  if (size.length) { if (sizeOk) res.met.push(size.join(' 또는 ')); else res.fail.push(size.join(' 또는 ') + ' 미만'); }
  var loc = t.match(/[「」\w가-힣·ㆍ\s]{0,40}?(고속국도|일반국도|국도|지방도|도로|하천|해안|호수|저수지|공원|문화유산|문화재|국가유산|역사|철도|나들목|인터체인지|IC)[^.]{0,40}?(\d+)\s*미터\s*이내/);
  if (loc) { var ans = p.scapeAns[c.key]; var q = loc[0].replace(/^\s*\d+\.\s*/, '').trim(); if (ans === 'y') res.met.push(q); else if (ans === 'n') res.fail.push(q + ' 아님'); else res.ask = q; }
  if (!res.met.length && !res.fail.length && !res.ask) res.fail.push('적용 조건 없음(일반 규정)');
  return res;
}
function scapeEval(p, ctx) {
  var det = regionDetail(p), R = regionOf(p);
  var out = { lvl: 'no', why: [], asks: [], clauses: [] };
  if (ctx && (ctx.kind === '신고' || ctx.kind === '용도변경' || p.work === '대수선')) { out.why.push((ctx.kind === '신고' ? '건축신고 대상' : p.work === '대수선' ? '대수선' : '용도변경') + ' → 건축물 경관심의는 건축허가 대상 건축물만 받음 (경관법 시행령 제21조제1항 "건축허가를 받기 전") → 비대상'); return out; }
  if (p.landscapeDistrict) { out.lvl = 'req'; out.why.push('경관지구 내 건축물 — 경관법 제28조제1항제1호 (조례로 정한 제외 대상이 아니면 심의)'); }
  if (p.keyLandscapeArea) { out.lvl = 'req'; out.why.push('중점경관관리구역 내 건축물 — 경관법 제28조제1항제2호'); }
  if (!R) { if (out.lvl === 'no') { out.lvl = 'ask'; out.asks.push({ field: 'region', label: '지자체를 선택하면 해당 경관조례 조항으로 판정합니다' }); } return out; }
  if (!det) { out.why.push('조례 원문 불러오는 중…'); return out; }
  if (!det.scape || !det.scape.bldText) { if (out.lvl === 'no') out.why.push('해당 지자체 경관조례에 건축물 심의대상 조항이 없음 → 경관지구·중점경관관리구역·공공건축물(법정)만 대상'); if (p.owner !== '민간' && out.lvl === 'no') out.why.push('공공건축물도 "조례로 정하는 건축물"만 대상 (경관법 제28조제1항제3호) → 조례 조항 미확인으로 비대상 처리, 관리자 화면에서 조례 확인 권장'); return out; }
  var cl = splitClauses(det.scape.bldText);
  cl.forEach(function (c) {
    if (/제외|생략|아니할 수|하지 않을 수|적용하지/.test(c.intro + (c.intro ? '' : c.text.slice(0, 60)))) return;
    var r = evalScapeClause(c, p, ctx); c.res = r; out.clauses.push(c);
    var short = (c.text.length > 90 ? c.text.slice(0, 90) + '…' : c.text);
    if (!r.fail.length && !r.ask && r.met.length) { out.lvl = 'req'; out.why.push('해당: ' + short + ' (' + r.met.join(', ') + ')'); }
    else if (!r.fail.length && r.ask) { if (out.lvl !== 'req') out.lvl = 'ask'; out.asks.push({ scapeKey: c.key, label: '대지가 "' + r.ask + '"에 해당합니까? — ' + det.scape.src.name + ' ' + (det.scape.bldArt || '') }); }
  });
  if (out.lvl === 'no') out.why.push(det.scape.src.name + ' "' + (det.scape.bldArt || '') + '" 각 호에 해당 없음');
  return out;
}

/* ---------- 대상 판정 ---------- */
function areaBasis(p) { return (p.work === '증축' || p.work === '용도변경') && num(p.addArea) > 0 ? num(p.addArea) : num(p.gfa); }
function applicability(p) {
  var r = {}, gfa = num(p.gfa), A = areaBasis(p), fl = num(p.floorsAbove), fb = num(p.floorsBelow), site = num(p.siteArea), ex = num(p.excavation), pub = p.owner !== '민간';
  var newish = ['신축', '재축', '개축', '증축'].indexOf(p.work) >= 0;
  var span = num(p.span), special = span >= 20 || p.cantilever || p.flatSlab;
  var multiuse = (['문화및집회시설', '종교시설', '판매시설'].indexOf(p.use) >= 0 && gfa >= 5000) || fl >= 16;
  var R = regionOf(p), why;

  /* 건축허가·신고 */
  why = []; var kind = '허가';
  if (['증축', '개축', '재축'].indexOf(p.work) >= 0 && num(p.addArea) > 0 && num(p.addArea) <= 85 && (fl < 3 || num(p.addArea) <= gfa / 10)) { kind = '신고'; why.push('바닥면적 85㎡ 이내 증축·개축·재축 → 신고 (건축법 제14조제1항제1호)'); }
  else if (p.work === '신축' && NON_URBAN.indexOf(p.zone) >= 0 && gfa > 0 && gfa < 200 && fl < 3 && !p.districtPlan) { kind = '신고'; why.push('관리·농림·자연환경보전지역 연면적 200㎡ 미만·3층 미만 → 신고 (제14조제1항제2호)'); }
  else if (p.work === '대수선' && gfa < 200 && fl < 3) { kind = '신고'; why.push('연면적 200㎡ 미만·3층 미만 대수선 → 신고'); }
  else if (p.use === '공장' && (/공업/.test(p.zone) || p.industrialComplex || p.districtPlan) && fl <= 2 && gfa > 0 && gfa <= 500) { kind = '신고'; why.push('공업지역·산업단지·산업형 지구단위계획구역 2층 이하·연면적 500㎡ 이하 공장 → 신고 (시행령 제11조)'); }
  else if (p.work === '용도변경') { kind = '용도변경'; why.push('상위 시설군으로 변경 → 허가, 하위 시설군 → 신고, 같은 시설군 → 건축물대장 기재변경 (건축법 제19조)'); }
  else why.push('신고 요건(85㎡ 증축, 비도시 200㎡ 미만, 산업단지 500㎡ 이하 공장 등)에 해당하지 않음 → 건축허가');
  if (fl >= 21 || gfa >= 100000) why.push('21층 이상 또는 연면적 10만㎡ 이상 → 특별시장·광역시장 허가 / 도는 도지사 사전승인');
  r.permit = { lvl: 'req', label: kind, why: why };

  /* 에너지 */
  why = []; var lvl = 'no';
  var exemptUse = ['공장', '창고시설', '위험물저장및처리시설', '자동차관련시설', '방송통신시설'].indexOf(p.use) >= 0;
  if (p.use === '단독주택') why.push('단독주택 → 제출 제외 (시행령 제10조제1항제1호)');
  else if (p.work === '대수선') why.push('대수선 → 제출 대상 아님 (녹색건축법 제14조제1항)');
  else if (exemptUse && p.hvac === '없음') why.push(p.use + '로서 냉방·난방 설비를 모두 설치하지 않음 → 제출 제외 (시행령 제10조제1항제3호)');
  else if (A >= 500) {
    lvl = 'req'; why.push('적용 연면적 ' + fmt(A) + '㎡ ≥ 500㎡ → 제출 (시행령 제10조제1항)');
    if (exemptUse) why.push('냉방 또는 난방 설비가 하나라도 있으면 면제 안 됨');
    why.push('EPI ' + (pub && newish ? '74점 이상 (공공기관 신축)' : '65점 이상') + ' — 에너지절약설계기준 제15조');
    if (A >= 1000 && ['신축', '재축', '개축'].indexOf(p.work) >= 0) why.push('연면적 1천㎡ 이상: EPI 건축 7번 0.6점↑, 기계 1·2번 0.8점↑, 전기 1번 0.8점↑(또는 거실 전면 LED), 신재생 4점↑ — 설계기준 제15조제3항');
    if (['업무시설', '교육연구시설'].indexOf(p.use) >= 0 && gfa >= 3000) why.push(p.use + ' 3천㎡ 이상 → 건축물 에너지소요량 평가서 (150kWh/㎡·년 미만, 공공 130) — 설계기준 제21조');
  } else if (A > 0) why.push('적용 연면적 ' + fmt(A) + '㎡ < 500㎡ → 제출 대상 아님');
  else { lvl = 'ask'; }
  r.energy = { lvl: lvl, why: why, asks: lvl === 'ask' ? [{ field: 'gfa', label: '연면적을 입력하세요' }] : [] };

  /* ZEB */
  why = []; lvl = 'no';
  var zebWork = ['신축', '재축', '개축'].indexOf(p.work) >= 0 || (p.work === '증축' && p.separateAdd);
  if (pub && zebWork && r.energy.lvl === 'req' && p.use !== '단독주택') {
    if (p.use === '공동주택') { if (num(p.households) >= 30) { lvl = 'req'; why.push('공공 공동주택 30세대 이상 → ZEB 인증 의무 (시행령 별표1)'); } else why.push('공공 공동주택 30세대 미만 → 비대상'); }
    else if (gfa >= 1000) { lvl = 'req'; why.push('공공(국가·지자체·공공기관·교육감·공공주택사업자) 연면적 1천㎡ 이상 → ZEB 4등급 이상 (시행령 제12조제4항제1호)'); }
    else if (gfa >= 500) { lvl = 'req'; why.push('공공 연면적 500㎡ 이상 → ZEB 5등급 이상 (시행령 제12조제4항제2호)'); }
    else why.push('공공이지만 연면적 500㎡ 미만 → 비대상');
  } else why.push(pub ? '신축·재축·전부개축·별동증축이 아니거나 에너지절약계획서 대상 아님 → 비대상' : '인증 의무는 공공(국가·지자체·공공기관·교육감·공공주택사업자)만 해당 (시행령 별표1) → 민간 비대상');
  r.zeb = { lvl: lvl, why: why };

  /* 장애인 편의시설 */
  why = []; lvl = 'no'; var asks = [];
  var U = p.use;
  if (U === '공장') {
    if (p.emp50 === '예') { lvl = 'req'; why.push('장애인고용의무 사업주(상시근로자 50명 이상)가 운영하는 공장 → 편의시설 설치 대상 (시행령 별표1 제2호파목)'); }
    else if (p.emp50 === '아니오') why.push('장애인고용의무가 없는 사업주(상시근로자 50명 미만)의 공장 → 대상 아님');
    else { lvl = 'ask'; asks.push({ field: 'emp50', label: '공장을 운영할 사업주의 상시근로자가 50명 이상입니까? (장애인고용의무 사업주 여부 — 별표1 파목)', options: ['', '예', '아니오'] }); }
  } else if (U === '공동주택') {
    if (num(p.households) >= 10) { lvl = 'req'; why.push('아파트 또는 10세대 이상 연립·다세대 → 대상 (별표1 제3호)'); }
    else if (p.households) why.push('10세대 미만 연립·다세대 → 대상 아님 (아파트는 세대수 무관 대상)');
    else { lvl = 'ask'; asks.push({ field: 'households', label: '세대수를 입력하세요 (연립·다세대는 10세대 이상만 대상)' }); }
  } else if (U === '제1종근린생활시설' || U === '제2종근린생활시설') {
    var sub = NB_SUB[p.nbSub];
    if (!p.nbSub) { lvl = 'ask'; asks.push({ field: 'nbSub', label: '근린생활시설 세부용도를 선택하세요 (별표1 기준이 세부용도별로 다름)', options: Object.keys(NB_SUB) }); }
    else if (sub[0] < 0) why.push(p.nbSub + ' → 별표1 대상 아님');
    else { var okA = gfa >= sub[0] && (sub[1] == null || gfa < sub[1]); if (okA) { lvl = 'req'; why.push(p.nbSub + ' ' + sub[2] + ' → 대상'); } else why.push(p.nbSub + ' 기준(' + sub[2] + ') 밖 → 대상 아님'); }
  } else if (U === '숙박시설') {
    if (num(p.rooms) >= 30) { lvl = 'req'; why.push('객실 30실 이상 일반·생활숙박 → 대상'); }
    else if (p.rooms) why.push('객실 30실 미만 일반숙박 → 대상 아님 (관광숙박은 전부 대상)');
    else { lvl = 'ask'; asks.push({ field: 'rooms', label: '객실 수를 입력하세요 (30실 이상 대상, 관광숙박은 전부)' }); }
  } else if (BA_RULE[U]) {
    var br = BA_RULE[U];
    if (gfa >= br.min) { lvl = 'req'; why.push(U + ': ' + br.t + ' → 대상'); } else why.push(U + ': ' + br.t + ' 기준 미만 → 대상 아님');
  } else why.push(U + ' → 별표1 대상시설 아님');
  if (lvl === 'req') { var L = limits(p); why.push('장애인전용주차: 부설주차 10대 이상이면 ' + L.disSrc); }
  r.ba = { lvl: lvl, why: why, asks: asks };

  /* BF */
  why = []; lvl = 'no';
  var bfUses = ['제1종근린생활시설', '제2종근린생활시설', '문화및집회시설', '종교시설', '판매시설', '의료시설', '교육연구시설', '노유자시설', '수련시설', '운동시설', '업무시설', '숙박시설', '자동차관련시설', '방송통신시설'];
  if (pub && newish) {
    if (bfUses.indexOf(U) >= 0 || (U === '공장' && p.emp50 === '예')) { lvl = 'req'; why.push('국가·지자체·공공기관이 신축·증축·개축·재축하는 ' + U + ' → BF 인증 의무 (시행령 별표2의2)'); }
    else if (U === '공장' && !p.emp50) { lvl = 'ask'; }
    else why.push('공공이지만 ' + U + '는 별표2의2 인증 의무 시설 아님');
  } else if (!pub && (fl >= 50 || num(p.height) >= 200)) { lvl = 'req'; why.push('초고층 건축물(50층 또는 200m 이상) → 민간도 BF 인증 의무 (별표2의3)'); }
  else why.push(pub ? '신축·증축·개축·재축이 아님 → 비대상' : '민간은 초고층·지하연계 복합건축물만 의무 (별표2의3) → 비대상');
  r.bf = { lvl: lvl, why: why, asks: lvl === 'ask' ? [{ field: 'emp50', label: '공장 운영 사업주의 상시근로자 50명 이상 여부', options: ['', '예', '아니오'] }] : [] };

  /* 경관 */
  var se = scapeEval(p, { multiuse: multiuse, kind: kind });
  r.scape = { lvl: se.lvl, why: se.why, asks: se.asks, clauses: se.clauses };

  /* 건축위원회 */
  why = []; lvl = 'no';
  if (multiuse) { lvl = 'req'; why.push('다중이용건축물(문화집회·종교·판매 등 5천㎡ 이상 또는 16층 이상) → 구조안전 심의 (시행령 제5조의5제1항제4호, 착공신고 전)'); }
  if (special) { lvl = 'req'; why.push('특수구조건축물(' + (span >= 20 ? '기둥 간 거리 ' + span + 'm ≥ 20m' : p.cantilever ? '캔틸레버 3m 이상 돌출' : '무량판 구조') + ') → 구조안전 심의 (시행령 제2조제18호, 착공신고 전)'); }
  if (lvl === 'no') why.push('다중이용·특수구조 아님 → 법정 심의 대상 아님');
  var det = regionDetail(p);
  if (det && det.bld && det.bld.cmteText) why.push('조례 지정지역(시행령 제5조의5제1항제8호)에 속하면 추가 심의 — 아래 조례 원문 참고');
  r.cmte = { lvl: lvl, why: why };

  /* 구조 */
  why = []; lvl = 'no'; var c = [];
  if (fl >= 2) c.push('2층 이상'); if (gfa >= 200 && p.use !== '창고시설') c.push('연면적 200㎡ 이상'); if (num(p.height) >= 13) c.push('높이 13m 이상');
  if (num(p.eaves) >= 9) c.push('처마높이 9m 이상'); if (span >= 10) c.push('기둥 간 거리 10m 이상'); if (special) c.push('특수구조'); if (['단독주택', '공동주택'].indexOf(p.use) >= 0) c.push('주택');
  if (c.length) { lvl = 'req'; why.push('구조안전 확인서 제출 대상: ' + c.join(', ') + ' → 착공신고 시 제출 (시행령 제32조제2항)'); }
  else why.push('제출 대상 규모 아님 (창고는 연면적 200㎡ 기준 제외)');
  if (fl >= 6 || special || multiuse) why.push('건축구조기술사 협력 대상 (6층 이상·특수구조·다중이용 등, 시행령 제91조의3)');
  r.struct = { lvl: lvl, why: why };

  /* 소방 */
  why = []; lvl = 'no';
  var lim = 400; if (p.use === '노유자시설' || p.use === '수련시설') lim = 200;
  if (gfa >= lim) { lvl = 'req'; why.push('연면적 ' + fmt(gfa) + '㎡ ≥ ' + lim + '㎡ → 동의 대상 (시행령 제7조제1항제1호)'); }
  if (fl >= 6) { lvl = 'req'; why.push('6층 이상 → 동의 대상 (제4호)'); }
  if (p.parkingFloor) { lvl = 'req'; why.push('차고·주차 용도 층 또는 기계식 주차시설 → 동의 대상 (제3호)'); }
  if (fb > 0 && lvl === 'no') { lvl = 'ask'; }
  if (['공장', '창고시설'].indexOf(p.use) >= 0 && p.combustible750) { lvl = 'req'; why.push('특수가연물 기준수량 750배 이상 저장·취급 → 동의 대상 (제9호)'); }
  if (['공동주택', '숙박시설', '위험물저장및처리시설'].indexOf(p.use) >= 0) { lvl = 'req'; why.push(p.use + ' → 면적 무관 동의 대상 (제6호)'); }
  if (lvl === 'no') why.push('면적·층수·용도 기준 미만 → 동의 대상 아님');
  r.fire = { lvl: lvl, why: why, asks: lvl === 'ask' ? [{ field: 'parkingFloor', label: '지하층(또는 무창층) 바닥면적 150㎡ 이상인 층이 있으면 동의 대상입니다. 주차층/지하층 규모를 확인해 체크하세요', check: true }] : [] };

  /* 교통 */
  why = []; lvl = 'no';
  var tz = p.trafficZone || (R ? (/군$/.test(R.sgg) ? '교통권역' : '도시교통정비지역') : '도시교통정비지역');
  var th = TRAFFIC[p.use];
  if (th) { var lim2 = th[tz === '교통권역' ? 1 : 0]; if (gfa >= lim2) { lvl = 'req'; why.push(p.use + ' 연면적 ' + fmt(gfa) + '㎡ ≥ ' + fmt(lim2, 0) + '㎡(' + tz + ') → 대상 (시행령 별표1)'); } else why.push(p.use + ' 기준 ' + fmt(lim2, 0) + '㎡(' + tz + ') 미만 → 대상 아님'); }
  else why.push(p.use + '는 단일용도 대상 목록에 없음 → 대상 아님 (복합용도면 합산 기준 별도)');
  why.push('지역 구분: ' + tz + (p.trafficZone ? ' (직접 선택)' : ' (시·구 → 정비지역, 군 → 교통권역으로 자동 적용)'));
  r.traffic = { lvl: lvl, why: why };

  /* 지하안전 */
  why = []; lvl = 'no';
  if (ex >= 20) { lvl = 'req'; why.push('최대 굴착깊이 ' + ex + 'm ≥ 20m → 지하안전평가 (시행령 제13조)'); }
  else if (ex >= 10) { lvl = 'req'; why.push('굴착깊이 ' + ex + 'm (10~20m) → 소규모 지하안전평가 (시행령 제23조)'); }
  else why.push('굴착깊이 10m 미만 → 대상 아님 (집수정·EV피트·정화조 굴착은 제외하고 산정)');
  r.under = { lvl: lvl, why: why };

  /* 개발행위허가·도시계획위원회 */
  why = []; asks = []; lvl = 'no';
  var bldAct = ['신축', '증축', '개축', '재축', '이전'].indexOf(p.work) >= 0;
  var READY = ['대', '공장용지', '창고용지', '주차장', '주유소용지', '학교용지', '종교용지'];
  var cat = p.landCat || '', cf = p.cutFill === '' || p.cutFill == null ? null : num(p.cutFill), form = null, cw = [], cmte = 'no';
  var cityZone = /주거|상업|공업/.test(p.zone);
  if (!cat) asks.push({ field: 'landCat', label: '현재 지목을 선택하세요 (토지이용계획확인서·토지대장) — 대·공장용지 등은 조성 완료 대지, 전·답·임야·잡종지 등은 형질변경', options: ['', '대', '공장용지', '창고용지', '잡종지', '전', '답', '과수원', '임야', '목장용지', '기타'] });
  if (cat && cf == null) asks.push({ field: 'cutFill', label: '대지 정지 시 최대 절토·성토 높이(m) — 지하구조물 터파기·되메우기는 제외 (0.5m 이하면 경미한 형질변경)' });
  if (cat && READY.indexOf(cat) < 0) {
    if (cityZone && cf != null && cf <= 0.5) { form = false; why.push('지목 ' + cat + '이지만 ' + p.zone + '에서 절·성토 ' + cf + 'm ≤ 0.5m → 지목변경 수반해도 경미한 형질변경 (시행령 제53조제3호가목)'); }
    else if (cf != null || !cityZone) { form = true; why.push('지목 ' + cat + ' → 대지 조성(지목변경) 수반 → 토지 형질변경 (시행령 제51조제1항제3호)'); }
  } else if (cat && cf != null) {
    if (cf > 0.5) { form = true; why.push('조성 완료 대지(' + cat + ')라도 절·성토 ' + cf + 'm > 0.5m → 토지 형질변경 (제53조제3호다목은 절토·성토 제외)'); }
    else { form = false; why.push('조성 완료 대지(' + cat + ')·절·성토 ' + cf + 'm ≤ 0.5m → 형질변경은 경미한 행위 (제53조제3호가·다목)'); }
  }
  if (bldAct) { lvl = 'req'; why.unshift('건축허가·신고 대상 건축물의 ' + p.work + ' = 개발행위(건축물의 건축) → 개발행위허가 대상, 건축허가 시 의제 처리 (국토계획법 제56조제1항제1호, 시행령 제51조·제53조제1호, 건축법 제11조제5항제3호)'); }
  else if (form === true) { lvl = 'req'; why.unshift(p.work + '는 건축물의 건축이 아니지만 형질변경 수반 → 개발행위허가 대상'); }
  else if (form === false) why.unshift(p.work + '는 건축물의 건축이 아니고 형질변경도 경미 → 개발행위허가 비대상');
  else lvl = 'ask';
  if (p.industrialComplex && form !== true) why.push('산업단지·농공단지 분양필지: 단지 조성 때 형질변경 완료 → 건축 행위만 의제(개발행위 부서 협의 간소)');
  var ZL = /보전녹지|자연환경보전/.test(p.zone) ? 5000 : /공업|관리|농림/.test(p.zone) ? 30000 : 10000;
  if (form === true && site > 0) {
    if (site >= ZL) { cmte = 'req'; why.push('형질변경 면적(필지 총면적 기준) ' + fmt(site, 0) + '㎡ ≥ ' + p.zone + ' 허가규모 ' + fmt(ZL, 0) + '㎡ → 원칙적으로 허가 불가 (법 제58조제1항제1호, 시행령 제55조) — 지구단위계획 가구·획지 안 기반시설 기설치(제55조제3항제1호) 등 예외가 아니면 지구단위계획 수립 필요. 관리·농림지역은 조례로 더 작게 정할 수 있음'); cw.push('규모 이상 형질변경 → 심의 대상 (시행령 제57조제1항제1호)'); }
    else if (NON_URBAN.indexOf(p.zone) >= 0 || /녹지/.test(p.zone)) { cmte = 'cond'; cw.push(p.zone + '에서 건축 목적 형질변경(허가규모 미만) → 심의 대상이 원칙 (시행령 제57조제1항제1호의2)'); }
    else cw.push(p.zone + ' 허가규모 미만 → 심의 비대상 (법 제59조제2항제3호, 조례로 정한 규모·위치에 해당할 때만 심의)');
  } else if (form === true) asks.push({ field: 'siteArea', label: '대지면적(형질변경 면적)을 입력하세요 — 허가규모·도시계획위원회 심의 판정에 필요' });
  else if (form === false) cw.push('형질변경 없음 → 심의 비대상 (시행령 제57조제1항은 형질변경을 수반하는 경우만)');
  var cx = [];
  if (p.districtPlan) cx.push('지구단위계획구역'); if (p.growthPlan) cx.push('성장관리계획구역');
  if (r.traffic && r.traffic.lvl === 'req') cx.push('교통영향평가 검토 대상(제59조제2항제5호)');
  if (cmte !== 'no' && cx.length) { cmte = 'no'; cw.push(cx.join('·') + ' → 심의 면제 (법 제59조제2항)'); }
  if (cmte === 'cond') {
    if (p.devCmteEx === '예') { cmte = 'no'; cw.push('제57조제1항제1호의2 단서 예외 해당(입력값) → 심의 면제'); }
    else if (p.devCmteEx === '아니오') { cmte = 'req'; cw.push('단서 예외 해당 없음(입력값) → 심의 대상 확정'); }
    else { cmte = 'req'; cw.push('단서 예외가 아니면 심의 대상 → 아래 질문에 답하면 확정'); asks.push({ field: 'devCmteEx', label: '대지가 자연취락지구·개발진흥지구·기반시설부담구역·준산업단지·공장입지유도지구이거나, 지자체가 기반시설 설치지역으로 고시한 곳이거나, 조례로 정한 예외 건축물(기존 부지 10% 이하 증축, 660㎡ 이하 농·임·어업용 창고 등) 또는 계획관리지역 2002년 이전 공장의 50% 이내 부지확장입니까?', options: ['', '예', '아니오'] }); }
  }
  cw.forEach(function (w) { why.push('[도시계획위원회] ' + w); });
  if (/^(전|답|과수원)$/.test(cat)) why.push('농지 → 농지전용허가·신고 선행 (농지법 제34조·제35조), 농지보전부담금 부과');
  if (cat === '임야' || p.mountain !== '없음') why.push('산지 → 산지전용허가 별도 (산지관리법 제14조), 대체산림자원조성비 부과');
  if (form === true) why.push('허가기준: 도시·군계획조례의 경사도·표고·입목축적, 진입도로 폭, 배수 / 이행보증금 예치 (법 제58조·제60조)');
  r.dev = { lvl: lvl, why: why, asks: asks, form: form, cmte: cmte, label: lvl === 'req' ? (cmte === 'req' ? '도시계획위원회 심의 포함' : form === true ? '형질변경 포함' : '건축허가 시 의제') : '' };

  /* 공작물 축조신고 */
  why = []; asks = []; lvl = 'no';
  var ST = [['stWall', 2, '옹벽·담장', 5], ['stChimney', 6, '굴뚝', 1], ['stTower', 4, '장식탑·기념탑·광고탑·광고판', 3], ['stTank', 8, '고가수조', 4], ['stMast', 6, '운동시설용 철탑(주거·상업지역은 통신철탑 포함)', 7], ['stPv', 5, '태양광 발전설비', 11]], stHit = [], stAny = false;
  ST.forEach(function (s) { var raw = p[s[0]], v = num(raw); if (raw === '' || raw == null || !(v > 0)) return; stAny = true;
    if (v > s[1]) { stHit.push(s[2]); why.push(s[2] + ' 높이 ' + v + 'm > ' + s[1] + 'm → 신고 (시행령 제118조제1항제' + s[3] + '호)'); }
    else why.push(s[2] + ' 높이 ' + v + 'm ≤ ' + s[1] + 'm → 신고 불요'); });
  if (num(p.stShelter) > 0) { stAny = true; if (num(p.stShelter) > 30) { stHit.push('지하대피호'); why.push('지하대피호 바닥면적 ' + num(p.stShelter) + '㎡ > 30㎡ → 신고 (제118조제1항제6호)'); } else why.push('지하대피호 30㎡ 이하 → 신고 불요'); }
  if (p.stPark) { stAny = true; stHit.push('기계식·철골조립식 주차장'); why.push('외벽 없는 높이 8m 이하 기계식·철골조립식 주차장 → 신고 (제118조제1항제8호)'); }
  if (p.stSilo) { stAny = true; stHit.push('조례 지정 제조·저장·유희시설'); why.push('건축조례로 정한 제조시설·저장시설(시멘트사일로 포함)·유희시설 → 신고 (제118조제1항제9호)'); }
  if (stHit.length) {
    lvl = 'req';
    why.push('건축물과 분리 축조하는 공작물만 해당 — 건축허가 시 축조신고 의제 처리 가능 (건축법 제11조제5항)');
    why.push('신고 대상 공작물은 국토계획법상 "공작물의 설치" 경미행위에서 빠짐 → 개발행위허가도 함께 의제 (국토계획법 시행령 제53조제2호 단서)');
    if (stHit.some(function (h) { return /광고/.test(h); })) why.push('광고탑·광고판은 옥외광고물법 허가·신고 별도');
    if (stHit.indexOf('옹벽·담장') >= 0) why.push('옹벽은 구조도·구조계산서로 안전성 제시, 대지 경계 옹벽은 건축법 제40조(대지 안전) 함께 검토');
  } else if (cf != null && cf > 2 && (p.stWall === '' || p.stWall == null)) { lvl = 'ask'; asks.push({ field: 'stWall', label: '절·성토 ' + cf + 'm → 옹벽·담장을 설치하면 최고 높이(m)를 입력하세요 (2m 초과면 공작물 축조신고, 옹벽 없이 법면 처리면 0)' }); }
  else why.push(stAny ? '입력한 공작물 모두 신고 기준 이하 → 비대상' : '입력된 분리 공작물 없음 → 비대상 (옹벽 2m·굴뚝 6m·광고탑 4m·고가수조 8m·태양광 5m 초과 등이면 대상)');
  r.stw = { lvl: lvl, why: why, asks: asks, label: stHit.length ? stHit.length + '종' : '' };

  /* 소규모환경영향평가 */
  why = []; lvl = 'no'; var eia = false;
  var eiaTh = { '보전관리지역': 5000, '생산관리지역': 7500, '계획관리지역': 10000, '농림지역': 7500, '자연환경보전지역': 5000 }[p.zone];
  if (eiaTh && site >= eiaTh) { eia = true; lvl = 'req'; why.push(p.zone + ' 사업계획면적 ' + fmt(site, 0) + '㎡ ≥ ' + fmt(eiaTh, 0) + '㎡ → 소규모환경영향평가 (시행령 별표4)'); }
  else if (eiaTh && site > 0) why.push(p.zone + ' 사업계획면적 ' + fmt(site, 0) + '㎡ < ' + fmt(eiaTh, 0) + '㎡ → 비대상');
  else if (!eiaTh) why.push(p.zone + ' — 별표4 용도지역 기준(관리·농림·자연환경보전) 대상 아님');
  if (p.greenbelt && site >= 5000) { eia = true; lvl = 'req'; why.push('개발제한구역 5천㎡ 이상 → 소규모환경영향평가'); }
  if (p.mountain === '공익용산지' && site >= 10000) { eia = true; lvl = 'req'; why.push('공익용산지 1만㎡ 이상 → 소규모환경영향평가'); }
  if (p.mountain === '그 외 산지' && site >= 30000) { eia = true; lvl = 'req'; why.push('산지(공익용 외) 3만㎡ 이상 → 소규모환경영향평가'); }
  if (p.mountain !== '없음') why.push('산지 포함 → 산지전용허가 별도');
  r.env = { lvl: lvl, why: why, eia: eia };

  /* 공장설립 */
  why = []; lvl = 'no';
  if (p.use === '공장') {
    if (p.industrialComplex) { lvl = 'req'; why.push('산업단지 → 입주계약 후 공장등록 (설립승인 대신)'); }
    else if (num(p.bldgArea) >= 500) { lvl = 'req'; why.push('공장건축면적 500㎡ 이상 → 공장설립 승인 (산업집적법 제13조, 건축허가 의제 가능)'); }
    else { lvl = 'req'; why.push('공장건축면적 500㎡ 미만 → 승인 불요, 완료 후 공장등록'); }
  } else why.push('공장 용도 아님');
  r.factory = { lvl: lvl, why: why };
  return r;
}

function docRequired(p, app, rid, d) {
  if (rid === 'permit' && d.id === 'fire') return app.fire.lvl === 'req';
  if (rid === 'permit' && d.id === 'scape') return landscapeNeed(cur()).need > 0;
  if (rid === 'energy' && d.id === 'renew') return areaBasis(p) >= 1000 && ['신축', '재축', '개축'].indexOf(p.work) >= 0;
  if (rid === 'energy' && d.id === 'primary') return ['업무시설', '교육연구시설'].indexOf(p.use) >= 0 && num(p.gfa) >= 3000;
  if (rid === 'env' && d.id === 'eia') return app.env.eia;
  if (rid === 'dev' && d.id === 'cmte') return app.dev.cmte === 'req';
  if (rid === 'dev' && ['survey', 'earth', 'drain', 'slope'].indexOf(d.id) >= 0) return app.dev.form === true;
  if (rid === 'dev' && d.id === 'farm') return /^(전|답|과수원)$/.test(p.landCat);
  if (rid === 'dev' && d.id === 'forest') return p.landCat === '임야' || p.mountain !== '없음';
  if (rid === 'factory' && d.id === 'app') return p.use === '공장' && !p.industrialComplex && num(p.bldgArea) >= 500;
  if (rid === 'cmte' && d.id === 'struct') return app.cmte.lvl === 'req';
  return d.req;
}

/* ---------- 조경 ---------- */
function landscapeNeed(prj) {
  var p = prj.p, site = num(p.siteArea), gfa = num(p.gfa), R = regionOf(p);
  if (!site) return { need: 0, note: '대지면적 미입력' };
  if (site < 200) return { need: 0, note: '대지 200㎡ 미만 → 조경 의무 없음 (건축법 제42조)' };
  if (/녹지/.test(p.zone)) return { need: 0, note: '녹지지역 → 조경 제외 가능 (시행령 제27조제1항제1호)' };
  if (NON_URBAN.indexOf(p.zone) >= 0 && !p.districtPlan) return { need: 0, note: '관리·농림·자연환경보전지역(지구단위계획구역 외) → 조경 제외 (제27조제1항제9호)' };
  if (p.use === '공장') {
    if (p.industrialComplex) return { need: 0, note: '산업단지의 공장 → 조경 제외 (제27조제1항제4호)' };
    if (site < 5000) return { need: 0, note: '대지 5천㎡ 미만 공장 → 조경 제외 (제2호)' };
    if (gfa < 1500) return { need: 0, note: '연면적 1,500㎡ 미만 공장 → 조경 제외 (제3호)' };
    var natRate = gfa >= 2000 ? 10 : 5, rate = natRate, src = '시행령 제27조제2항제1호(공장)';
    var ft = R && R.scapeTiers ? R.scapeTiers.filter(function (t) { return t.factory && gfa >= t.min && (t.max == null || gfa < t.max); })[0] : null;
    if (ft && ft.rate < natRate) { rate = ft.rate; src = '조례(공장 완화)'; }
    return { need: site * rate / 100, rate: rate, note: '공장 대지면적의 ' + rate + '% — ' + src + ' (조례는 이보다 완화만 가능)' };
  }
  var tiers = R && R.scapeTiers && R.scapeTiers.length ? R.scapeTiers.filter(function (t) { return !t.factory; }) : [];
  var tier = tiers.filter(function (t) { return gfa >= t.min && (t.max == null || gfa < t.max); })[0];
  if (tier) return { need: site * tier.rate / 100, rate: tier.rate, note: '대지면적의 ' + tier.rate + '% — ' + (R ? R.sgg + ' 건축조례' : '조례') };
  if (site < 300) return { need: site * 0.1, rate: 10, note: '200~300㎡ 대지 10% — 시행령 제27조제2항제4호' };
  return { need: null, rate: null, note: R ? '조례에서 조경 비율을 읽지 못함 — 지자체 조례 탭 원문 확인' : '지자체를 선택하면 조례 비율 적용' };
}

/* ---------- 수치 검토 ---------- */
function numericChecks(prj) {
  var p = prj.p, out = [], site = num(p.siteArea), app = applicability(p), L = limits(p);
  if (site > 0 && num(p.bldgArea) > 0) { var v = num(p.bldgArea) / site * 100; out.push({ rid: 'permit', label: '건폐율', val: fmt(v, 2) + '%', lim: L.bcr + '% 이하 (' + L.bcrSrc + ')', ok: v <= L.bcr }); }
  var far = num(p.gfaFar) || num(p.gfa);
  if (site > 0 && far > 0) { var v2 = far / site * 100; out.push({ rid: 'permit', label: '용적률', val: fmt(v2, 2) + '%', lim: L.far + '% 이하 (' + L.farSrc + ')', ok: v2 <= L.far, note: p.gfaFar ? '' : '용적률 산정 연면적 미입력 → 전체 연면적으로 계산' }); }
  var needPark = 0;
  if (num(p.gfa) > 0 && ['단독주택', '공동주택'].indexOf(p.use) < 0) {
    needPark = Math.round(num(p.gfa) / L.parkUnit + 0.0001); if (num(p.gfa) / L.parkUnit % 1 >= 0.5) needPark = Math.ceil(num(p.gfa) / L.parkUnit); else needPark = Math.floor(num(p.gfa) / L.parkUnit);
    var has = p.parkingPlan !== '';
    out.push({ rid: 'permit', need: needPark, label: '부설주차 대수', val: has ? num(p.parkingPlan) + '대' : '미입력', lim: needPark + '대 이상 (시설면적 ' + L.parkUnit + '㎡당 1대, ' + L.parkSrc + ')', ok: has ? num(p.parkingPlan) >= needPark : null, note: '소수점 0.5 이상 1대 (시행령 별표1 비고6), 시설면적은 주차 바닥면적 제외' });
  }
  var base = Math.max(num(p.parkingPlan), needPark), has2 = p.disabledParkingPlan !== '' && p.disabledParkingPlan != null, dVal = has2 ? num(p.disabledParkingPlan) + '대' : '미입력';
  if (base > 0) {
    if (base < 10) out.push({ rid: 'ba', need: 0, label: '장애인전용 주차구획', val: has2 ? dVal : '-', lim: '부설주차 ' + base + '대(10대 미만) → 설치 의무 없음 (편의증진법 시행령 별표2)', ok: true });
    else {
      var need = Math.max(1, Math.ceil(base * L.disPct / 100)), basis = '부설주차 ' + base + '대 × ' + L.disPct + '% 올림';
      if (app.ba.lvl === 'req') out.push({ rid: 'ba', need: need, label: '장애인전용 주차구획', val: dVal, lim: need + '대 이상 (' + basis + ', ' + L.disSrc + ')', ok: has2 ? num(p.disabledParkingPlan) >= need : null, note: '구획 3.3m×5.0m 이상, 출입구 가까운 곳' });
      else if (app.ba.lvl === 'ask') out.push({ rid: 'ba', need: need, label: '장애인전용 주차구획', val: dVal, lim: (p.use === '공장' ? '상시근로자 50명 이상 사업주 공장이면 ' : '편의시설 대상이면 ') + need + '대 이상 (' + basis + ')', ok: null, note: '② 대상 판정의 장애인 편의시설 질문에 답하면 확정' });
      else out.push({ rid: 'ba', need: 0, label: '장애인전용 주차구획', val: has2 ? dVal : '-', lim: p.use + ' — 편의시설 설치 대상 아님 → 장애인전용주차 의무 없음', ok: true });
    }
  }
  var ln = landscapeNeed(prj);
  if (site > 0) {
    if (ln.need === 0) out.push({ rid: 'permit', label: '조경면적', val: p.landscapePlan ? fmt(num(p.landscapePlan)) + '㎡' : '-', lim: ln.note, ok: true });
    else if (ln.need) out.push({ rid: 'permit', label: '조경면적', val: p.landscapePlan !== '' ? fmt(num(p.landscapePlan)) + '㎡ (' + fmt(num(p.landscapePlan) / site * 100, 1) + '%)' : '미입력', lim: fmt(ln.need) + '㎡ 이상 — ' + ln.note, ok: p.landscapePlan !== '' ? num(p.landscapePlan) >= ln.need : null });
    else out.push({ rid: 'permit', label: '조경면적', val: p.landscapePlan || '-', lim: ln.note, ok: null });
  }
  var H = num(p.height), hFlags = [];
  if (p.heightDistrict) hFlags.push('고도지구'); if (p.districtPlan) hFlags.push('지구단위계획'); if (p.landscapeDistrict) hFlags.push('경관지구'); if (p.heritageZone) hFlags.push('국가유산 주변'); if (p.flightZone && !num(p.aslLimit)) hFlags.push('비행안전구역·공항');
  if (num(p.hLimit) > 0) out.push({ rid: 'permit', label: '최고높이', val: H ? fmt(H) + 'm' : '미입력', lim: fmt(num(p.hLimit)) + 'm 이하 (' + (p.hLimitSrc || '직접 입력') + ')' + (p.lockOrig && p.lockOrig.hLimit != null && String(p.lockOrig.hLimit) !== String(p.hLimit) ? ' ⚠ 법규값 ' + p.lockOrig.hLimit + 'm에서 수동 변경' : ''), ok: H ? H <= num(p.hLimit) : null, note: (H && H <= num(p.hLimit) && num(p.hLimit) - H < 1 ? '여유 1m 미만 — 옥탑·파라펫·설비 높이 포함 여부 재확인. ' : '') + (p.hLimitNote && (!H || H > num(p.hLimit)) ? p.hLimitNote + ' 가능' : '') });
  else if (hFlags.length) out.push({ rid: 'permit', label: '최고높이', val: H ? fmt(H) + 'm' : '미입력', lim: hFlags.join('·') + ' 결정 높이 — 공개 데이터에 수치 없음, 확인 후 입력', ok: null, note: (p.pnu ? '주소란 아래 "토지이음에서 이 필지 열람" → 층수·높이제한 탭. ' : '') + '고도지구·지구단위계획: 토지이음 도시계획 결정도 / 국가유산: 국가유산청 현상변경 허용기준 / 비행안전구역: 관할 부대 협의 / 공항: 장애물제한표면' });
  if (num(p.aslLimit) > 0) { var g = num(p.groundEl), hasG = p.groundEl !== '' && p.groundEl != null; out.push({ rid: 'permit', label: '해발 고도제한', val: hasG && H ? '지반 ' + fmt(g) + 'm + 건물 ' + fmt(H) + 'm = 해발 ' + fmt(g + H) + 'm' : (H ? '건물 ' + fmt(H) + 'm (지반고 미입력)' : '미입력'), lim: '해발 ' + fmt(num(p.aslLimit)) + 'm 이하 → 건물 최대 ' + (hasG ? fmt(num(p.aslLimit) - g) + 'm' : '(해발 − 지반고)') + ' (' + p.aslSrc + ')', ok: hasG && H ? g + H <= num(p.aslLimit) : null, note: hasG ? '옥탑·피뢰침·안테나 포함 최상단 기준' : '"대지 지반고(해발)" 칸에 측량도 지반고를 넣으면 판정' }); }
  if (/전용주거|일반주거/.test(p.zone) && H > 0) { var nNeed = H <= 10 ? 1.5 : H / 2, nHas = p.northDist !== '' && p.northDist != null; out.push({ rid: 'permit', label: '정북방향 일조 이격', val: nHas ? fmt(num(p.northDist)) + 'm' : '미입력', lim: fmt(nNeed, 2) + 'm 이상 (높이 ' + fmt(H) + 'm: 10m 이하 부분 1.5m, 초과 부분은 높이의 1/2 — 건축법 시행령 제86조)', ok: nHas ? num(p.northDist) >= nNeed : null, note: '최고 높이 부분 기준. 정북 방향이 도로·공원·하천 등에 접하면 완화 (제86조제3항)' }); }
  if (app.energy.lvl === 'req') {
    var auto = prj.files.map(function (f) { return f.epi; }).filter(Boolean);
    var val = num(p.epi) || (auto.length ? Math.max.apply(null, auto) : 0), lim = p.owner !== '민간' && ['신축', '재축', '개축', '증축'].indexOf(p.work) >= 0 ? 74 : 65;
    out.push({ rid: 'energy', label: 'EPI 평점 합계', val: val ? fmt(val) + '점' + (!num(p.epi) && auto.length ? ' (파일 인식)' : '') : '미입력', lim: lim + '점 이상', ok: val ? val >= lim : null, note: val && val >= lim && val < lim + 3 ? '기준 근접 — 검토기관 보정 시 미달 가능' : '' });
  }
  if (app.ba.lvl === 'req' || app.bf.lvl === 'req') {
    BF_DIM.forEach(function (d) {
      var v3 = p.bf ? p.bf[d.key] : ''; if (v3 === undefined || v3 === '') return;
      var n = num(v3), ok = d.min !== undefined ? n >= d.min : n <= d.max;
      out.push({ rid: 'ba', label: d.label, val: d.key === 'rampSlope' ? '1/' + n : n + d.unit, lim: d.note, ok: ok });
    });
    prj.files.forEach(function (f) { (f.ramps || []).forEach(function (n) { if (n < 12) out.push({ rid: 'ba', label: '경사로 기울기 (' + f.name + ')', val: '1/' + n, lim: '1/12 이하 (부득이 1/8)', ok: n >= 8 ? null : false }); }); });
  }
  return out;
}

/* ---------- 파일 분석 ---------- */
var ALL_KW = (function () { var s = {}; REVIEWS.forEach(function (r) { r.docs.forEach(function (d) { d.kw.forEach(function (k) { s[k] = 1; }); }); r.content.forEach(function (c) { c.any.forEach(function (k) { s[k] = 1; }); }); }); return Object.keys(s); })();
var lc = function (s) { return String(s).toLowerCase().replace(/\s+/g, ''); };
function classify(name, text) {
  var n = lc(name), t = lc(text || ''), app = applicability(cur().p), res = [];
  REVIEWS.forEach(function (r) { r.docs.forEach(function (d) {
    var nh = 0, th = 0; d.kw.forEach(function (k) { var kk = lc(k); if (n.indexOf(kk) >= 0) nh++; if (t && t.indexOf(kk) >= 0) th++; });
    if (app[r.id] && app[r.id].lvl === 'no' && nh === 0) return;
    var score = nh * 5 + Math.min(th, 3) * 2; if (score > 0) score += 1;
    if (score >= 3) res.push({ rid: r.id, did: d.id, score: score });
  }); });
  res.sort(function (a, b) { return b.score - a.score; });
  return res.slice(0, 16).map(function (x) { return { rid: x.rid, did: x.did }; });
}
var libs = {};
function loadScript(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
function pdfLib() { if (!libs.pdf) libs.pdf = loadScript(PDFJS + 'pdf.min.js').then(function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return window.pdfjsLib; }); return libs.pdf; }
function zipLib() { if (!libs.zip) libs.zip = loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js').then(function () { return window.JSZip; }); return libs.zip; }
function pdfText(file) {
  return Promise.all([pdfLib(), file.arrayBuffer()]).then(function (a) {
    return a[0].getDocument({ data: new Uint8Array(a[1]), cMapUrl: PDFJS + 'cmaps/', cMapPacked: true }).promise;
  }).then(function (doc) {
    var n = Math.min(doc.numPages, 80), out = '', chain = Promise.resolve();
    for (var i = 1; i <= n; i++) (function (i) { chain = chain.then(function () { return doc.getPage(i); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) { out += tc.items.map(function (x) { return x.str; }).join(' ') + '\n'; }); })(i);
    return chain.then(function () { return out; });
  });
}
function extractText(file) {
  var ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return pdfText(file).catch(function () { return null; });
  if (['txt', 'csv', 'md'].indexOf(ext) >= 0) return file.text();
  if (['docx', 'hwpx', 'xlsx', 'pptx'].indexOf(ext) >= 0) {
    var pick = ext === 'docx' ? /^word\/document\.xml$/ : ext === 'hwpx' ? /^Contents\/section\d+\.xml$/ : ext === 'xlsx' ? /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/ : /^ppt\/slides\/slide\d+\.xml$/;
    return zipLib().then(function (JSZip) { return JSZip.loadAsync(file); }).then(function (zip) {
      var keys = Object.keys(zip.files).filter(function (k) { return pick.test(k); });
      return Promise.all(keys.map(function (k) { return zip.files[k].async('string'); })).then(function (arr) { return arr.join('\n').replace(/<[^>]+>/g, ' '); });
    }).catch(function () { return null; });
  }
  return Promise.resolve(null);
}
function findEPI(t) {
  var s = t.replace(/\s+/g, ' '), res = [], m;
  [/평점\s*합계[^0-9]{0,25}(\d{2,3}(?:\.\d+)?)/g, /(?:EPI|에너지성능지표)[^0-9]{0,40}?(\d{2,3}(?:\.\d+)?)\s*점/g].forEach(function (re) { while ((m = re.exec(s))) { var v = parseFloat(m[1]); if (v >= 20 && v <= 150) res.push(v); } });
  return res.length ? Math.max.apply(null, res) : null;
}
function findRamps(t) { var s = t.replace(/\s+/g, ' '), out = {}, re = /경사로[^.。]{0,40}?1\s*\/\s*(\d{1,2})(?!\d)/g, m; while ((m = re.exec(s))) { var n = +m[1]; if (n >= 4 && n <= 30) out[n] = 1; } return Object.keys(out).map(Number); }
function handleFiles(list) {
  var prj = cur(), chain = Promise.resolve();
  list.forEach(function (file) {
    chain = chain.then(function () {
      var f = { id: uid(), name: file.name, size: file.size, ext: file.name.split('.').pop().toLowerCase(), status: '분석 중', docs: [], kw: [], epi: null, ramps: [] };
      prj.files.push(f); renderFiles();
      return extractText(file).then(function (text) {
        if (text && text.replace(/\s/g, '').length > 30) {
          fileText[f.id] = text; var t = lc(text);
          f.kw = ALL_KW.filter(function (k) { return t.indexOf(lc(k)) >= 0; });
          f.epi = findEPI(text); f.ramps = findRamps(text); f.status = '본문 분석 완료 (' + fmt(text.length, 0) + '자)';
        } else if (f.ext === 'pdf') f.status = '스캔 이미지 PDF — 글자 인식 불가, 파일명으로만 분류';
        else if (f.ext === 'hwp') f.status = 'HWP — PDF 또는 HWPX로 저장해서 올리면 내용 검토';
        else if (f.ext === 'dwg' || f.ext === 'dxf') f.status = '도면 원본 — PDF로 출력해서 올리면 내용 검토';
        else f.status = '파일명으로만 분류';
        f.docs = classify(f.name, text || ''); save(); renderFiles();
      });
    });
  });
  chain.then(renderAll);
}

/* ---------- 판정 종합 ---------- */
function docStatus(prj, rid, did) {
  var files = prj.files.filter(function (f) { return f.docs.some(function (d) { return d.rid === rid && d.did === did; }); });
  var manual = prj.manual[rid + '.' + did];
  return { files: files, manual: manual, done: files.length > 0 || manual === 'ok', na: manual === 'na' };
}
function contentStatus(prj, r) {
  var fs = prj.files.filter(function (f) { return f.docs.some(function (d) { return d.rid === r.id; }) && f.kw.length; });
  if (!fs.length) return null;
  var kw = {}; fs.forEach(function (f) { f.kw.forEach(function (k) { kw[lc(k)] = 1; }); });
  return r.content.map(function (c) { return { label: c.label, ok: c.any.some(function (k) { return kw[lc(k)]; }) }; });
}
function evaluate(prj) {
  var p = prj.p, app = applicability(p), nums = numericChecks(prj), res = [];
  REVIEWS.forEach(function (r) {
    var a = app[r.id]; if (a.lvl === 'no') return;
    var docs = r.docs.map(function (d) { var s = docStatus(prj, r.id, d.id); return Object.assign({}, d, { req: docRequired(p, app, r.id, d) }, s); });
    var reqDocs = docs.filter(function (d) { return d.req && !d.na; }), done = reqDocs.filter(function (d) { return d.done; });
    var cs = contentStatus(prj, r), nm = nums.filter(function (x) { return x.rid === r.id; });
    var fails = nm.filter(function (x) { return x.ok === false; }), unknown = nm.filter(function (x) { return x.ok === null; });
    var docRatio = reqDocs.length ? done.length / reqDocs.length : 1;
    var conRatio = cs ? cs.filter(function (c) { return c.ok; }).length / cs.length : null;
    var score = Math.round((docRatio * (conRatio === null ? 0.8 : 0.55) + (conRatio || 0) * 0.25 + (nm.length ? nm.filter(function (x) { return x.ok; }).length / nm.length : 1) * 0.2) * 100);
    var verdict, cls;
    if (a.lvl === 'ask') { verdict = '대상 여부 답변 필요'; cls = 'cond'; }
    else if (fails.length) { verdict = '기준 미달 — 설계 수정'; cls = 'bad'; }
    else if (docRatio === 1 && (conRatio === null || conRatio >= 0.8) && !unknown.length) { verdict = r.id === 'scape' || r.id === 'cmte' ? '심의 상정 가능 (조건부 의결 가능성)' : '접수 가능 수준'; cls = 'good'; }
    else if (score >= 60) { verdict = '보완 후 접수'; cls = 'warn'; }
    else { verdict = '준비 부족'; cls = 'bad'; }
    res.push({ r: r, a: a, docs: docs, reqDocs: reqDocs, done: done, cs: cs, nm: nm, fails: fails, unknown: unknown, score: score, verdict: verdict, cls: cls, conRatio: conRatio });
  });
  return res;
}

/* ---------- 주소 조회 (VWorld) ---------- */
var VW = 'https://api.vworld.kr';
var jsonpN = 0;
function jsonp(url) {
  return new Promise(function (ok, no) {
    var cb = '__vw' + (++jsonpN) + Date.now(), s = document.createElement('script');
    var t = setTimeout(function () { cleanup(); no(new Error('VWorld 응답 없음(시간 초과)')); }, 12000);
    function cleanup() { clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
    window[cb] = function (d) { cleanup(); ok(d); };
    s.onerror = function () { cleanup(); no(new Error('VWorld 호출 실패')); };
    s.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cb; document.head.appendChild(s);
  });
}
function vw(path, params) {
  var key = lsGet(KEYSTORE) || (window.VPC_SETTINGS && VPC_SETTINGS.vworldKey); if (!key) return Promise.reject(new Error('VWorld API 키가 아직 등록되지 않아 주소 자동조회가 꺼져 있습니다. 상단 [관리자] 로그인 → VWorld 키 붙여넣기 → [전체 직원에게 적용]'));
  var doms = VW_DOM ? [VW_DOM] : [location.origin, location.origin + location.pathname.replace(/[^/]*$/, ''), location.origin + '/'];
  var go = function (i) {
    var url = VW + path + '?' + new URLSearchParams(Object.assign({ key: key, domain: doms[i], format: 'json' }, params)).toString();
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(function () { return jsonp(url); }).then(function (j) {
      var e = j && j.response && j.response.status === 'ERROR' && j.response.error;
      if (e && /KEY|DOMAIN/i.test(e.code || '') && i + 1 < doms.length) return go(i + 1);
      if (!e) VW_DOM = doms[i];
      return j;
    });
  };
  return go(0);
}
var VW_DOM = null;
function feats(j) { return j && j.response && j.response.result && j.response.result.featureCollection ? j.response.result.featureCollection.features || [] : []; }
function polyArea(g) { // 경위도(EPSG:4326) 다각형 → 국지 평면 근사 면적(㎡)
  if (!g) return 0; var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  var lat0 = polys.length ? polys[0][0][0][1] * Math.PI / 180 : 0, kx = 111320 * Math.cos(lat0), ky = 110574;
  var ring = function (r) { var a = 0; for (var k = 0; k < r.length - 1; k++) a += (r[k][0] * kx) * (r[k + 1][1] * ky) - (r[k + 1][0] * kx) * (r[k][1] * ky); return Math.abs(a) / 2; };
  return polys.reduce(function (s, pl) { return s + ring(pl[0]) - pl.slice(1).reduce(function (h, r) { return h + ring(r); }, 0); }, 0);
}
var VW_LAYERS = [['LT_C_UQ111', 'zone'], ['LT_C_UQ112', 'zone'], ['LT_C_UQ113', 'zone'], ['LT_C_UQ114', 'zone'], ['LT_C_UQ121', '경관지구'], ['LT_C_UPISUQ161', '지구단위계획구역'], ['LT_C_UD801', '개발제한구역'], ['LT_C_DAMDAN', '산업단지'], ['LT_C_UQ123', '*'], ['LT_C_UQ124', '*'], ['LT_C_UQ125', '*'], ['LT_C_UQ126', '*'], ['LT_C_UQ128', '*'], ['LT_C_UQ129', '*']];
function lookupAddress(addr) {
  var out = { addr: addr, uses: [], errs: [] };
  var vwErr = function (j) { return j && j.response && j.response.status === 'ERROR' ? ((j.response.error && (j.response.error.code + ' ' + (j.response.error.text || ''))) || '오류') : ''; };
  var search = function (cat) { return vw('/req/search', { service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: 5, page: 1, query: addr, type: 'address', category: cat, errorformat: 'json' }); };
  var item = function (j) { if (j && j.response && j.response.status === 'ERROR') throw new Error('VWorld: ' + (j.response.error ? j.response.error.text : '오류')); return j && j.response && j.response.result && j.response.result.items ? j.response.result.items[0] : null; };
  return search('parcel').then(function (j) { var it = item(j); if (it) return it; return search('road').then(item); })
    .then(function (it) {
      if (!it) throw new Error('주소를 찾지 못했습니다');
      out.full = it.address && (it.address.parcel || it.address.road); out.pt = it.point;
      var pt = 'POINT(' + it.point.x + ' ' + it.point.y + ')';
      var parcel = vw('/req/data', { service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN', geomFilter: pt, crs: 'EPSG:4326', size: 1, page: 1, errorformat: 'json' }).then(function (j) {
        var f = feats(j)[0]; if (f) { out.pnu = f.properties.pnu; out.parcel = f.properties.addr; out.area = Math.round(polyArea(f.geometry) * 10) / 10; var jm = String(f.properties.jibun || '').match(/([가-힣]+)\s*$/); if (jm) out.jimok = jm[1]; }
      }).catch(function () {});
      var layers = VW_LAYERS.map(function (L) {
        return vw('/req/data', { service: 'data', request: 'GetFeature', data: L[0], geomFilter: pt, crs: 'EPSG:4326', geometry: 'false', size: 10, page: 1, errorformat: 'json' }).then(function (j) {
          var e = vwErr(j); if (e) { out.errs.push(L[0] + ': ' + e); return; }
          feats(j).forEach(function (f) { var pr = f.properties || {}; if (L[1] === 'zone' && !pr.uname) return; if (L[1] === '*') { var own = pr.uname || pr.dgm_nm || Object.keys(pr).map(function (k) { return pr[k]; }).filter(function (v) { return typeof v === 'string' && /(지구|구역)$/.test(v); })[0]; if (own && !out.uses.some(function (u) { return u.name === own; })) out.uses.push({ name: own, rel: '포함' }); if (own && /고도지구/.test(own)) out.hd = (pr.dyear || '') + '-' + (pr.dnum || ''); return; } var nm = pr.uname || pr.dgm_nm || pr.dan_name || Object.keys(pr).map(function (k) { return pr[k]; }).filter(function (v) { return typeof v === 'string' && /단지$/.test(v); })[0] || L[1]; out.uses.push({ name: L[1] === 'zone' ? nm : L[1] + (nm && nm !== L[1] ? ' (' + nm + ')' : ''), rel: '포함' }); if (L[1] === 'zone') out.zone1 = nm; });
        }).catch(function (e) { out.errs.push(L[0] + ': ' + e.message); });
      });
      return Promise.all([parcel].concat(layers));
    }).then(function () { return out.pnu ? eumFetch(out.pnu).then(function (e) { out.eum = e; }, function (e) { out.errs.push('토지이음: ' + e.message); }) : null; }).then(function () { window.VPC_LASTERR = out.errs; return out; });
}
var READY_J = ['대', '공장용지', '창고용지', '주차장', '주유소용지', '학교용지', '종교용지'];
function parcelZone(o) { var ns = (o.uses || []).map(function (u) { return nospace(u.name); }).concat(o.eum ? o.eum.marks.map(nospace) : []); return Object.keys(ZONES).filter(function (k) { return ns.indexOf(k) >= 0; })[0] || nospace(o.zone1 || ''); }
function parcelArea(o) { return (o.eum && o.eum.area) || o.area || 0; }
function combineParcels(list) {
  if (list.length === 1) { var one = Object.assign({}, list[0]); one.zoneMix = null; return one; }
  var seen = {}, uses = [], marks = [], zm = {}, errs = [];
  list.forEach(function (o) {
    (o.uses || []).forEach(function (u) { if (!seen['u' + u.name]) { seen['u' + u.name] = 1; uses.push(u); } });
    (o.eum ? o.eum.marks : []).forEach(function (m) { if (!seen['m' + m]) { seen['m' + m] = 1; marks.push(m); } });
    var z = parcelZone(o); if (z) zm[z] = (zm[z] || 0) + parcelArea(o); errs = errs.concat(o.errs || []);
  });
  var ej = list.map(function (o) { return o.eum && o.eum.jimok; }).filter(Boolean), worst = ej.filter(function (j) { return READY_J.indexOf(j) < 0; })[0] || ej[0];
  var big = list.slice().sort(function (a, b) { return parcelArea(b) - parcelArea(a); })[0];
  return { addr: list[0].addr, full: (list[0].full || list[0].addr) + ' 외 ' + (list.length - 1) + '필지', pnu: list.map(function (o) { return o.pnu || ''; }).join(','), uses: uses, zone1: big.zone1, area: list.reduce(function (a, o) { return a + (o.area || 0); }, 0), jimok: list[0].jimok, errs: errs, hd: list.map(function (o) { return o.hd; }).filter(Boolean)[0],
    eum: list.some(function (o) { return o.eum; }) ? { jimok: worst || '', area: Math.round(list.reduce(function (a, o) { return a + parcelArea(o); }, 0) * 10) / 10, price: '', m1: [], m2: [], m3: '', marks: marks } : null, zoneMix: zm, multi: list.length };
}
function slimParcel(o) { return { addr: o.addr, full: o.full, pnu: o.pnu, area: o.area, jimok: o.jimok, uses: o.uses, zone1: o.zone1, hd: o.hd, errs: [], eum: o.eum ? { jimok: o.eum.jimok, area: o.eum.area, marks: o.eum.marks, m1: [], m2: [], m3: '', price: '' } : null }; }
function applyParcels() { var p = cur().p; return applyLookup(combineParcels(p.parcels)); }
function addParcel(a) {
  var p = cur().p; if (!p.parcels || !p.parcels.length) return runLookup(a);
  $('#addrMsg').textContent = '추가 대지 조회 중…';
  return lookupAddress(a).then(function (o) {
    if (p.parcels.some(function (x) { return x.pnu && x.pnu === o.pnu; })) { toast('이미 추가된 필지입니다'); $('#addrMsg').textContent = ''; return; }
    p.parcels.push(slimParcel(o)); var notes = applyParcels();
    $('#addrMsg').innerHTML = esc('대지 ' + p.parcels.length + '필지 합산 반영: ' + notes.join(' · '));
  }).catch(function (err) { $('#addrMsg').innerHTML = esc('추가 실패: ' + err.message) + EUM; });
}
function removeParcel(i) {
  var p = cur().p; p.parcels.splice(i, 1);
  if (!p.parcels.length) { p.pnu = ''; save(); renderAll(); return; }
  p.siteAreaAuto = true; var notes = applyParcels(); $('#addrMsg').innerHTML = esc('필지 삭제 후 재계산: ' + notes.join(' · '));
}
var LOCK_LABEL = { hLimit: '최고높이 제한', hLimitSrc: '제한 근거', aslLimit: '해발 고도제한', heightDistrict: '고도지구', flightZone: '비행안전구역' };
function applyLocks() {
  var p = cur().p, L = p.locks || {}, O = p.lockOrig || {};
  if (!document.getElementById('lockCss')) { var st = document.createElement('style'); st.id = 'lockCss'; st.textContent = '.locked{background:var(--surface2)!important;color:var(--ink)!important;border-style:dashed!important;cursor:not-allowed}.lockbtn{align-self:flex-start;font-size:11.5px;padding:2px 8px;margin-top:2px;border-radius:99px;background:var(--good-bg);color:var(--good);border:1px solid transparent;cursor:pointer}.lockbtn.mod{background:var(--warn-bg);color:var(--warn)}'; document.head.appendChild(st); }
  Array.prototype.forEach.call(document.querySelectorAll('.panel[data-tab="info"] [data-f]'), function (el) {
    var k = el.dataset.f, isCk = el.type === 'checkbox', wrap = el.closest('label') || el.parentNode, olds = wrap.querySelectorAll('.lockbtn[data-lk="' + k + '"]'); Array.prototype.forEach.call(olds, function (o) { o.remove(); });
    var locked = !!L[k];
    if (isCk || el.tagName === 'SELECT') el.disabled = locked; else el.readOnly = locked;
    el.classList.toggle('locked', locked);
    var b = null;
    if (locked) { b = document.createElement('button'); b.type = 'button'; b.className = 'lockbtn'; b.dataset.unlock = k; b.textContent = '법규값 잠김 · 수정'; b.title = '주소 조회로 가져온 법적 지정값입니다. 수정하려면 클릭'; }
    else if (O[k] != null && String(O[k]) !== String(p[k])) { b = document.createElement('button'); b.type = 'button'; b.className = 'lockbtn mod'; b.dataset.relock = k; b.textContent = '수정됨 (법규값 ' + (O[k] === true ? '해당' : O[k] === false ? '아님' : O[k]) + ') · 되돌리기'; }
    else if (O[k] != null) { b = document.createElement('button'); b.type = 'button'; b.className = 'lockbtn mod'; b.dataset.relock = k; b.textContent = '다시 잠그기'; }
    if (b) { b.dataset.lk = k; if (isCk) b.style.marginLeft = '6px'; wrap.appendChild(b); }
  });
}
var EUM_URL = function (pnu) { return 'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=' + encodeURIComponent(pnu) + '&mode=search&isNoScr=script&selGbn=umd'; };
function eumFetch(pnu) {
  return fetch(EUM_URL(pnu)).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(function (buf) {
    var html; try { html = new TextDecoder('euc-kr').decode(buf); } catch (e) { html = new TextDecoder().decode(buf); }
    if (html.indexOf('present_mark1') < 0) { var u = new TextDecoder().decode(buf); if (u.indexOf('present_mark1') >= 0) html = u; }
    var d = new DOMParser().parseFromString(html, 'text/html'), tx = function (id) { var e = d.getElementById(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
    var items = function (id) { var e = d.getElementById(id); return e ? Array.prototype.slice.call(e.children).filter(function (c) { return c.tagName === 'A'; }).map(function (a) { return a.textContent.replace(/\s+/g, ' ').trim(); }).filter(Boolean) : []; };
    var m1 = items('present_mark1'), m2 = items('present_mark2');
    if (!m1.length && !tx('present_area')) throw new Error('필지 정보를 읽지 못함');
    var pm = d.body.textContent.replace(/\s+/g, ' ').match(/([\d,]+원\s*\(\d{4}\/\d{2}\))/), price = pm ? pm[1] : '';
    return { jimok: (tx('present_class').split(' ')[0] || ''), area: num(tx('present_area').replace(/[^\d.]/g, '')), price: price, m1: m1, m2: m2, m3: tx('present_mark3'), marks: m1.concat(m2) };
  });
}
function applyLookup(o) {
  var p = cur().p, E = o.eum, names = (o.uses || []).map(function (u) { return nospace(u.name); }).concat(E ? E.marks.map(nospace) : []), notes = [];
  if ((p.pnu || '') !== (o.pnu || '')) { p.aslLimit = ''; p.aslSrc = ''; p.heightDistrict = false; p.heritageZone = false; p.flightZone = false; p.keyLandscapeArea = false; p.growthPlan = false; p.mountain = '없음'; p.devCmteEx = ''; p.hLimit = ''; p.hLimitSrc = ''; p.hLimitNote = ''; p.hdKey = ''; p.siteAreaAuto = true; }
  p.address = o.full || o.addr; p.pnu = o.pnu || ''; p.landUses = E && E.marks.length ? E.marks.slice() : (o.uses || []).map(function (u) { return u.name + (u.rel ? '(' + u.rel + ')' : ''); });
  if (E) { p.eumPrice = E.price; p.eumMark3 = E.m3; }
  var z = Object.keys(ZONES).filter(function (k) { return names.indexOf(k) >= 0; })[0] || Object.keys(ZONES).filter(function (k) { return nospace(o.zone1) === k; })[0];
  if (z) { p.zone = z; notes.push('용도지역: ' + z); } else notes.push('용도지역 미검출' + (o.errs && o.errs.length ? ' (' + o.errs[0] + ')' : (o.zone1 ? ' (' + o.zone1 + ' — 목록에 없음)' : ' (해당 좌표에 용도지역 도형 없음)')) + ' → 아래에서 직접 선택');
  if (o.zoneMix && Object.keys(o.zoneMix).length > 1) { var zs = Object.keys(o.zoneMix).sort(function (a, b) { return o.zoneMix[b] - o.zoneMix[a]; }); if (ZONES[zs[0]]) p.zone = zs[0]; p.zoneMix = zs.map(function (k) { return { zone: k, area: Math.round(o.zoneMix[k] * 10) / 10 }; }); notes.push('용도지역 혼재: ' + zs.map(function (k) { return k + ' ' + fmt(o.zoneMix[k]) + '㎡'; }).join(' + ') + ' → 건폐율·용적률 가중평균, 그 밖의 건축제한은 가장 넓은 ' + zs[0] + ' 기준 (국토계획법 제84조)'); }
  else p.zoneMix = [];
  p.landscapeDistrict = names.some(function (n) { return /경관지구/.test(n); });
  p.districtPlan = names.some(function (n) { return /지구단위계획구역/.test(n); });
  p.greenbelt = names.some(function (n) { return /개발제한구역/.test(n); });
  p.industrialComplex = names.some(function (n) { return /산업단지|농공단지/.test(n); });
  var JM = { '대': '대', '장': '공장용지', '창': '창고용지', '잡': '잡종지', '전': '전', '답': '답', '과': '과수원', '임': '임야', '목': '목장용지', '차': '주차장', '주': '주유소용지', '학': '학교용지', '종': '종교용지' };
  var FULLJ = ['대', '공장용지', '창고용지', '잡종지', '전', '답', '과수원', '임야', '목장용지', '주차장', '주유소용지', '학교용지', '종교용지'];
  if (E && E.jimok) { p.landCat = FULLJ.indexOf(E.jimok) >= 0 ? E.jimok : '기타'; notes.push('지목: ' + E.jimok + (p.landCat === '기타' ? '(기타)' : '')); }
  else if (o.jimok) { p.landCat = JM[o.jimok] || '기타'; notes.push('지목: ' + p.landCat); }
  if (names.some(function (n) { return /중점경관관리구역/.test(n); })) { p.keyLandscapeArea = true; notes.push('중점경관관리구역'); }
  if (names.some(function (n) { return /성장관리계획구역/.test(n); })) p.growthPlan = true;
  var mt = names.filter(function (n) { return /공익용산지|임업용산지|보전산지|준보전산지/.test(n); });
  if (mt.length) p.mountain = mt.some(function (n) { return /공익용/.test(n); }) ? '공익용산지' : '그 외 산지';
  if (names.some(function (n) { return /대공방어협조구역|비행안전구역|비행장|공항|장애물제한표면/.test(n); })) { p.flightZone = true; var fz = (E ? E.marks : []).filter(function (n) { return /대공방어|비행안전|비행장|공항|장애물/.test(n); }); notes.push((fz[0] || '비행안전구역') + ' → 군·공항 협의 대상 (괄호 안 수치는 해발 표고 기준)'); }
  if (names.some(function (n) { return /건축허가·?착공제한/.test(n); })) notes.push('⚠ 건축허가·착공제한지역 — 제한 기간·내용 먼저 확인');
  if (p.districtPlan) notes.push('지구단위계획구역 포함 → 건폐율·용적률·용도는 해당 지구단위계획 결정도서가 우선');
  if (p.industrialComplex) notes.push('산업단지 내 필지');
  p.heightDistrict = names.some(function (n) { return /고도지구/.test(n); });
  p.hdKey = p.heightDistrict && o.hd ? o.hd : '';
  if (names.some(function (n) { return /국가유산|문화재|역사문화환경/.test(n); })) p.heritageZone = true;
  if (names.some(function (n) { return /비행안전|비행장|공항/.test(n); })) p.flightZone = true;
  var exz = names.filter(function (n) { return /자연취락지구|개발진흥지구|기반시설부담구역|준산업단지|공장입지유도지구/.test(n); });
  if (exz.length) { p.devCmteEx = '예'; notes.push(exz[0] + ' → 개발행위 도시계획위원회 심의 예외 해당'); }
  if (E && E.area && (!p.siteArea || p.siteAreaAuto !== false)) { p.siteArea = String(E.area); p.siteAreaAuto = true; notes.push('대지면적(토지대장' + (o.multi ? ', ' + o.multi + '필지 합산' : '') + '): ' + fmt(E.area) + '㎡'); }
  else if (o.area && (!p.siteArea || p.siteAreaAuto !== false)) { p.siteArea = String(o.area); p.siteAreaAuto = true; notes.push('대지면적(지적도 도형 계산, 공부면적과 소폭 차이 가능): ' + fmt(num(o.area)) + '㎡'); }
  if (E && E.price) notes.push('공시지가 ' + E.price);
  var best = matchRegion(p.address); if (best) { p.region = best; notes.push('지자체: ' + best); }
  var hdName = (E ? E.marks : []).filter(function (n) { return /고도지구/.test(n); }).sort(function (a, b) { var x = a.match(/(\d+(?:\.\d+)?)\s*m/), y = b.match(/(\d+(?:\.\d+)?)\s*m/); return (x ? +x[1] : 1e9) - (y ? +y[1] : 1e9); })[0] || '', hm = hdName.match(/(\d+(?:\.\d+)?)\s*m\s*이하/), hx = hdName.match(/완화[^\d]*(\d+(?:\.\d+)?)\s*m/);
  if (hdName) p.heightDistrict = true;
  if (hm) { p.hLimit = hm[1]; p.hLimitSrc = '고도지구'; p.hLimitNote = hx ? '경관 가이드라인 등 완화 시 ' + hx[1] + 'm' : ''; notes.push(hdName + ' → 최고높이 ' + hm[1] + 'm 자동 입력' + (hx ? ' (완화 시 ' + hx[1] + 'm)' : '')); }
  var aslM = (E ? E.marks : []).map(function (n) { var m = n.match(/해발\s*(\d+(?:\.\d+)?)\s*m/); return m ? { v: +m[1], n: n } : null; }).filter(Boolean).sort(function (a, b) { return a.v - b.v; })[0];
  if (aslM) { p.aslLimit = String(aslM.v); p.aslSrc = aslM.n.replace(/<[^>]*>/g, ''); notes.push('비행·대공 고도제한 해발 ' + aslM.v + 'm 자동 입력 (지반고+건물+옥탑 합계 기준)'); }
  var dpNames = (E ? E.marks : []).filter(function (n) { return /지구단위계획/.test(n); });
  if (!hm && dpNames.length) notes.push(dpNames.join(', ') + ' → 최고높이는 지구단위계획 결정도서(구역별 높이계획)에만 있고 공개 데이터에 수치가 없음' + (/문의/.test(dpNames.join()) ? ' — 토지이음 표기대로 해당 구청 도시계획과 확인' : '') + '. 확인한 값은 "최고높이 제한" 칸에 입력');
  else if (!hm && !p.heightDistrict && E) notes.push('높이: 고도지구·지구단위계획 등 높이 제한 지역 아님 (토지이음 기준)' + (/전용주거|일반주거/.test(p.zone) ? ' — 정북 일조 이격만 검토' : ''));
  if (hm) {} else if (p.heightDistrict) { var hv = autoHeight(p); if (hv) { p.hLimit = String(hv.h); p.hLimitSrc = '고도지구'; notes.push('고도지구 최고높이 ' + hv.h + 'm 자동 입력 (' + hv.src + ')'); } else notes.push('고도지구' + (p.hdKey ? '(고시 ' + p.hdKey + ')' : '') + ' 높이는 공개 데이터에 없음 → 토지이음 열람 후 관리자 화면 "고도지구 최고높이"에 한 번 등록하면 같은 고도지구는 이후 자동 입력'); }
  var LK = {}; if (hm || (typeof hv !== 'undefined' && hv)) { LK.hLimit = 1; LK.hLimitSrc = 1; } if (aslM) LK.aslLimit = 1; if (p.heightDistrict) LK.heightDistrict = 1; if (p.flightZone) LK.flightZone = 1;
  p.locks = {}; p.lockOrig = {}; Object.keys(LK).forEach(function (k) { p.locks[k] = true; p.lockOrig[k] = p[k]; });
  if (Object.keys(LK).length) notes.push('법규 높이값 잠금 (수정하려면 칸 옆 [수정] 클릭)');
  if (o.full) notes.unshift('대지: ' + o.full);
  save(); ensureDetail(p); renderAll();
  return notes;
}
var SIDO_FULL = { '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시', '광주': '광주광역시', '대전': '대전광역시', '울산': '울산광역시', '세종': '세종특별자치시', '세종시': '세종특별자치시', '경기': '경기도', '강원': '강원특별자치도', '충북': '충청북도', '충남': '충청남도', '전북': '전북특별자치도', '전남': '전라남도', '경북': '경상북도', '경남': '경상남도', '제주': '제주특별자치도' };
function autoHeight(p) {
  var o = window.VPC_SETTINGS && VPC_SETTINGS.overrides ? VPC_SETTINGS.overrides[p.region] : null, H = o && o.heights;
  if (!H) return null;
  if (p.hdKey && H[p.hdKey] != null) return { h: H[p.hdKey], src: '관리자 등록값 · 고시 ' + p.hdKey };
  if (H['*'] != null) return { h: H['*'], src: '관리자 등록값 · ' + p.region + ' 대표값' };
  return null;
}
function fullAddr(a) { a = String(a || '').trim(); var m = /^(\S+)\s/.exec(a); return m && SIDO_FULL[m[1]] ? SIDO_FULL[m[1]] + a.slice(m[1].length) : a; }
function matchRegion(addr) {
  var a = nospace(fullAddr(addr)).replace(/^강원도/, '강원특별자치도').replace(/^전라북도/, '전북특별자치도').replace(/^(전라남도|광주광역시)/, '전남광주통합특별시');
  if (!D.regions) return '';
  var best = '', keys = Object.keys(D.regions.regions);
  keys.forEach(function (k) { var kk = nospace(k); if (a.indexOf(kk) === 0 && kk.length > best.length) best = k; });
  if (!best) keys.forEach(function (k) { var R = D.regions.regions[k]; if (R.sgg && a.indexOf(nospace(R.sgg)) >= 0 && a.indexOf(nospace(R.sido)) === 0 && k.length > best.length) best = k; });
  return best;
}
var EUM = ' <a href="https://www.eum.go.kr/web/am/amMain.jsp" target="_blank" rel="noopener">토지이음에서 용도지역 확인</a>';
function hasVwKey() { return !!(lsGet(KEYSTORE) || (window.VPC_SETTINGS && VPC_SETTINGS.vworldKey)); }
function runLookup(a, alt) {
  $('#addrMsg').textContent = '조회 중…';
  return lookupAddress(a).catch(function (e) { if (alt && !/키/.test(e.message)) return lookupAddress(alt); throw e; })
    .then(function (o) { cur().p.parcels = [slimParcel(o)]; var notes = applyLookup(o); $('#addrMsg').innerHTML = esc('반영: ' + notes.join(' · ')) + (/미검출/.test(notes.join()) ? EUM : ''); })
    .catch(function (err) {
      var p = cur().p, r = matchRegion(a), extra = '';
      if (r) { p.address = fullAddr(a); p.region = r; save(); ensureDetail(p); renderAll(); extra = ' (지자체 ' + r + '는 주소로 반영함)'; }
      $('#addrMsg').innerHTML = esc(err.message + extra + ' — 용도지역은 아래에서 직접 선택하세요.') + EUM;
    });
}
function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('주소검색 서비스를 불러오지 못했습니다(인터넷 연결 확인)')); }; document.head.appendChild(s); }); }
var PC_MODE = 'set';
function openPostcode(mode) {
  PC_MODE = mode === 'add' ? 'add' : 'set';
  var ready = window.daum && daum.Postcode ? Promise.resolve() : loadScript('https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js');
  ready.then(function () {
    var ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
    var box = document.createElement('div'); box.style.cssText = 'background:#fff;color:#222;width:min(540px,100%);height:min(600px,90vh);border-radius:10px;overflow:hidden;display:flex;flex-direction:column';
    var hd = document.createElement('div'); hd.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #ddd;font-weight:600';
    hd.innerHTML = '<span>' + (PC_MODE === 'add' ? '추가할 대지 검색 · 골라 클릭' : '주소 검색 · 대지를 골라 클릭') + '</span>';
    var x = document.createElement('button'); x.type = 'button'; x.textContent = '닫기'; x.style.cssText = 'background:#f3f3f3;color:#222'; x.onclick = function () { ov.remove(); }; hd.appendChild(x);
    var body = document.createElement('div'); body.style.cssText = 'flex:1;min-height:0';
    box.appendChild(hd); box.appendChild(body); ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    new daum.Postcode({ width: '100%', height: '100%', oncomplete: function (d) { ov.remove(); pickAddress(d); } }).embed(body, { q: PC_MODE === 'add' ? '' : $('#addrIn').value.trim(), autoClose: false });
  }).catch(function (e) { toast(e.message); });
}
function pickAddress(d) {
  var jibun = fullAddr(d.jibunAddress || d.autoJibunAddress || ''), road = fullAddr(d.roadAddress || d.autoRoadAddress || '');
  var a = jibun || road;
  if (PC_MODE === 'add' && hasVwKey()) return addParcel(a);
  $('#addrIn').value = a;
  if (hasVwKey()) return runLookup(a, road && road !== a ? road : '');
  var p = cur().p, r = matchRegion(a); p.address = a; if (r) p.region = r; save(); ensureDetail(p); renderAll();
  $('#addrMsg').innerHTML = esc('반영: 대지 ' + a + (r ? ' · 지자체: ' + r : ' · 지자체 자동매칭 실패(직접 선택)') + ' · 용도지역은 VWorld 키 등록 전이라 자동조회 불가 → 아래에서 선택') + EUM;
}

/* ---------- 렌더링 ---------- */
var LVL = { req: ['대상', 'req'], ask: ['답변 필요', 'cond'], no: ['비대상', 'no'] };
function opt(v, sel, label) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label == null ? v : label) + '</option>'; }
function renderRegionSel() {
  var p = cur().p, R = D.regions;
  if (!R) { $('#sidoSel').innerHTML = '<option>지자체 데이터 불러오는 중…</option>'; return; }
  var sidos = {}; Object.keys(R.regions).forEach(function (k) { sidos[R.regions[k].sido] = 1; });
  var curR = regionOf(p), sido = curR ? curR.sido : ($('#sidoSel').value || '');
  $('#sidoSel').innerHTML = opt('', sido, '시·도 선택') + Object.keys(sidos).sort().map(function (s) { return opt(s, sido); }).join('');
  var list = Object.keys(R.regions).filter(function (k) { return R.regions[k].sido === sido; }).sort();
  $('#sggSel').innerHTML = opt('', p.region, '시·군·구 선택') + list.map(function (k) { return opt(k, p.region, R.regions[k].sgg); }).join('');
  var hint = '';
  if (curR) {
    var L = limits(p);
    hint = '적용: 건폐율 ' + L.bcr + '% · 용적률 ' + L.far + '% (' + L.bcrSrc + ') · 주차 ' + p.use + ' ' + L.parkUnit + '㎡당 1대 · 조경 ' + (curR.scapeTiers.length ? curR.scapeTiers.map(function (t) { return (t.min ? fmt(t.min, 0) + '㎡↑ ' : '') + t.rate + '%'; }).join(' / ') : '조례 확인');
  }
  $('#regionHint').textContent = hint;
}
function bindForm() {
  var p = cur().p;
  setTimeout(applyLocks, 0);
  $$('[data-f]').forEach(function (el) { var k = el.dataset.f; if (el.type === 'checkbox') el.checked = !!p[k]; else el.value = p[k] == null ? '' : p[k]; });
  $$('[data-bf]').forEach(function (el) { el.value = p.bf && p.bf[el.dataset.bf] != null ? p.bf[el.dataset.bf] : ''; });
  $('#nbWrap').hidden = !/근린생활/.test(p.use); $('#roomWrap').hidden = p.use !== '숙박시설'; $('#empWrap').hidden = p.use !== '공장';
  var pl = p.parcels || [], plH = pl.length > 1 ? '<div class="parcels"><b>대지 ' + pl.length + '필지 (합계 ' + fmt(pl.reduce(function (a, o) { return a + parcelArea(o); }, 0)) + '㎡)</b><ol>' + pl.map(function (o, i) { return '<li>' + esc(o.full || o.addr) + ' — ' + fmt(parcelArea(o)) + '㎡ · ' + esc(parcelZone(o) || '용도지역 미확인') + (o.eum && o.eum.jimok ? ' · ' + esc(o.eum.jimok) : '') + ' <a target="_blank" rel="noopener" href="' + EUM_URL(o.pnu) + '">토지이음</a> <button type="button" class="ghost" data-rmparcel="' + i + '" aria-label="필지 삭제">삭제</button></li>'; }).join('') + '</ol></div>' : '';
  $('#landUses').innerHTML = plH + (p.landUses && p.landUses.length ? '<b>토지이용계획</b> ' + p.landUses.map(function (u) { return '<span class="chip">' + esc(u) + '</span>'; }).join(' ') + (p.pnu && pl.length < 2 ? ' <small>PNU ' + esc(p.pnu) + '</small> <a target="_blank" rel="noopener" href="https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=' + encodeURIComponent(p.pnu) + '&mode=search&isNoScr=script&selGbn=umd">토지이음에서 이 필지 열람 (층수·높이제한 포함)</a>' : '') : '');
  renderRegionSel();
}
function askControl(q) {
  if (q.scapeKey) return '<div class="ask"><p>' + esc(q.label) + '</p><button data-sa="' + q.scapeKey + '" data-v="y">예</button> <button data-sa="' + q.scapeKey + '" data-v="n">아니오</button></div>';
  if (q.field === 'region') return '<div class="ask"><p>' + esc(q.label) + '</p></div>';
  if (q.check) return '<div class="ask"><label class="ck"><input type="checkbox" data-f="' + q.field + '"> ' + esc(q.label) + '</label></div>';
  if (q.options) return '<div class="ask"><p>' + esc(q.label) + '</p><select data-f="' + q.field + '">' + q.options.map(function (o) { return opt(o, cur().p[q.field], o || '선택'); }).join('') + '</select></div>';
  return '<div class="ask"><p>' + esc(q.label) + '</p><input data-f="' + q.field + '" inputmode="decimal" value="' + esc(cur().p[q.field] || '') + '"></div>';
}
function evidenceHTML(rid) {
  var ids = EVID[rid] || [], parts = [];
  ids.forEach(function (id) { var e = ev(id); if (e && e.text) parts.push('<details><summary>근거 원문: ' + esc(e.law) + ' <small>(시행 ' + esc(e.date || '') + ')</small></summary><p class="raw">' + esc(e.text.slice(0, 2500)) + (e.text.length > 2500 ? '…' : '') + '</p></details>'); });
  var det = regionDetail(cur().p);
  if (det) {
    if (rid === 'scape' && det.scape && det.scape.bldText) parts.push('<details' + (rid === 'scape' ? ' open' : '') + '><summary>조례 원문: ' + esc(det.scape.src.name) + ' ' + esc(det.scape.bldArt || '') + ' <small>(시행 ' + esc(det.scape.src.date) + ')</small></summary><p class="raw">' + esc(det.scape.bldText) + '</p></details>');
    if (rid === 'cmte' && det.bld && det.bld.cmteText) parts.push('<details><summary>조례 원문: ' + esc(det.bld.src.name) + ' 심의 관련</summary><p class="raw">' + esc(det.bld.cmteText) + '</p></details>');
  }
  return parts.join('');
}
function renderApp() {
  var p = cur().p, app = applicability(p);
  $('#appList').innerHTML = REVIEWS.map(function (r) {
    var a = app[r.id], L = LVL[a.lvl];
    return '<article class="card app ' + L[1] + '"><header><span class="pill ' + L[1] + '">' + L[0] + (a.label ? ' · ' + esc(a.label) : '') + '</span><h3>' + esc(r.name) + '</h3></header>' +
      '<ul>' + a.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' + (a.asks || []).map(askControl).join('') +
      '<p class="law">' + esc(r.law) + '</p>' + evidenceHTML(r.id) + '</article>';
  }).join('');
  var c = Object.keys(app).map(function (k) { return app[k]; });
  $('#appSum').innerHTML = '대상 <b>' + c.filter(function (x) { return x.lvl === 'req'; }).length + '</b> · 답변 필요 <b>' + c.filter(function (x) { return x.lvl === 'ask'; }).length + '</b> · 비대상 <b>' + c.filter(function (x) { return x.lvl === 'no'; }).length + '</b>';
}
function renderFiles() {
  var prj = cur(), opts = REVIEWS.map(function (r) { return '<optgroup label="' + esc(r.name) + '">' + r.docs.map(function (d) { return '<option value="' + r.id + '|' + d.id + '">' + esc(d.name) + '</option>'; }).join('') + '</optgroup>'; }).join('');
  $('#fileList').innerHTML = prj.files.length ? prj.files.map(function (f) {
    return '<div class="frow" data-id="' + f.id + '"><div class="fmeta"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><small>' + (f.size < 1048576 ? fmt(f.size / 1024, 0) + 'KB' : fmt(f.size / 1048576, 1) + 'MB') + ' · ' + esc(f.status) + (f.epi ? ' · EPI ' + f.epi + '점 인식' : '') + (f.ramps && f.ramps.length ? ' · 경사로 1/' + f.ramps.join(', 1/') : '') + '</small></div>' +
      '<div class="chips">' + (f.docs.map(function (d, i) { var r = REVIEWS.filter(function (x) { return x.id === d.rid; })[0], dd = r && r.docs.filter(function (x) { return x.id === d.did; })[0]; return dd ? '<span class="chip">' + esc(r.name.split(/[·(]/)[0]) + ' › ' + esc(dd.name) + '<button data-rm="' + i + '" aria-label="지정 해제">×</button></span>' : ''; }).join('') || '<span class="chip warn">분류 안 됨 — 직접 지정</span>') +
      '<select class="addDoc" aria-label="서류 지정"><option value="">+ 서류 지정</option>' + opts + '</select><button class="ghost del">삭제</button></div></div>';
  }).join('') : '<p class="empty">아직 올린 파일이 없습니다.</p>';
  renderChecklist();
}
function renderChecklist() {
  var prj = cur(), evl = evaluate(prj);
  $('#checklist').innerHTML = evl.map(function (e) {
    return '<section class="card cl"><header><h3>' + esc(e.r.name) + '</h3><span class="pill ' + LVL[e.a.lvl][1] + '">' + LVL[e.a.lvl][0] + '</span><span class="score ' + e.cls + '">' + e.done.length + '/' + e.reqDocs.length + ' 필수</span></header><table><tbody>' +
      e.docs.map(function (d) { return '<tr class="' + (d.na ? 'na' : d.done ? 'ok' : d.req ? 'miss' : '') + '"><td class="st">' + (d.na ? '–' : d.done ? '✓' : d.req ? '!' : '○') + '</td><td>' + esc(d.name) + (d.req ? ' <span class="reqtag">필수</span>' : ' <span class="opt">해당 시</span>') + (d.files.length ? '<div class="fsrc">' + d.files.map(function (f) { return esc(f.name); }).join(', ') + '</div>' : '') + '</td><td class="man"><select data-man="' + e.r.id + '.' + d.id + '" aria-label="수동 상태">' + opt('', d.manual || '', '자동') + opt('ok', d.manual, '준비됨') + opt('na', d.manual, '해당 없음') + '</select></td></tr>'; }).join('') +
      '</tbody></table>' + (e.cs ? '<div class="content"><h4>본문 내용 확인</h4><ul>' + e.cs.map(function (c) { return '<li class="' + (c.ok ? 'ok' : 'miss') + '">' + (c.ok ? '✓ ' : '✗ ') + esc(c.label) + '</li>'; }).join('') + '</ul></div>' : '<p class="hint">본문을 읽을 수 있는 파일(PDF·HWPX·DOCX)이 없어 내용 검토 생략</p>') + '</section>';
  }).join('');
}
function renderNums() {
  var nums = numericChecks(cur());
  $('#numTable').innerHTML = nums.length ? '<table class="ntab"><thead><tr><th>항목</th><th>계획</th><th>기준</th><th>판정</th></tr></thead><tbody>' + nums.map(function (n) {
    return '<tr><td>' + esc(n.label) + '<div class="sub">' + esc(REVIEWS.filter(function (r) { return r.id === n.rid; })[0].name) + '</div></td><td>' + esc(n.val) + '</td><td>' + esc(n.lim) + (n.note ? '<div class="sub">' + esc(n.note) + '</div>' : '') + '</td><td><span class="pill ' + (n.ok === true ? 'good' : n.ok === false ? 'bad' : 'cond') + '">' + (n.ok === true ? '적합' : n.ok === false ? '미달' : '값 입력') + '</span></td></tr>';
  }).join('') + '</tbody></table>' : '<p class="empty">면적을 입력하면 수치 검토가 표시됩니다.</p>';
}
function renderReport() {
  var prj = cur(), p = prj.p, evl = evaluate(prj), req = evl.filter(function (e) { return e.a.lvl === 'req'; });
  var total = req.length ? Math.round(req.reduce(function (s, e) { return s + e.score; }, 0) / req.length) : 0;
  var fails = [].concat.apply([], evl.map(function (e) { return e.fails; })), asks = evl.filter(function (e) { return e.a.lvl === 'ask'; });
  var overall, oc;
  if (fails.length) { overall = '현재 상태로는 보완 요구 확실 — 기준 미달 항목부터 설계 수정'; oc = 'bad'; }
  else if (asks.length) { overall = '대상 여부 답변이 필요한 항목 ' + asks.length + '건 — ② 대상 판정 탭에서 답변'; oc = 'warn'; }
  else if (evl.every(function (e) { return e.cls === 'good'; })) { overall = '전 항목 접수 가능 수준'; oc = 'good'; }
  else if (total >= 60) { overall = '보완 후 접수 가능'; oc = 'warn'; }
  else { overall = '준비 초기 단계 — 아래 순서대로 준비'; oc = 'bad'; }
  var app = applicability(p), PH = ['① 사전조사', '② 심의·사전협의', '③ 허가 신청', '④ 착공', '⑤ 사용승인'], steps = [], next = [];
  var dn = prj.done || (prj.done = {}), isDone = function (rid) { return !!dn['rv:' + rid]; };
  if (!document.getElementById('doneCss')) { var st = document.createElement('style'); st.id = 'doneCss'; st.textContent = 'tr.done td{opacity:.5}tr.done td.chk{opacity:1}.chk{text-align:center;width:52px}.chk input,.phase li input{width:18px;height:18px;vertical-align:middle;cursor:pointer;accent-color:var(--good)}.phase ul{list-style:none;padding-left:0}.phase li{margin:5px 0}.phase li label{display:flex!important;flex-direction:row!important;align-items:center;gap:6px;margin:0;font-size:14px;color:var(--ink)}.phase li .tag{flex:none;width:auto;display:inline-block}.phase li.done .txt{text-decoration:line-through;opacity:.5}.donebar{font-size:13px;margin:6px 0 0;color:var(--ink2)}'; document.head.appendChild(st); }
  REVIEWS.forEach(function (r) { if (app[r.id].lvl !== 'no') r.prep.forEach(function (s, i) { steps.push({ phase: s.phase, t: s.t, r: r, k: 'st:' + r.id + ':' + i }); }); });
  evl.forEach(function (e) {
    if (isDone(e.r.id)) return;
    (e.a.asks || []).forEach(function (q) { next.push({ pr: 0, t: '[' + e.r.name + '] ' + q.label }); });
    e.fails.forEach(function (f) { next.push({ pr: 1, t: '[' + e.r.name + '] ' + f.label + ' 미달 (' + f.val + ' / ' + f.lim + ') → 설계 수정' }); });
    e.docs.filter(function (d) { return d.req && !d.done && !d.na; }).forEach(function (d) { next.push({ pr: 2 + e.r.phase, t: '[' + e.r.name + '] ' + d.name + ' 준비' }); });
    (e.cs || []).filter(function (c) { return !c.ok; }).forEach(function (c) { next.push({ pr: 3 + e.r.phase, t: '[' + e.r.name + '] 도서에 "' + c.label + '" 내용 누락 의심' }); });
  });
  next.sort(function (a, b) { return a.pr - b.pr; });
  var tgt = evl.filter(function (e) { return e.a.lvl !== 'no'; }), nDone = tgt.filter(function (e) { return isDone(e.r.id); }).length;
  if (tgt.length && nDone === tgt.length) { overall = '대상 항목 ' + tgt.length + '건 모두 완료'; oc = 'good'; }
  var R = regionOf(p);
  $('#report').innerHTML = '<section class="card hero ' + oc + '"><div><small>' + esc(p.address || (R ? p.region : '지자체 미선택')) + ' · ' + esc(p.zone) + ' · ' + esc(p.use) + ' · ' + esc(p.work) + ' · 연면적 ' + fmt(num(p.gfa)) + '㎡</small><h2>' + esc(p.name) + '</h2><p class="overall">' + overall + '</p></div><div class="gauge" style="--v:' + total + '"><b>' + total + '</b><span>준비도</span></div></section>' +
    '<section class="card"><h3>지금 먼저 할 일</h3>' + (next.length ? '<ol class="next">' + next.slice(0, 10).map(function (n) { return '<li>' + esc(n.t) + '</li>'; }).join('') + '</ol>' + (next.length > 10 ? '<p class="hint">외 ' + (next.length - 10) + '건</p>' : '') : '<p>남은 항목 없음</p>') + '</section>' +
    '<section class="card"><h3>항목별 판정</h3><p class="donebar">완료 <b>' + nDone + '</b> / 대상·답변필요 ' + tgt.length + '건 — 끝난 항목은 체크하면 "지금 먼저 할 일"에서 빠집니다</p><table class="ntab"><thead><tr><th>항목</th><th>대상</th><th>필수서류</th><th>내용</th><th>판정</th><th class="chk">완료</th></tr></thead><tbody>' + evl.map(function (e) { var d = isDone(e.r.id), na = e.a.lvl === 'no'; return '<tr' + (d ? ' class="done"' : '') + '><td>' + esc(e.r.name) + '<div class="sub">' + esc(e.r.weeks) + (d ? ' · ' + esc(dn['rv:' + e.r.id]) + ' 완료' : '') + '</div></td><td><span class="pill ' + LVL[e.a.lvl][1] + '">' + LVL[e.a.lvl][0] + '</span></td><td>' + e.done.length + '/' + e.reqDocs.length + '</td><td>' + (e.conRatio === null ? '–' : Math.round(e.conRatio * 100) + '%') + '</td><td><span class="pill ' + (d ? 'good' : e.cls) + '">' + (d ? '완료' : esc(e.verdict)) + '</span></td><td class="chk">' + (na ? '–' : '<input type="checkbox" data-done="rv:' + e.r.id + '"' + (d ? ' checked' : '') + ' aria-label="' + esc(e.r.name) + ' 완료">') + '</td></tr>'; }).join('') + '</tbody></table></section>' +
    '<section class="card"><h3>심의 전 준비 로드맵</h3>' + PH.map(function (ph, i) { var s = steps.filter(function (x) { return x.phase === i; }); return s.length ? '<div class="phase"><h4>' + ph + '</h4><ul>' + s.map(function (x) { var d = !!dn[x.k] || isDone(x.r.id); return '<li' + (d ? ' class="done"' : '') + '><label><input type="checkbox" data-done="' + x.k + '"' + (d ? ' checked' : '') + (isDone(x.r.id) ? ' disabled' : '') + '> <span class="tag">' + esc(x.r.name) + '</span><span class="txt">' + esc(x.t) + '</span></label></li>'; }).join('') + '</ul></div>' : ''; }).join('') + '</section>' +
    '<p class="disc">판정 근거: 국가법령정보센터 원문(법령 ' + esc(D.national ? D.national.updated : '-') + ' 동기화) + ' + esc(R ? p.region + ' 조례' : '지자체 미선택') + '. 심의(경관·건축위원회)는 대상 여부까지 판정하며 의결 결과는 위원 판단입니다.</p>';
}
function renderLocal() {
  var p = cur().p, R = regionOf(p), det = regionDetail(p), box = $('#localBox');
  if (!R) { box.innerHTML = '<p class="empty">① 프로젝트 정보에서 지자체를 선택하거나 주소를 조회하세요.</p>'; return; }
  if (!det) { box.innerHTML = '<p class="empty">조례 원문 불러오는 중…</p>'; return; }
  var sec = function (title, src, body) { return '<details class="card" open><summary><b>' + esc(title) + '</b> ' + (src ? '<small>' + esc(src.name) + ' (시행 ' + esc(src.date) + ')</small>' : '') + '</summary>' + body + '</details>'; };
  var zt = function (o) { return '<table class="ntab"><tbody>' + Object.keys(ZONES).map(function (z) { return '<tr' + (z === p.zone ? ' class="hl"' : '') + '><td>' + z + '</td><td>' + (o[z] != null ? o[z] + '%' : '-') + '</td></tr>'; }).join('') + '</tbody></table>'; };
  var h = '<p class="hint">' + esc(p.region) + ' — 국가법령정보센터 자치법규 원문에서 매주 자동 추출한 값입니다. 자치구는 광역시 조례를 함께 적용합니다.</p>';
  if (det.plan) h += sec('용도지역별 건폐율·용적률', det.plan.src, '<div class="two"><div><h4>건폐율 (' + esc(det.plan.bcrArt || '') + ')</h4>' + zt(det.plan.bcr) + '</div><div><h4>용적률 (' + esc(det.plan.farArt || '') + ')</h4>' + zt(det.plan.far) + '</div></div>');
  if (det.park) h += sec('부설주차장 설치기준', det.park.src, (det.park.parseFail ? '<p class="warn">별표 파일을 해석하지 못해 주차장법 시행령 기준을 적용합니다.' + (det.park.fileUrl ? ' <a target="_blank" rel="noopener" href="' + esc(det.park.fileUrl.replace('http://', 'https://')) + '">별표 원본</a>' : '') + '</p>' : '') + '<table class="ntab"><tbody>' + Object.keys(det.park.units || {}).map(function (u) { var v = det.park.units[u]; return '<tr' + (u === p.use ? ' class="hl"' : '') + '><td>' + esc(u) + '</td><td>' + (v === 'national' ? '시행령 기준' : v + '㎡당 1대') + '</td><td class="sub">' + esc((det.park.raw || {})[u] || '') + '</td></tr>'; }).join('') + '</tbody></table><p class="hint">장애인전용주차: ' + (det.park.disabledPct != null ? det.park.disabledPct + '%' : '조례에서 비율을 찾지 못함 → 4% 적용') + '</p>');
  if (det.bld && det.bld.scapeText) h += sec('대지 안의 조경', det.bld.src, '<p class="raw">' + esc(det.bld.scapeText) + '</p>');
  if (det.scape && det.scape.bldText) h += sec('건축물 경관심의 대상', det.scape.src, '<p class="raw">' + esc(det.scape.bldText) + '</p>');
  if (det.bld && det.bld.cmteText) h += sec('건축위원회 심의', det.bld.src, '<p class="raw">' + esc(det.bld.cmteText) + '</p>');
  box.innerHTML = h;
}
function renderMeta() {
  var m = D.meta, n = D.national, box = $('#metaBox');
  if (!m || !n) { box.innerHTML = '<p class="empty">동기화 데이터 불러오는 중… (최초 동기화 전이면 비어 있습니다)</p>'; return; }
  var h = '<div class="card"><h3>자동 업데이트 현황</h3><p>최종 동기화 <b>' + esc(m.updated) + '</b> · 매주 월요일 06시(KST) GitHub Actions가 국가법령정보센터에서 다시 받아옵니다.</p><p>지자체 ' + m.coverage.regions + '곳 · 건폐율/용적률 ' + m.coverage.plan + ' · 조경 ' + m.coverage.landscapeRule + ' · 경관심의 조항 ' + m.coverage.scapeOrdin + ' · 주차 별표 ' + m.coverage.parking + '</p>' +
    (m.failedChecks && m.failedChecks.length ? '<p class="warn">기준값 자동 검증 불일치 ' + m.failedChecks.length + '건: ' + m.failedChecks.map(function (c) { return esc(c.law) + '(' + c.id + ')'; }).join(', ') + '</p>' : '<p class="okc">핵심 기준값 자동 검증 ' + (n.checks || []).length + '건 모두 일치</p>') + '</div>';
  h += '<div class="card"><h3>추적 중인 법령</h3><table class="ntab"><thead><tr><th>법령</th><th>시행일</th><th>관련 항목</th></tr></thead><tbody>' + Object.keys(n.laws).map(function (k) { var l = n.laws[k]; return '<tr><td>' + esc(k) + '</td><td>' + esc(l.date || '-') + '</td><td class="sub">' + esc((l.reviews || []).map(function (id) { var r = REVIEWS.filter(function (x) { return x.id === id; })[0]; return r ? r.name : id; }).join(', ')) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<div class="card"><h3>최근 변경 감지</h3>' + (m.changes && m.changes.length ? '<ul>' + m.changes.slice(0, 30).map(function (c) { return '<li>' + esc(c.date) + ' · ' + (c.type === 'law' ? esc(c.name) + ' 시행일 ' + esc(c.from) + ' → ' + esc(c.to) : esc(c.name) + ' 조례 개정') + '</li>'; }).join('') + '</ul>' : '<p class="hint">아직 감지된 변경이 없습니다.</p>') + '</div>';
  box.innerHTML = h;
}
function renderProjectSel() { $('#prjSel').innerHTML = state.projects.map(function (x) { return opt(x.id, state.cur, x.p.name); }).join(''); }
function renderAll() { renderProjectSel(); bindForm(); renderApp(); renderFiles(); renderNums(); renderReport(); renderLocal(); renderMeta(); renderLive(); }
function softRender() { renderRegionSel(); renderApp(); renderChecklist(); renderNums(); renderReport(); renderLive(); applyLocks(); }
function renderLive() {
  var box = document.getElementById('liveNums'); if (!box) return;
  var prj = cur(), p = prj.p, L = limits(p), nums = numericChecks(prj), app = applicability(p), site = num(p.siteArea), ks = Object.keys(app);
  var cReq = ks.filter(function (k) { return app[k].lvl === 'req'; }).length, cAsk = ks.filter(function (k) { return app[k].lvl === 'ask'; }).length, cNg = nums.filter(function (n) { return n.ok === false; }).length;
  var h = '<h3>실시간 검토</h3><p class="sub">' + esc(p.region || '지자체 미선택') + ' · ' + esc(p.zone) + ' · ' + esc(p.use) + '</p>';
  var pk = nums.filter(function (n) { return n.label === '부설주차 대수'; })[0], dk = nums.filter(function (n) { return n.label === '장애인전용 주차구획'; })[0];
  h += '<div class="lvmeta" style="grid-template-columns:repeat(2,1fr)"><span>건폐율 한도<b>' + L.bcr + '%</b></span><span>용적률 한도<b>' + L.far + '%</b></span>' +
    '<span>필요 주차<b>' + (pk ? pk.need + '대' : '–') + '</b>' + (pk ? '' : '연면적 입력 시 계산') + '</span>' +
    '<span>장애인 주차<b>' + (!dk ? '–' : dk.need ? dk.need + '대' + (dk.ok === null && !/미입력/.test(dk.val) ? '' : '') : '의무 없음') + '</b>' + (dk && dk.need && /답하면/.test(dk.note || '') ? '대상이면' : '') + '</span></div>';
  if (site > 0) h += '<p class="sub">최대 건축면적 <b>' + fmt(site * L.bcr / 100) + '㎡</b> · 최대 용적률 연면적 <b>' + fmt(site * L.far / 100) + '㎡</b></p>';
  h += cNg ? '<p class="lvalert">기준 미달 ' + cNg + '건</p>' : '';
  h += nums.length ? '<ul class="lvlist">' + nums.map(function (n) { var c = n.ok === true ? 'good' : n.ok === false ? 'bad' : 'cond'; return '<li class="' + c + '"><div class="lvh"><b>' + esc(n.label) + '</b><span class="pill ' + c + '">' + (n.ok === true ? '적합' : n.ok === false ? '미달' : '값 입력') + '</span></div><div class="lvv">' + esc(n.val) + '<span> / ' + esc(n.lim) + '</span></div>' + (n.note && n.ok !== true ? '<div class="sub">' + esc(n.note) + '</div>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="hint">대지면적·건축면적·연면적·높이를 입력하면 건폐율·용적률·주차·조경·높이 제한이 바로 계산됩니다.</p>';
  h += '<p class="lvsum">대상 <b>' + cReq + '</b> · 답변 필요 <b>' + cAsk + '</b> · <a href="#" onclick="document.querySelector(\'.tabs [data-tab=app]\').click();return false">대상 판정 보기</a></p>';
  box.innerHTML = h;
}

function claudePrompt() {
  var prj = cur(), p = prj.p, evl = evaluate(prj), L = limits(p);
  var lines = ['[가상인허가센터 정밀검토 요청] ' + p.name, '주소: ' + (p.address || '-') + ' / 지자체: ' + (p.region || '-') + ' / ' + p.zone + (p.landUses.length ? ' / 지역지구: ' + p.landUses.join(', ') : ''),
    '용도: ' + p.use + ' / ' + p.owner + ' / ' + p.work + ' / 대지 ' + p.siteArea + '㎡, 건축 ' + p.bldgArea + '㎡, 연면적 ' + p.gfa + '㎡, 지상 ' + p.floorsAbove + '층, 높이 ' + p.height + 'm, 경간 ' + p.span + 'm',
    '적용 기준: 건폐율 ' + L.bcr + '%, 용적률 ' + L.far + '%, 주차 ' + L.parkUnit + '㎡당 1대 (' + L.parkSrc + ')', '', '사전 점검 결과:'];
  evl.forEach(function (e) {
    lines.push('- ' + e.r.name + ' (' + LVL[e.a.lvl][0] + '): ' + e.verdict);
    var miss = e.docs.filter(function (d) { return d.req && !d.done && !d.na; }).map(function (d) { return d.name; }); if (miss.length) lines.push('  누락: ' + miss.join(', '));
    e.fails.forEach(function (f) { lines.push('  미달: ' + f.label + ' ' + f.val + ' (기준 ' + f.lim + ')'); });
  });
  lines.push('', '첨부 도서를 읽고 ① 누락·미달이 실제인지 ② 협의부서·심의위원이 지적할 보완사항 ③ 심의 전 준비 순서를 정리해줘.');
  return lines.join('\n');
}

/* ---------- 이벤트 ---------- */
function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('on'); }, 2800); }
document.addEventListener('DOMContentLoaded', function () {
  $('#zoneSel').innerHTML = Object.keys(ZONES).map(function (z) { return opt(z, ''); }).join('');
  $('#useSel').innerHTML = USES.map(function (u) { return opt(u, ''); }).join('');
  $('#nbSel').innerHTML = Object.keys(NB_SUB).map(function (k) { return opt(k, '', k || '세부용도 선택'); }).join('');
  $('#bfInputs').innerHTML = BF_DIM.map(function (d) { return '<label>' + esc(d.label) + '<input data-bf="' + d.key + '" inputmode="decimal"><small>' + esc(d.note) + '</small></label>'; }).join('');
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () {
    $$('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
    $$('.panel').forEach(function (x) { x.hidden = x.dataset.tab !== b.dataset.tab; });
    try { sessionStorage.setItem('vpc2_tab', b.dataset.tab); } catch (e) {}
  }); });
  var t0 = 'info'; try { t0 = sessionStorage.getItem('vpc2_tab') || 'info'; } catch (e) {}
  ($('.tabs button[data-tab="' + t0 + '"]') || $('.tabs button')).click();

  document.addEventListener('input', function (e) {
    var el = e.target, p = cur().p;
    if (el.dataset.f) { p[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.f === 'siteArea') p.siteAreaAuto = false; if (['height', 'eaves', 'span', 'northDist', 'cutFill', 'hLimit'].indexOf(el.dataset.f) >= 0 && num(el.value) > 300) { p[el.dataset.f] = String(Math.round(num(el.value)) / 1000); toast(el.value + ' → ' + p[el.dataset.f] + 'm 로 바꿨습니다 (mm로 입력된 것으로 판단, 이 칸은 m 단위)'); } if (el.dataset.f === 'hLimit') p.hLimitNote = ''; if (el.dataset.f === 'name') renderProjectSel(); if (el.dataset.f === 'use') bindForm(); }
    else if (el.dataset.bf) { p.bf[el.dataset.bf] = el.value; }
    else return;
    if (el.closest('.ask')) { save(); renderAll(); return; }
    save(); softRender();
  });
  document.addEventListener('change', function (e) {
    var el = e.target, prj = cur();
    if (el.id === 'sidoSel') { prj.p.region = ''; renderRegionSel(); var s = el.value; $('#sggSel').innerHTML = opt('', '', '시·군·구 선택') + Object.keys(D.regions.regions).filter(function (k) { return D.regions.regions[k].sido === s; }).sort().map(function (k) { return opt(k, '', D.regions.regions[k].sgg); }).join(''); $('#sidoSel').value = s; return; }
    if (el.id === 'sggSel') { prj.p.region = el.value; save(); ensureDetail(prj.p); renderAll(); return; }
    if (el.dataset.done) { prj.done = prj.done || {}; if (el.checked) prj.done[el.dataset.done] = new Date().toISOString().slice(0, 10); else delete prj.done[el.dataset.done]; save(); renderReport(); return; }
    if (el.dataset.man) { if (el.value) prj.manual[el.dataset.man] = el.value; else delete prj.manual[el.dataset.man]; save(); renderChecklist(); renderReport(); }
    if (el.classList.contains('addDoc') && el.value) { var f = prj.files.filter(function (x) { return x.id === el.closest('.frow').dataset.id; })[0], v = el.value.split('|'); if (!f.docs.some(function (d) { return d.rid === v[0] && d.did === v[1]; })) f.docs.push({ rid: v[0], did: v[1] }); save(); renderFiles(); renderReport(); }
    if (el.dataset.f && el.closest('.ask')) { save(); renderAll(); }
  });
  document.addEventListener('click', function (e) {
    var rp = e.target.closest('[data-rmparcel]'); if (rp) { removeParcel(+rp.dataset.rmparcel); return; }
    var ul = e.target.closest('[data-unlock]'); if (ul) { e.preventDefault(); var pu = cur().p; delete pu.locks[ul.dataset.unlock]; save(); applyLocks(); var fe = document.querySelector('.panel[data-tab="info"] [data-f="' + ul.dataset.unlock + '"]'); if (fe) fe.focus(); toast((LOCK_LABEL[ul.dataset.unlock] || '값') + ' 잠금 해제 — 법규값과 다르게 바꾸면 "수정됨"으로 표시됩니다'); return; }
    var rl = e.target.closest('[data-relock]'); if (rl) { e.preventDefault(); var pr2 = cur().p, k2 = rl.dataset.relock; pr2[k2] = pr2.lockOrig[k2]; pr2.locks[k2] = true; save(); renderAll(); toast((LOCK_LABEL[k2] || '값') + ' 법규값으로 되돌리고 잠금'); return; }
    var b = e.target.closest('[data-sa]'); if (b) { cur().p.scapeAns[b.dataset.sa] = b.dataset.v; save(); renderAll(); }
  });
  $('#fileList').addEventListener('click', function (e) {
    var row = e.target.closest('.frow'); if (!row) return; var prj = cur(), f = prj.files.filter(function (x) { return x.id === row.dataset.id; })[0];
    if (e.target.dataset.rm !== undefined) f.docs.splice(+e.target.dataset.rm, 1);
    else if (e.target.classList.contains('del')) { prj.files = prj.files.filter(function (x) { return x !== f; }); delete fileText[f.id]; }
    else return;
    save(); renderFiles(); renderNums(); renderReport();
  });
  var dz = $('#drop'), fi = $('#fileIn');
  dz.addEventListener('click', function () { fi.click(); });
  dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', function () { handleFiles(Array.prototype.slice.call(fi.files)); fi.value = ''; });
  ['dragenter', 'dragover'].forEach(function (n) { dz.addEventListener(n, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { dz.addEventListener(n, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
  dz.addEventListener('drop', function (e) { handleFiles(Array.prototype.slice.call(e.dataTransfer.files)); });

  $('#addrBtn').addEventListener('click', function () {
    var a = $('#addrIn').value.trim(); if (!a) { toast('주소를 입력하세요'); return; }
    $('#addrMsg').textContent = '조회 중…';
    runLookup(a);
  });
  (function () { var b = document.createElement('button'); b.type = 'button'; b.id = 'addrSearch'; b.textContent = '주소 검색'; b.title = '주소를 검색해 대지를 고릅니다'; b.addEventListener('click', function () { openPostcode('set'); }); var ab = $('#addrBtn'); ab.parentNode.insertBefore(b, ab); var b2 = document.createElement('button'); b2.type = 'button'; b2.id = 'addrAdd'; b2.textContent = '＋ 대지 추가'; b2.title = '여러 필지를 합쳐 하나의 대지로 쓸 때'; b2.addEventListener('click', function () { if (!(cur().p.parcels || []).length) { toast('먼저 첫 번째 대지를 조회하세요'); return; } openPostcode('add'); }); ab.parentNode.insertBefore(b2, ab); ab.textContent = '입력 주소로 조회'; ab.className = ''; b.className = 'primary';
    $('#addrIn').placeholder = '[주소 검색]으로 대지를 고르거나, 지번·도로명 주소를 직접 입력'; })();
  $('#addrIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#addrBtn').click(); });

  $('#prjSel').addEventListener('change', function (e) { state.cur = e.target.value; save(); ensureDetail(cur().p); renderAll(); });
  $('#prjNew').addEventListener('click', function () { var n = newProject(); state.projects.push(n); state.cur = n.id; save(); renderAll(); $('.tabs button[data-tab="info"]').click(); });
  $('#prjDup').addEventListener('click', function () { var c = JSON.parse(JSON.stringify(cur())); c.id = uid(); c.p.name += ' (복사)'; state.projects.push(c); state.cur = c.id; save(); renderAll(); toast('복제했습니다'); });
  $('#prjDel').addEventListener('click', function () {
    var b = $('#prjDel');
    if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = '한 번 더 누르면 삭제'; setTimeout(function () { delete b.dataset.arm; b.textContent = '삭제'; }, 3000); return; }
    state.projects = state.projects.filter(function (x) { return x.id !== state.cur; }); if (!state.projects.length) state.projects.push(newProject());
    state.cur = state.projects[0].id; delete b.dataset.arm; b.textContent = '삭제'; save(); renderAll();
  });
  $('#exp').addEventListener('click', function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })); a.download = '가상인허가센터_백업_' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); });
  $('#imp').addEventListener('click', function () { $('#impIn').click(); });
  $('#impIn').addEventListener('change', function (e) {
    e.target.files[0].text().then(function (t) { var s = JSON.parse(t); if (!s.projects) throw 0; s.projects.forEach(function (x) { if (!state.projects.some(function (y) { return y.id === x.id; })) { x.p = Object.assign(JSON.parse(JSON.stringify(DEFAULT_P)), x.p); state.projects.push(x); } }); save(); renderAll(); toast(s.projects.length + '개 프로젝트를 불러왔습니다'); })
      .catch(function () { toast('올바른 백업 파일이 아닙니다'); }); e.target.value = '';
  });
  $('#copyPrompt').addEventListener('click', function () { var t = claudePrompt(); navigator.clipboard.writeText(t).then(function () { toast('복사됨 — Claude에 붙여넣고 도서 PDF를 첨부하세요'); }).catch(function () { $('#promptOut').value = t; $('#promptOut').hidden = false; $('#promptOut').select(); }); });
  $('#printBtn').addEventListener('click', function () { $('.tabs button[data-tab="report"]').click(); setTimeout(function () { window.print(); }, 100); });

  renderAll();
  Promise.all([loadJSON('data/regions.json').catch(function () { return null; }), loadJSON('data/national.json').catch(function () { return null; }), loadJSON('data/meta.json').catch(function () { return null; })]).then(function (a) {
    D.regions = a[0]; D.national = a[1]; D.meta = a[2];
    $('#syncDate').textContent = D.meta ? D.meta.updated : '동기화 전';
    ensureDetail(cur().p); renderAll();
  });
});
function vwProbe(layer, x, y) { return vw('/req/data', { service: 'data', request: 'GetFeature', data: layer, geomFilter: 'POINT(' + x + ' ' + y + ')', crs: 'EPSG:4326', geometry: 'false', size: 5, page: 1, errorformat: 'json' }).then(function (j) { var r = j && j.response || {}; return { layer: layer, status: r.status, err: r.error ? r.error.code + ' ' + (r.error.text || '') : '', n: feats(j).length, props: feats(j).map(function (f) { return f.properties; }) }; }, function (e) { return { layer: layer, fail: e.message }; }); }
window.VPC = { vwProbe: vwProbe, renderAll: renderAll, toast: toast, cur: cur, save: save, regionRaw: function (k) { return D.regions ? D.regions.regions[k] : null; }, applicability: applicability, numericChecks: numericChecks, evaluate: evaluate, state: function () { return state; }, D: D, splitClauses: splitClauses, evalScapeClause: evalScapeClause, landscapeNeed: landscapeNeed, limits: limits, applyLookup: applyLookup };
})();
