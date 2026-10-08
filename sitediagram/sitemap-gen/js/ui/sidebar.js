// 사이드바·상단바·상태바 UI 바인딩
import { uid, POI_KINDS, AREA_KINDS } from '../core/scene.js';
import { roadStroke } from '../render/svg.js';
import { metersPerPixel } from '../core/geo.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const MODE_TEXT = {
  site: '지도를 클릭해 대지 중심을 지정하세요',
  parcel: '지도에서 필지를 클릭하면 선택한 그룹으로 추가됩니다',
  draw: '클릭: 꼭짓점 추가 · 더블클릭: 완료 · 우클릭: 마지막 점 취소',
  poi: '지도를 클릭해 라벨을 추가할 위치를 지정하세요',
};

const CLS_LABEL = { motorway: '고속도로', trunk: '간선', primary: '주요', secondary: '보조', tertiary: '3급', minor: '소로', rail: '철도', water: '하천' };

export function initUI(app) {
  const scene = () => app.scene;
  const logEl = $('#log');
  let activeTab = 'pois';

  // ---------- 섹션 접기 ----------
  $$('.step h2').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));

  // ---------- 상단바 ----------
  $('#projectName').addEventListener('change', (e) => { scene().meta.name = e.target.value.trim() || '대지분석도'; app.commit({ render: false, ui: false }); });
  $('#btnNew').addEventListener('click', () => app.newProject());
  $('#btnSaveProject').addEventListener('click', () => app.saveProject());
  $('#fileLoadProject').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) app.loadProjectFile(f); e.target.value = ''; });
  const dlg = $('#settingsDialog');
  $('#btnSettings').addEventListener('click', () => {
    $('#cfgVworldKey').value = app.config.vworldKey || '';
    $('#cfgVworldDomain').value = (localStorage.getItem('sitediagram.keys.v1') && JSON.parse(localStorage.getItem('sitediagram.keys.v1')).vworldDomain) || '';
    $('#cfgKakaoKey').value = app.config.kakaoJsKey || '';
    $('#cfgIndustrialLayer').value = app.config.vworldIndustrialLayer || '';
    dlg.showModal();
  });
  $('#btnSaveSettings').addEventListener('click', () => {
    app.saveKeys({
      vworldKey: $('#cfgVworldKey').value.trim(),
      vworldDomain: $('#cfgVworldDomain').value.trim(),
      kakaoJsKey: $('#cfgKakaoKey').value.trim(),
      vworldIndustrialLayer: $('#cfgIndustrialLayer').value.trim(),
    });
    log('API 키 저장됨');
  });

  // ---------- ① 대지 ----------
  $('#btnSearch').addEventListener('click', () => app.geocodeAndGo($('#searchQuery').value));
  $('#searchQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') app.geocodeAndGo(e.target.value); });
  $$('.btn.mode').forEach((b) => b.addEventListener('click', () => app.setMode(b.dataset.mode)));
  $('#siteName').addEventListener('input', (e) => { scene().site.name = e.target.value; app.commit({ ui: false }); });
  $('#sitePin').addEventListener('change', (e) => { scene().site.pinVisible = e.target.checked; app.commit({ ui: false }); });
  $('#siteLabelVisible').addEventListener('change', (e) => { scene().site.label.visible = e.target.checked; app.commit({ ui: false }); });
  $('#drawTarget').addEventListener('change', (e) => { app.drawTarget = e.target.value; });
  $$('#parcelGroup .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#parcelGroup .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    app.parcelGroup = b.dataset.group;
  }));

  // ---------- ② 범위 ----------
  $('#btnAddRing').addEventListener('click', () => {
    const r = parseFloat($('#newRingRadius').value);
    if (!(r > 0)) return;
    scene().rings.push({ id: uid('r'), radius: r, label: r >= 1000 ? `${(r / 1000).toFixed(r % 1000 ? 1 : 0)}KM` : `${r}M`, visible: true });
    scene().rings.sort((a, b) => a.radius - b.radius);
    app.commit();
  });
  $('#btnFitRings').addEventListener('click', () => { const m = Math.max(...scene().rings.filter((r) => r.visible !== false).map((r) => r.radius), 200); app.view.fitRadius(m); });
  $('#btnCenterSite').addEventListener('click', () => app.view.centerOnSite());
  $('#aspect').addEventListener('change', (e) => { scene().view.aspect = e.target.value; app.view.applyAspect(); app.commit({ ui: false }); });
  const bindInset = (id, key, parse = (v) => v, outId, fmt) => {
    const el = $(id);
    el.addEventListener('input', (e) => {
      const v = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      scene().inset[key] = v;
      if (outId) $(outId).value = fmt ? fmt(v) : v;
      if (key === 'enabled' || key === 'pos' || key === 'size') app.relocateForInset();
      app.commit({ ui: key === 'enabled' || key === 'pos' || key === 'size' });
    });
  };
  bindInset('#insetEnabled', 'enabled');
  bindInset('#insetMode', 'mode');
  bindInset('#insetPos', 'pos');
  bindInset('#insetSize', 'size', (v) => parseFloat(v) / 100, '#insetSizeOut', (v) => Math.round(v * 100) + '%');
  bindInset('#insetZoom', 'zoom', parseFloat, '#insetZoomOut', (v) => v.toFixed(1));
  bindInset('#insetTitle', 'title');
  bindInset('#insetLegend', 'legend');

  // ---------- ③ 데이터 ----------
  $('#btnLoadAll').addEventListener('click', () => app.loadAll());
  $('#btnLoadRoads').addEventListener('click', () => app.loadRoads());
  $('#btnLoadAreas').addEventListener('click', () => app.loadAreas());
  $('#btnLoadPois').addEventListener('click', () => app.loadPois());
  $('#srcKakao').addEventListener('change', (e) => { scene().sources.useKakao = e.target.checked; app.commit({ render: false, ui: false }); });
  $('#srcOsm').addEventListener('change', (e) => { scene().sources.useOsmPois = e.target.checked; app.commit({ render: false, ui: false }); });
  $('#srcVworldBld').addEventListener('change', (e) => { scene().sources.useVworldBuildings = e.target.checked; app.commit({ render: false, ui: false }); });
  $('#kakaoKeywords').addEventListener('change', (e) => { scene().sources.kakaoKeywords = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); app.commit({ render: false, ui: false }); });
  $('#excludeCategories').addEventListener('change', (e) => { scene().sources.excludeCategories = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); app.commit({ render: false, ui: false }); });
  $('#maxPois').addEventListener('change', (e) => { scene().sources.maxPois = parseInt(e.target.value, 10) || 40; app.commit({ render: false, ui: false }); });
  $('#minRoadLength').addEventListener('change', (e) => { scene().sources.minRoadLength = parseInt(e.target.value, 10) || 0; app.commit({ render: false, ui: false }); });

  // ---------- ④ 레이어 ----------
  $('#btnAutoLabels').addEventListener('click', () => app.autoPlaceLabels());
  $$('#layerTabs .tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; $$('#layerTabs .tab').forEach((x) => x.classList.toggle('active', x === t)); refreshLists(); }));
  $('#layerFilter').addEventListener('input', refreshLists);
  $('#btnShowAll').addEventListener('click', () => { setAllVisible(true); });
  $('#btnHideAll').addEventListener('click', () => { setAllVisible(false); });
  function setAllVisible(v) {
    const list = activeTab === 'pois' ? scene().pois : activeTab === 'roads' ? scene().roads : scene().areas;
    for (const it of list) it.visible = v;
    if (v && activeTab === 'pois') app.placePoiLabels(false);
    app.commit();
  }

  // ---------- ⑤ 스타일 ----------
  const baseSel = $('#baseSource');
  function fillBaseSelect() {
    baseSel.innerHTML = '';
    for (const [id, s] of Object.entries(app.config.tileSources || {})) {
      if (s.overlay) continue;
      const o = document.createElement('option');
      o.value = id;
      const avail = !s.needsKey || !!app.config[s.needsKey];
      o.textContent = s.name + (avail ? '' : ' — 키 필요');
      o.disabled = !avail;
      baseSel.appendChild(o);
    }
    baseSel.value = scene().style.base;
  }
  baseSel.addEventListener('change', (e) => { scene().style.base = e.target.value; app.view.applyBase(); updateAttribution(); app.commit({ ui: false }); });
  $('#hybridLabels').addEventListener('change', (e) => { scene().style.hybridLabels = e.target.checked; app.view.applyBase(); app.commit({ ui: false }); });
  const bindStyle = (id, key, parse = parseFloat, outId, fmt, after) => {
    $(id).addEventListener('input', (e) => {
      const v = parse(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      scene().style[key] = v;
      if (outId) $(outId).value = fmt ? fmt(v) : v;
      if (after) after();
      app.commit({ ui: false });
    });
  };
  const pct = (v) => Math.round(v * 100) + '%';
  bindStyle('#grayscale', 'grayscale', parseFloat, '#grayscaleOut', pct, () => app.view.applyFilter());
  bindStyle('#brightness', 'brightness', parseFloat, '#brightnessOut', pct, () => app.view.applyFilter());
  bindStyle('#contrast', 'contrast', parseFloat, '#contrastOut', pct, () => app.view.applyFilter());
  bindStyle('#fontScale', 'fontScale', parseFloat, '#fontScaleOut', pct);
  bindStyle('#roadWidth', 'roadWidth', parseFloat, '#roadWidthOut', (v) => v);
  bindStyle('#labelMode', 'labelMode', (v) => v);
  bindStyle('#veil', 'veil', (v) => !!v);
  bindStyle('#veilOpacity', 'veilOpacity', parseFloat, '#veilOpacityOut', pct);
  bindStyle('#showRoadLabels', 'showRoadLabels', (v) => !!v);
  bindStyle('#showPoiLabels', 'showPoiLabels', (v) => !!v);
  const colorMap = { colSite: 'siteColor', colExisting: 'existingColor', colExpansion: 'expansionColor', colIndustrial: 'industrialColor', colPark: 'parkColor', colMotorway: 'motorwayColor', colRing: 'ringColor', colWater: 'waterColor' };
  for (const [id, key] of Object.entries(colorMap)) {
    $('#' + id).addEventListener('input', (e) => {
      scene().style[key] = e.target.value.toUpperCase();
      if (key === 'motorwayColor') for (const r of scene().roads) if (r.cls === 'motorway' || r.cls === 'trunk') r.color = e.target.value.toUpperCase();
      app.commit({ ui: false });
    });
  }

  // ---------- ⑥ 내보내기 ----------
  const widthSel = $('#exportWidth');
  $('#btnExportPng').addEventListener('click', () => app.exportPNG(parseInt(widthSel.value, 10), 'png').catch(() => {}));
  $('#btnExportJpg').addEventListener('click', () => app.exportPNG(parseInt(widthSel.value, 10), 'jpeg').catch(() => {}));
  $('#btnExportSvg').addEventListener('click', () => app.exportSVG(parseInt(widthSel.value, 10), $('#svgBackground').checked).catch(() => {}));
  $('#btnExportDxf').addEventListener('click', () => app.exportDXF($('#dxfProjection').value));
  $('#btnExportPptx').addEventListener('click', () => app.exportPPTX(parseInt(widthSel.value, 10)).catch(() => {}));

  // ---------- 지도 컨트롤 ----------
  $('#zoomIn').addEventListener('click', () => { const [w, h] = app.view.map.getSize(); app.view.map.zoomAround(w / 2, h / 2, 1); });
  $('#zoomOut').addEventListener('click', () => { const [w, h] = app.view.map.getSize(); app.view.map.zoomAround(w / 2, h / 2, -1); });
  $('#map').addEventListener('pointermove', (e) => {
    const r = $('#map').getBoundingClientRect();
    const ll = app.view.map.containerToLatLng(e.clientX - r.left, e.clientY - r.top);
    $('#statusCoord').textContent = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === 'Escape') { if (app.mode !== 'pan') app.setMode(app.mode); else app.select(null); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.selectedId) { e.preventDefault(); app.deleteSelected(); }
  });

  // ---------- 렌더 함수 ----------
  function log(msg) {
    const t = new Date();
    const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    logEl.textContent += `[${hh}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
    $('#statusMsg').textContent = msg;
  }

  function updateMode() {
    $$('.btn.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === app.mode));
    const map = $('#map');
    map.className = 'frame smap' + (app.mode !== 'pan' ? ` mode-${app.mode}` : '');
    const banner = $('#modeBanner');
    if (app.mode === 'pan') banner.classList.add('hidden');
    else {
      banner.classList.remove('hidden');
      banner.innerHTML = `${MODE_TEXT[app.mode] || ''} <button type="button">종료 (Esc)</button>`;
      banner.querySelector('button').addEventListener('click', () => app.setMode(app.mode));
    }
  }

  function updateStatus() {
    const m = app.view.map;
    $('#statusZoom').textContent = `줌 ${m.zoom.toFixed(2)}`;
    const mpp = metersPerPixel(m.center.lat, m.zoom);
    const [w] = m.getSize();
    $('#statusScale').textContent = `1px ≈ ${mpp.toFixed(2)}m · 프레임 가로 ≈ ${(mpp * w / 1000).toFixed(2)}km`;
  }

  function updateAttribution() {
    const src = app.tileSource();
    const map = { 'vworld-sat': '© 브이월드(국토교통부)', 'vworld-base': '© 브이월드(국토교통부)', 'vworld-gray': '© 브이월드(국토교통부)', 'esri-sat': '© Esri, Maxar, Earthstar Geographics', osm: '© OpenStreetMap contributors' };
    $('#attribution').textContent = `${map[src.id] || ''} · 데이터 © OpenStreetMap contributors, Kakao`;
  }

  function setBusy(on, msg) {
    $$('#btnLoadAll,#btnLoadRoads,#btnLoadAreas,#btnLoadPois').forEach((b) => (b.disabled = !!on));
    if (on && msg) log(msg);
  }

  function progress(msg, p) {
    const el = $('#exportProgress');
    if (msg == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.bar').style.width = Math.round((p || 0) * 100) + '%';
    el.querySelector('.txt').textContent = `${msg} ${Math.round((p || 0) * 100)}%`;
  }

  function li(html) { const el = document.createElement('li'); el.innerHTML = html; return el; }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function refreshParcels() {
    const ul = $('#parcelList');
    ul.innerHTML = '';
    const s = scene();
    if (!s.site.parcels.length) { ul.appendChild(li('<span class="empty">추가된 필지 없음</span>')); return; }
    s.site.parcels.forEach((pc) => {
      const el = li(`<span class="sw" style="background:${pc.group === 'existing' ? s.style.existingColor : pc.group === 'expansion' ? s.style.expansionColor : s.style.siteColor}"></span>
        <span class="name" title="${esc(pc.pnu)}">${esc(pc.jibun || pc.pnu || '필지')}</span>
        <select><option value="existing">기존공장</option><option value="expansion">증축부지</option><option value="site">대지</option></select>
        <button class="icon-btn" title="삭제">✕</button>`);
      el.querySelector('select').value = pc.group || 'site';
      el.querySelector('select').addEventListener('change', (e) => { pc.group = e.target.value; app.commit(); });
      el.querySelector('.icon-btn').addEventListener('click', () => { s.site.parcels = s.site.parcels.filter((x) => x !== pc); app.commit(); });
      el.querySelector('.name').addEventListener('click', () => { const c = pc.ring[0]; app.view.map.setView({ lat: c[0], lng: c[1] }); });
      ul.appendChild(el);
    });
  }

  function refreshRings() {
    const ul = $('#ringList');
    ul.innerHTML = '';
    scene().rings.forEach((r) => {
      const el = li(`<input type="checkbox" ${r.visible !== false ? 'checked' : ''}> <input type="number" value="${r.radius}" min="10" step="10" title="반경(m)"> m
        <input type="text" class="inline" value="${esc(r.label)}" title="표시 문구"> <button class="icon-btn" title="삭제">✕</button>`);
      const [chk, num, txt] = el.querySelectorAll('input');
      chk.addEventListener('change', () => { r.visible = chk.checked; app.commit({ ui: false }); });
      num.addEventListener('change', () => { r.radius = parseFloat(num.value) || r.radius; app.commit({ ui: false }); });
      txt.addEventListener('change', () => { r.label = txt.value; app.commit({ ui: false }); });
      el.querySelector('.icon-btn').addEventListener('click', () => { scene().rings = scene().rings.filter((x) => x !== r); app.commit(); });
      ul.appendChild(el);
    });
  }

  function refreshListsBase() {
    refreshParcels();
    refreshRings();
    const s = scene();
    $('#cntPois').textContent = `${s.pois.filter((p) => p.visible !== false).length}/${s.pois.length}`;
    $('#cntRoads').textContent = `${s.roads.filter((p) => p.visible !== false).length}/${s.roads.length}`;
    $('#cntAreas').textContent = `${s.areas.filter((p) => p.visible !== false).length}/${s.areas.length}`;
    const ul = $('#layerList');
    ul.innerHTML = '';
    const q = $('#layerFilter').value.trim().toLowerCase();
    const match = (name) => !q || String(name || '').toLowerCase().includes(q);
    if (activeTab === 'pois') {
      const list = s.pois.slice().sort((a, b) => (a.dist || 0) - (b.dist || 0)).filter((p) => match(p.name));
      if (!list.length) ul.appendChild(li('<span class="empty">③에서 데이터를 불러오거나 [라벨 직접 추가]를 사용하세요</span>'));
      for (const p of list) {
        const kind = POI_KINDS[p.kind] || POI_KINDS.company;
        const el = li(`<input type="checkbox" ${p.visible !== false ? 'checked' : ''}> <span class="sw" style="background:${p.color || kind.color}"></span>
          <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
          <span class="meta">${p.dist != null ? Math.round(p.dist) + 'm' : ''} · ${p.source === 'kakao' ? 'K' : p.source === 'osm' ? 'O' : p.source === 'vworld' ? 'V' : 'M'}</span>
          <select title="종류">${Object.entries(POI_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
          <button class="icon-btn" title="삭제">✕</button>`);
        el.dataset.id = `poi:${p.id}`;
        if (app.selectedId === el.dataset.id) el.classList.add('selected');
        el.querySelector('select').value = p.kind;
        el.querySelector('input').addEventListener('change', (e) => { p.visible = e.target.checked; if (p.visible && !p.label?.pos) app.placePoiLabels(false); app.commit(); });
        el.querySelector('select').addEventListener('change', (e) => { p.kind = e.target.value; app.commit(); });
        el.querySelector('.name').addEventListener('click', () => app.select(`poi:${p.id}`));
        el.querySelector('.name').addEventListener('dblclick', () => app.editLabel(`poi:${p.id}`));
        el.querySelector('.icon-btn').addEventListener('click', () => { s.pois = s.pois.filter((x) => x !== p); app.commit(); });
        ul.appendChild(el);
      }
    } else if (activeTab === 'roads') {
      const list = s.roads.filter((r) => match(r.name));
      if (!list.length) ul.appendChild(li('<span class="empty">③에서 도로를 불러오세요</span>'));
      for (const r of list) {
        const st = roadStroke(r, s.style);
        const el = li(`<input type="checkbox" ${r.visible !== false ? 'checked' : ''}> <input type="color" value="${st.color.length === 7 ? st.color : '#ffffff'}" title="색상">
          <span class="name" title="${esc(r.name)}">${esc(r.label?.text || r.name)}</span>
          <span class="meta">${CLS_LABEL[r.cls] || r.cls} · ${r.length ? (r.length / 1000).toFixed(1) + 'km' : ''}</span>
          <label class="check inline" title="도로명 라벨"><input type="checkbox" class="lbl" ${r.label?.visible !== false ? 'checked' : ''}>명</label>`);
        el.dataset.id = `road:${r.id}`;
        if (app.selectedId === el.dataset.id) el.classList.add('selected');
        const [chk, col] = el.querySelectorAll('input');
        chk.addEventListener('change', () => { r.visible = chk.checked; if (r.visible && !r.label?.pos) app.placeRoadLabels(false); app.commit(); });
        col.addEventListener('input', () => { r.color = col.value.toUpperCase(); app.commit({ ui: false }); });
        el.querySelector('.lbl').addEventListener('change', (e) => { r.label = r.label || {}; r.label.visible = e.target.checked; if (e.target.checked && !r.label.pos) app.placeRoadLabels(false); app.commit(); });
        el.querySelector('.name').addEventListener('click', () => { app.select(`road:${r.id}`); });
        el.querySelector('.name').addEventListener('dblclick', () => app.editLabel(`road:${r.id}`));
        ul.appendChild(el);
      }
    } else {
      const list = s.areas.filter((a) => match(a.name) || match(AREA_KINDS[a.kind]?.label));
      if (!list.length) ul.appendChild(li('<span class="empty">③에서 구역을 불러오세요</span>'));
      for (const a of list) {
        const el = li(`<input type="checkbox" ${a.visible !== false ? 'checked' : ''}>
          <span class="name" title="${esc(a.name)}">${esc(a.name || '(이름 없음)')}</span>
          <select title="종류">${Object.entries(AREA_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
          <button class="icon-btn" title="삭제">✕</button>`);
        el.dataset.id = `area:${a.id}`;
        if (app.selectedId === el.dataset.id) el.classList.add('selected');
        el.querySelector('select').value = a.kind;
        el.querySelector('input').addEventListener('change', (e) => { a.visible = e.target.checked; app.commit(); });
        el.querySelector('select').addEventListener('change', (e) => { a.kind = e.target.value; app.commit(); });
        el.querySelector('.name').addEventListener('click', () => app.select(`area:${a.id}`));
        el.querySelector('.name').addEventListener('dblclick', () => app.editLabel(`area:${a.id}`));
        el.querySelector('.icon-btn').addEventListener('click', () => { s.areas = s.areas.filter((x) => x !== a); app.commit(); });
        ul.appendChild(el);
      }
    }
  }

  function updateSuppressed() {
    const sup = app.suppressed || new Set();
    const reasons = app.suppressedReasons || new Map();
    $$('#layerList li').forEach((el) => {
      let badge = el.querySelector('.sup');
      const on = sup.has(el.dataset.id);
      if (on) {
        const r = reasons.get(el.dataset.id);
        if (!badge) { badge = document.createElement('span'); badge.className = 'meta sup'; el.insertBefore(badge, el.querySelector('.name').nextSibling); }
        badge.textContent = r === 'outside' ? '화면 밖' : '겹침';
        badge.title = r === 'outside' ? '현재 프레임 밖이라 표시되지 않음' : '다른 라벨·인셋과 겹쳐 자동으로 숨겨짐. 드래그로 옮기면 표시됩니다';
      } else if (badge) badge.remove();
    });
    let overlap = 0;
    for (const r of reasons.values()) if (r === 'overlap') overlap++;
    $('#statusMsg').dataset.overlap = overlap;
    const el = $('#suppressedInfo');
    if (el) el.textContent = overlap ? `겹침으로 자동 숨김 ${overlap}개 (목록에서 '겹침' 표시)` : '겹치는 라벨 없음';
  }

  function highlightSelected() {
    $$('#layerList li').forEach((el) => el.classList.toggle('selected', el.dataset.id === app.selectedId));
  }
  function refreshLists() { refreshListsBase(); updateSuppressed(); }

  /** 씬 값 → 입력 위젯 동기화 */
  function refreshAll() {
    const s = scene();
    $('#projectName').value = s.meta.name || '';
    $('#siteName').value = s.site.name || '';
    $('#sitePin').checked = s.site.pinVisible !== false;
    $('#siteLabelVisible').checked = s.site.label?.visible !== false;
    $('#aspect').value = s.view.aspect || '16:9';
    $('#insetEnabled').checked = !!s.inset.enabled;
    $('#insetMode').value = s.inset.mode;
    $('#insetPos').value = s.inset.pos || 'tl';
    $('#insetSize').value = Math.round((s.inset.size || 0.24) * 100); $('#insetSizeOut').value = Math.round((s.inset.size || 0.24) * 100) + '%';
    $('#insetZoom').value = s.inset.zoom; $('#insetZoomOut').value = Number(s.inset.zoom).toFixed(1);
    $('#insetTitle').value = s.inset.title || '';
    $('#insetLegend').checked = s.inset.legend !== false;
    $('#srcKakao').checked = s.sources.useKakao !== false;
    $('#srcOsm').checked = s.sources.useOsmPois !== false;
    $('#srcVworldBld').checked = !!s.sources.useVworldBuildings;
    $('#kakaoKeywords').value = (s.sources.kakaoKeywords || []).join(', ');
    $('#excludeCategories').value = (s.sources.excludeCategories || []).join(', ');
    $('#maxPois').value = s.sources.maxPois || 40;
    $('#minRoadLength').value = s.sources.minRoadLength ?? 250;
    fillBaseSelect();
    $('#hybridLabels').checked = !!s.style.hybridLabels;
    const st = s.style;
    $('#grayscale').value = st.grayscale; $('#grayscaleOut').value = pct(st.grayscale);
    $('#brightness').value = st.brightness; $('#brightnessOut').value = pct(st.brightness);
    $('#contrast').value = st.contrast; $('#contrastOut').value = pct(st.contrast);
    $('#fontScale').value = st.fontScale; $('#fontScaleOut').value = pct(st.fontScale);
    $('#roadWidth').value = st.roadWidth; $('#roadWidthOut').value = st.roadWidth;
    $('#labelMode').value = st.labelMode;
    $('#veil').checked = st.veil !== false;
    $('#veilOpacity').value = st.veilOpacity ?? 0.2; $('#veilOpacityOut').value = pct(st.veilOpacity ?? 0.2);
    $('#showRoadLabels').checked = st.showRoadLabels !== false;
    $('#showPoiLabels').checked = st.showPoiLabels !== false;
    for (const [id, key] of Object.entries(colorMap)) $('#' + id).value = (st[key] || '#ffffff').toLowerCase();
    updateMode();
    updateStatus();
    updateAttribution();
    refreshLists();
  }

  return { log, updateMode, updateStatus, setBusy, progress, refreshLists, refreshAll, highlightSelected, updateSuppressed };
}
