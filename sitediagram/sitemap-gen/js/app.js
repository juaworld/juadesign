// SiteDiagram 메인 애플리케이션
import { defaultScene, loadSceneLocal, saveSceneLocal, sceneToJSON, sceneFromJSON, uid, maxRingRadius, siteCenter, POI_KINDS, ROAD_PALETTE } from './core/scene.js';
import { haversine, bboxAround, expandBbox, inBbox, lineLength, polygonCentroid, bboxOfCoords, bboxIntersects, lngOffset } from './core/geo.js';
import { placePointLabels, lineLabelCandidates, rotatedBox, rectsOverlap } from './core/labels.js';
import { LiveView } from './map/view.js';
import { textBlockSize, areaLabelAnchor, roadStroke } from './render/svg.js';
import { renderComposite, buildSvgDocument, downloadBlob, canvasToBlob, makeProjector } from './render/png.js';
import { insetRect } from './render/layout.js';
import { wrapLabel } from './core/scene.js';
import { buildDXF } from './render/dxf.js';
import { buildPPTX } from './render/pptx.js';
import * as vworld from './sources/vworld.js';
import * as osm from './sources/overpass.js';
import * as kakao from './sources/kakao.js';
import { initUI } from './ui/sidebar.js';

const KEYS_STORAGE = 'sitediagram.keys.v1';
const $ = (s) => document.querySelector(s);

function normName(s) {
  return String(s || '').replace(/\(주\)|주식회사|㈜|\(유\)|유한회사/g, '').replace(/[\s\-_.,·()\[\]]/g, '').toLowerCase();
}

export class App {
  constructor() {
    this.config = this._loadConfig();
    this.scene = loadSceneLocal() || defaultScene();
    this.mode = 'pan';
    this.parcelGroup = 'existing';
    this.drawTarget = 'parcel';
    this.selectedId = null;
    this.draft = null;
    this.busy = false;
    this.view = new LiveView(this, $('#map'), $('#inset'));
    this.ui = initUI(this);
    window.addEventListener('resize', () => this.view.applyAspect());
    this.view.applyAspect();
    this.view.renderOverlay();
    this.ui.refreshAll();
    this.checkKeys();
  }

  // ---------- 설정/키 ----------
  _loadConfig() {
    const base = window.SITEDIAGRAM_CONFIG || {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEYS_STORAGE) || '{}'); } catch (e) { /* ignore */ }
    const cfg = { ...base };
    for (const k of ['vworldKey', 'vworldDomain', 'kakaoJsKey', 'vworldIndustrialLayer']) {
      if (saved[k]) cfg[k] = saved[k];
    }
    if (!cfg.vworldDomain) cfg.vworldDomain = location.origin;
    return cfg;
  }

  saveKeys(keys) {
    try { localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys)); } catch (e) { /* ignore */ }
    this.config = this._loadConfig();
    this.view.applyBase();
    this.ui.refreshAll();
    this.checkKeys();
  }

  checkKeys() {
    const missing = [];
    if (!this.config.vworldKey) missing.push('브이월드 인증키');
    if (!this.config.kakaoJsKey && !this.config.kakaoSdkUrl) missing.push('카카오 JavaScript 키');
    if (missing.length) {
      this.log(`⚠ ${missing.join(', ')}가 없습니다. 우측 상단 [API 키 설정]에서 입력하세요. (키 없이도 Esri 위성영상 + OSM 데이터로는 동작합니다)`);
      if (this.scene.style.base.startsWith('vworld') && !this.config.vworldKey) {
        this.scene.style.base = 'esri-sat';
        this.view.applyBase();
      }
    }
  }

  /** 타일 소스 정보 */
  tileSource(id) {
    const key = id || this.scene.style.base;
    const srcs = this.config.tileSources || {};
    let def = srcs[key] || srcs['esri-sat'];
    const available = !def.needsKey || !!this.config[def.needsKey];
    if (!available && !id) def = srcs['esri-sat'];
    const cfg = this.config;
    return { id: key, name: def.name, maxZoom: def.maxZoom || 19, available, url: (x, y, z) => def.url(x, y, z, cfg) };
  }

  // ---------- 상태 변경 공통 ----------
  commit(opts = {}) {
    saveSceneLocal(this.scene);
    if (opts.render !== false) this.view.renderOverlay();
    if (opts.ui !== false) this.ui.refreshLists();
  }

  onViewChanged() {
    saveSceneLocal(this.scene);
    this.ui.updateStatus();
  }

  log(msg) {
    this.ui.log(msg);
  }

  setMode(mode) {
    if (this.mode === 'draw' && mode !== 'draw') this.draft = null;
    this.mode = this.mode === mode ? 'pan' : mode;
    if (this.mode === 'draw') this.draft = { coords: [] };
    this.view.map.dblclickZoom = this.mode !== 'draw';
    this.ui.updateMode();
    this.view.renderOverlay();
  }

  select(id) {
    this.selectedId = id;
    this.view.renderOverlay();
    this.ui.highlightSelected();
  }

  // ---------- 지도 이벤트 ----------
  async onMapClick(e) {
    const { lat, lng } = e;
    if (this.mode === 'site') {
      this.scene.site.center = { lat, lng };
      this.scene.site.label.pos = null;
      if (this.scene.inset.mode === 'detail') this.scene.inset.center = null;
      this.log(`대지 중심 지정: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      this.setMode('pan');
      this.commit();
    } else if (this.mode === 'parcel') {
      await this.addParcelAt(lat, lng);
    } else if (this.mode === 'draw') {
      this.draft.coords.push([lat, lng]);
      this.view.renderOverlay();
    } else if (this.mode === 'poi') {
      const name = prompt('라벨 이름을 입력하세요', '');
      if (name && name.trim()) {
        this.scene.pois.push({ id: uid('p'), name: name.trim(), kind: 'custom', source: 'manual', anchor: { lat, lng }, label: { pos: null }, visible: true });
        this.commit();
      }
    } else {
      if (this.selectedId) this.select(null);
    }
  }

  onMapDblClick(e) {
    if (this.mode === 'draw' && this.draft && this.draft.coords.length >= 3) {
      const ring = this.draft.coords.slice();
      if (this.drawTarget === 'parcel') {
        this.scene.site.parcels.push({ id: uid('pc'), pnu: '', jibun: '직접 그린 다각형', group: this.parcelGroup, ring });
        if (!this.scene.site.center) this.scene.site.center = (([a, b]) => ({ lat: a, lng: b }))(polygonCentroid(ring));
      } else {
        const defName = this.drawTarget === 'industrial' ? '○○일반산업단지' : this.drawTarget === 'park' ? '○○공원' : '구역';
        const name = prompt('구역 이름 (줄바꿈은 \\n)', defName);
        if (name == null) { this.draft = { coords: [] }; this.setMode('pan'); this.view.renderOverlay(); return; }
        this.scene.areas.push({ id: uid('ar'), key: `manual|${Date.now()}`, kind: this.drawTarget, name: name.trim().replace(/\\n/g, '\n'), polys: [ring], visible: true, source: 'manual', label: { pos: null, visible: true } });
        this.placeAreaLabels(false);
      }
      this.draft = { coords: [] };
      this.setMode('pan');
      this.commit();
    }
  }

  onMapContextMenu() {
    if (this.mode === 'draw' && this.draft && this.draft.coords.length) {
      this.draft.coords.pop();
      this.view.renderOverlay();
    }
  }

  // ---------- 라벨 조작 ----------
  _resolve(id) {
    const [type, key] = id.split(':');
    if (type === 'poi') return { type, obj: this.scene.pois.find((p) => p.id === key) };
    if (type === 'road') return { type, obj: this.scene.roads.find((r) => r.id === key) };
    if (type === 'area') return { type, obj: this.scene.areas.find((a) => a.id === key) };
    if (type === 'site') return { type, obj: this.scene.site };
    return { type, obj: null };
  }

  moveLabel(id, ll) {
    const { type, obj } = this._resolve(id);
    if (!obj) return;
    obj.label = obj.label || {};
    obj.label.pos = ll;
    if (type !== 'site') obj.label.manual = true;
    this.commit({ ui: false });
  }

  editLabel(id) {
    const { type, obj } = this._resolve(id);
    if (!obj) return;
    if (type === 'poi') {
      const v = prompt('라벨 이름 수정 (줄바꿈은 \\n)', obj.name);
      if (v != null && v.trim()) obj.name = v.trim().replace(/\\n/g, '\n');
    } else if (type === 'road') {
      const v = prompt('도로명 라벨 수정', obj.label?.text || obj.name);
      if (v != null && v.trim()) { obj.label = obj.label || {}; obj.label.text = v.trim(); }
    } else if (type === 'area') {
      const v = prompt('구역 이름 수정 (줄바꿈은 \\n)', obj.name);
      if (v != null && v.trim()) obj.name = v.trim().replace(/\\n/g, '\n');
    } else if (type === 'site') {
      const v = prompt('대지 명칭 수정', obj.name);
      if (v != null) obj.name = v.trim();
    }
    this.commit();
  }

  toggleHide(id) {
    const { type, obj } = this._resolve(id);
    if (!obj) return;
    if (type === 'poi') obj.visible = false;
    else if (type === 'road') { obj.label = obj.label || {}; obj.label.visible = false; }
    else if (type === 'area') { obj.label = obj.label || {}; obj.label.visible = false; }
    else if (type === 'site') obj.label.visible = false;
    this.commit();
  }

  deleteSelected() {
    if (!this.selectedId) return;
    const { type, obj } = this._resolve(this.selectedId);
    if (!obj) return;
    if (type === 'poi') this.scene.pois = this.scene.pois.filter((p) => p !== obj);
    else this.toggleHide(this.selectedId);
    this.selectedId = null;
    this.commit();
  }

  // ---------- 지오코딩 ----------
  async geocodeAndGo(query) {
    if (!query || !query.trim()) return;
    this.log(`검색: ${query}`);
    try {
      const r = await kakao.geocode(this.config, query.trim());
      if (!r) { this.log('검색 결과 없음'); return; }
      this.view.map.setView({ lat: r.lat, lng: r.lng }, Math.max(this.view.map.zoom, 16));
      this.log(`이동: ${r.name}${r.address ? ' (' + r.address + ')' : ''}`);
      if (!this.scene.site.center) {
        this.scene.site.center = { lat: r.lat, lng: r.lng };
        this.log('대지 중심을 검색 위치로 설정했습니다 (①에서 다시 지정 가능)');
        this.commit();
      }
    } catch (e) {
      this.log(`검색 실패: ${e.message}`);
    }
  }

  // ---------- 필지 ----------
  async addParcelAt(lat, lng) {
    try {
      this.ui.setBusy(true, '필지 조회 중…');
      const p = await vworld.parcelAt(this.config, lat, lng);
      if (!p) { this.log('해당 위치의 필지를 찾지 못했습니다.'); return; }
      if (this.scene.site.parcels.some((x) => x.pnu && x.pnu === p.pnu)) { this.log(`이미 추가된 필지: ${p.jibun}`); return; }
      this.scene.site.parcels.push({ id: uid('pc'), pnu: p.pnu, jibun: p.jibun || p.addr || p.pnu, group: this.parcelGroup, ring: p.ring });
      if (!this.scene.site.center) this.scene.site.center = { lat: p.centroid[0], lng: p.centroid[1] };
      this.log(`필지 추가 (${this.parcelGroup === 'existing' ? '기존공장' : this.parcelGroup === 'expansion' ? '증축부지' : '대지'}): ${p.jibun || p.pnu}`);
      this.commit();
    } catch (e) {
      this.log(`필지 조회 실패: ${e.message}`);
    } finally {
      this.ui.setBusy(false);
    }
  }

  /** 데이터 질의 범위: 현재 프레임(10% 확장), 대지 중심 5km로 제한 */
  queryBbox() {
    const b = expandBbox(this.view.map.getBounds(), 0.1);
    const c = siteCenter(this.scene);
    const lim = bboxAround(c.lat, c.lng, 5000);
    return {
      south: Math.max(b.south, lim.south), north: Math.min(b.north, lim.north),
      west: Math.max(b.west, lim.west), east: Math.min(b.east, lim.east),
    };
  }

  // ---------- 도로 ----------
  async loadRoads() {
    const bbox = this.queryBbox();
    this.ui.setBusy(true, '도로 데이터 불러오는 중…');
    try {
      const els = await osm.overpass(this.config, osm.buildRoadsQuery(bbox), (m) => this.log(m));
      const parsed = osm.parseRoads(els);
      const prev = new Map(this.scene.roads.filter((r) => r.source !== 'manual').map((r) => [`${r.cls}|${r.name}`, r]));
      const keep = this.scene.roads.filter((r) => r.source === 'manual');
      const st = this.scene.style;
      let pi = 0;
      const roads = parsed.map((r) => {
        const old = prev.get(`${r.cls}|${r.name}`);
        let color = old?.color;
        if (!color) {
          if (r.cls === 'motorway' || r.cls === 'trunk') color = st.motorwayColor;
          else if (r.cls === 'rail' || r.cls === 'water') color = null;
          else color = st.roadPalette[pi++ % st.roadPalette.length];
        }
        let visible = old ? old.visible : true;
        if (!old) {
          if (r.cls === 'minor' && r.length < (this.scene.sources.minRoadLength || 0)) visible = false;
          if (r.cls === 'water' && r.length < 400) visible = false;
        }
        return {
          id: old?.id || uid('rd'), name: r.name, cls: r.cls, color, width: old?.width, visible,
          segments: r.segments, length: Math.round(r.length), source: 'osm',
          label: old?.label ? { ...old.label } : { pos: null, angle: 0, visible: true },
        };
      });
      this.scene.roads = keep.concat(roads);
      this.placeRoadLabels(false);
      this.log(`도로 ${roads.length}개 (표시 ${roads.filter((r) => r.visible).length})`);
      this.commit();
    } catch (e) {
      this.log(`도로 불러오기 실패: ${e.message}`);
    } finally {
      this.ui.setBusy(false);
    }
  }

  /** 도로명 라벨 위치 계산 (force=true면 기존 위치 무시). 대지 주변·다른 라벨을 피해 도로 위에 배치 */
  placeRoadLabels(force) {
    const map = this.view.map;
    const [w, h] = map.getSize();
    const frame = { w, h };
    const st = this.scene.style;
    const placed = this._fixedObstacles();
    const size = st.roadFontSize * (st.fontScale || 1);
    const c = siteCenter(this.scene);
    const [sx, sy] = map.latLngToContainer(c.lat, c.lng);
    for (const r of this.scene.roads) {
      if (r.visible === false) continue;
      r.label = r.label || { visible: true };
      if (r.label.pos && (!force || r.label.manual)) {
        const [x, y] = map.latLngToContainer(r.label.pos.lat, r.label.pos.lng);
        const { w: tw, h: th } = textBlockSize(r.label.text || r.name, size);
        placed.push(rotatedBox(x, y, tw + 12, th + 5, r.label.angle || 0));
        continue;
      }
      const { w: tw, h: th } = textBlockSize(r.label.text || r.name, size);
      const cands = [];
      for (const seg of r.segments) {
        const px = seg.map((cc) => map.latLngToContainer(cc[0], cc[1]));
        for (const cd of lineLabelCandidates(px, frame)) cands.push(cd);
      }
      // 긴 구간 우선, 그다음 후보 순서
      cands.sort((a, b) => b.runLength - a.runLength);
      let best = null, bestScore = Infinity;
      cands.forEach((cd, i) => {
        const box = rotatedBox(cd.x, cd.y, tw + 12, th + 5, cd.angle);
        let score = i * 1.5;
        for (const p of placed) if (rectsOverlap(box, p, 3)) score += 1000;
        const dSite = Math.hypot(cd.x - sx, cd.y - sy);
        if (dSite < 110) score += 400; // 대지 핀 주변 회피
        if (box.x < 4 || box.y < 4 || box.x + box.w > w - 4 || box.y + box.h > h - 4) score += 1e5;
        if (score < bestScore) { bestScore = score; best = { ...cd, box }; }
      });
      if (best && bestScore < 1e5) {
        r.label.pos = map.containerToLatLng(best.x, best.y);
        r.label.angle = best.angle;
        r.label.manual = false;
        if (r.label.visible == null) r.label.visible = true;
        if (bestScore < 1000) placed.push(best.box);
      } else {
        r.label.pos = null; // 프레임 밖
      }
    }
  }

  /** 인셋 변경 시: 인셋과 겹치는 자동 라벨 재배치 */
  relocateForInset() {
    if (!this.scene.inset.enabled) return;
    const map = this.view.map;
    const [w, h] = map.getSize();
    const ir = insetRect(this.scene, w, h, 1);
    const box = { x: ir.x, y: ir.y, w: ir.w, h: ir.h };
    const st = this.scene.style;
    let n = 0;
    for (const p of this.scene.pois) {
      if (p.visible === false || !p.label?.pos || p.label.manual) continue;
      const [x, y] = map.latLngToContainer(p.label.pos.lat, p.label.pos.lng);
      const { w: tw, h: th } = textBlockSize(p.name, st.poiFontSize * (st.fontScale || 1));
      if (rectsOverlap({ x: x - tw / 2, y: y - th / 2, w: tw, h: th }, box, 4)) { p.label.pos = null; n++; }
    }
    for (const r of this.scene.roads) {
      if (r.visible === false || !r.label?.pos || r.label.manual) continue;
      const [x, y] = map.latLngToContainer(r.label.pos.lat, r.label.pos.lng);
      const { w: tw, h: th } = textBlockSize(r.label.text || r.name, st.roadFontSize * (st.fontScale || 1));
      if (rectsOverlap(rotatedBox(x, y, tw + 12, th + 5, r.label.angle || 0), box, 4)) { r.label.pos = null; n++; }
    }
    if (n) { this.placeRoadLabels(false); this.placePoiLabels(false); }
  }

  /** 구역(산단·공원) 라벨 위치: 중심 → 경계 안쪽 후보 중 SITE·인셋과 겹치지 않고 프레임 안인 곳 */
  placeAreaLabels(force) {
    const map = this.view.map;
    const [w, h] = map.getSize();
    const st = this.scene.style;
    const obstacles = this._fixedObstacles();
    const c = siteCenter(this.scene);
    const [sx, sy] = map.latLngToContainer(c.lat, c.lng);
    for (const a of this.scene.areas) {
      if (a.visible === false || !a.name || a.label?.visible === false) continue;
      a.label = a.label || { visible: true };
      const size = (st.roadFontSize + (a.kind === 'industrial' ? 2 : 0)) * (st.fontScale || 1);
      const { w: tw, h: th } = textBlockSize(a.name, size);
      if (a.label.pos && (!force || a.label.manual)) {
        const [x, y] = map.latLngToContainer(a.label.pos.lat, a.label.pos.lng);
        obstacles.push({ x: x - tw / 2, y: y - th / 2, w: tw, h: th });
        continue;
      }
      const ll0 = areaLabelAnchor({ ...a, label: null });
      if (!ll0) continue;
      const [cx, cy] = map.latLngToContainer(ll0[0], ll0[1]);
      const cands = [[cx, cy]];
      if (a.kind === 'industrial') {
        // 경계 꼭짓점을 중심 쪽으로 당긴 지점들 (SITE에서 먼 순)
        const ring = (a.polys || []).slice().sort((p, q) => q.length - p.length)[0] || [];
        const pts = ring.map((v) => map.latLngToContainer(v[0], v[1])).map(([x, y]) => {
          const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1;
          const pull = Math.min(d * 0.35, tw * 0.6 + 30);
          return [x + (dx / d) * pull, y + (dy / d) * pull];
        }).sort((p, q) => Math.hypot(q[0] - sx, q[1] - sy) - Math.hypot(p[0] - sx, p[1] - sy));
        cands.push(...pts);
      } else {
        cands.push([cx, cy - th], [cx, cy + th]);
      }
      let best = null, bestScore = Infinity;
      for (let i = 0; i < cands.length; i++) {
        const [x, y] = cands[i];
        const box = { x: x - tw / 2, y: y - th / 2, w: tw, h: th };
        let score = i * 0.5;
        if (box.x < 8 || box.y < 8 || box.x + box.w > w - 8 || box.y + box.h > h - 8) score += 1e5;
        if (a.kind === 'industrial' && Math.hypot(x - sx, y - sy) < 120) score += 5000;
        for (const o of obstacles) if (rectsOverlap(box, o, 6)) score += 1000;
        if (score < bestScore) { bestScore = score; best = { x, y, box }; }
        if (score === i * 0.5) break;
      }
      if (!best) continue;
      a.label.pos = map.containerToLatLng(best.x, best.y);
      obstacles.push(best.box);
    }
  }

  /** 고정 장애물(인셋, SITE 라벨, 반경 라벨) 픽셀 박스 */
  _fixedObstacles() {
    const map = this.view.map;
    const [w, h] = map.getSize();
    const sc = this.scene;
    const st = sc.style;
    const out = [];
    if (sc.inset.enabled) {
      const ir = insetRect(sc, w, h, 1);
      out.push({ x: ir.x, y: ir.y, w: ir.w, h: ir.h });
    }
    const c = siteCenter(sc);
    if (sc.site.center) {
      const [x, y] = map.latLngToContainer(c.lat, c.lng);
      const size = st.siteFontSize * (st.fontScale || 1);
      out.push({ x: x - 14, y: y - 34 * (size / 20), w: 70 * (size / 20), h: 40 * (size / 20) });
      const lp = sc.site.label?.pos;
      const [lx, ly] = lp ? map.latLngToContainer(lp.lat, lp.lng) : [x, y + 16];
      const { w: tw, h: th } = textBlockSize(sc.site.name || '', size * 0.62);
      out.push({ x: lx - tw / 2 - 7, y: ly - th / 2 - 3, w: tw + 14, h: th + 6 });
    }
    for (const r of sc.rings) {
      if (r.visible === false || !r.label) continue;
      const [ex, ey] = map.latLngToContainer(c.lat, lngOffset(c.lat, c.lng, r.radius));
      const { w: tw, h: th } = textBlockSize(r.label, 11 * (st.fontScale || 1));
      out.push({ x: ex + 2 - tw / 2 - 5, y: ey - th / 2 - 2, w: tw + 10, h: th + 4 });
    }
    return out;
  }

  // ---------- 구역 ----------
  async loadAreas() {
    const bbox = this.queryBbox();
    this.ui.setBusy(true, '구역 데이터 불러오는 중…');
    try {
      const els = await osm.overpass(this.config, osm.buildAreasQuery(bbox), (m) => this.log(m));
      const parsed = osm.parseAreas(els);
      const keep = this.scene.areas.filter((a) => a.source === 'manual');
      const prev = new Map(this.scene.areas.filter((a) => a.source !== 'manual').map((a) => [a.key, a]));
      const areas = [];
      for (const a of parsed) {
        const key = `osm|${a.osmId}`;
        const old = prev.get(key);
        // 산업지역: 이름 있는 것만 경계로 채택, 공원: 이름 없는 작은 것 숨김
        let visible = old ? old.visible : true;
        if (!old) {
          if (a.kind === 'industrial' && !a.name) visible = false;
          if (a.kind === 'park' && !a.name) visible = false;
        }
        areas.push({ id: old?.id || uid('ar'), key, kind: a.kind, name: old?.name || (a.kind === 'industrial' ? wrapLabel(a.name, 6) : a.name), polys: a.polys, visible, source: 'osm', label: old?.label ? { ...old.label } : { pos: null, visible: true } });
      }
      // 브이월드 산업단지 레이어 (설정 시)
      const layer = this.config.vworldIndustrialLayer || this.scene.sources.industrialLayer;
      if (layer && this.config.vworldKey) {
        try {
          const zones = await vworld.industrialZonesInBox(this.config, layer, bbox);
          for (const z of zones) {
            const key = `vw|${z.name}`;
            const old = prev.get(key);
            areas.push({ id: old?.id || uid('ar'), key, kind: 'industrial', name: old?.name || wrapLabel(z.name, 6), polys: z.polys, visible: old ? old.visible : true, source: 'vworld', label: old?.label ? { ...old.label } : { pos: null, visible: true } });
          }
          this.log(`브이월드 산업단지 ${zones.length}건`);
        } catch (e) {
          this.log(`브이월드 산업단지 레이어 실패: ${e.message}`);
        }
      }
      this.scene.areas = keep.concat(areas);
      this.placeAreaLabels(false);
      const ind = areas.filter((a) => a.kind === 'industrial' && a.visible).length;
      const park = areas.filter((a) => a.kind === 'park' && a.visible).length;
      this.log(`구역 ${areas.length}개 (산업단지 경계 ${ind}, 공원 ${park})`);
      if (!ind) this.log('※ 이름 있는 산업단지 경계를 찾지 못했습니다. ①의 [직접 그리기]로 경계를 그리거나 설정에 브이월드 산업단지 레이어 ID를 넣어 주세요.');
      this.commit();
    } catch (e) {
      this.log(`구역 불러오기 실패: ${e.message}`);
    } finally {
      this.ui.setBusy(false);
    }
  }

  // ---------- POI ----------
  async loadPois() {
    const bbox = this.queryBbox();
    const c = siteCenter(this.scene);
    const src = this.scene.sources;
    this.ui.setBusy(true, '주변 기업·시설 검색 중…');
    const found = [];
    try {
      // 카카오 키워드 검색
      if (src.useKakao && (this.config.kakaoJsKey || this.config.kakaoSdkUrl)) {
        const radius = Math.min(20000, haversine(bbox.south, bbox.west, bbox.north, bbox.east) / 2);
        const exclude = new Set((src.excludeCategories || []).map((s) => s.trim()).filter(Boolean));
        let n = 0;
        for (const kw of src.kakaoKeywords || []) {
          if (!kw.trim()) continue;
          try {
            const res = await kakao.searchKeyword(this.config, kw.trim(), { lat: c.lat, lng: c.lng, radius });
            for (const r of res) {
              if (exclude.has(r.categoryCode)) continue;
              if (!inBbox(r.lat, r.lng, bbox)) continue;
              found.push({ id: `k${r.id}`, name: r.name, kind: kakao.kindFromKakao(r), source: 'kakao', lat: r.lat, lng: r.lng, dist: haversine(c.lat, c.lng, r.lat, r.lng), category: r.category });
              n++;
            }
          } catch (e) {
            this.log(`카카오 검색 실패(${kw}): ${e.message}`);
            break;
          }
        }
        this.log(`카카오 장소검색: ${n}건`);
      } else if (src.useKakao) {
        this.log('카카오 키가 없어 장소검색을 건너뜁니다.');
      }
      // OSM
      if (src.useOsmPois) {
        try {
          const els = await osm.overpass(this.config, osm.buildPoisQuery(bbox), (m) => this.log(m));
          const pois = osm.parsePois(els);
          for (const p of pois) found.push({ id: `o${p.osmId.replace('/', '')}`, name: p.name, kind: p.kind, source: 'osm', lat: p.lat, lng: p.lng, dist: haversine(c.lat, c.lng, p.lat, p.lng) });
          this.log(`OSM 건물·시설: ${pois.length}건`);
        } catch (e) {
          this.log(`OSM POI 실패: ${e.message}`);
        }
      }
      // 브이월드 건물명
      if (src.useVworldBuildings && this.config.vworldKey) {
        try {
          const blds = await vworld.buildingNamesInBox(this.config, bbox);
          for (const b of blds) found.push({ id: `v${normName(b.name)}${b.lat.toFixed(5)}`, name: b.name, kind: 'company', source: 'vworld', lat: b.lat, lng: b.lng, dist: haversine(c.lat, c.lng, b.lat, b.lng) });
          this.log(`브이월드 건물명: ${blds.length}건`);
        } catch (e) {
          this.log(`브이월드 건물명 실패: ${e.message}`);
        }
      }
      // 중복 제거 (ID → 정규화 이름+거리)
      const prev = new Map(this.scene.pois.filter((p) => p.source !== 'manual').map((p) => [p.id, p]));
      const keep = this.scene.pois.filter((p) => p.source === 'manual');
      const seenIds = new Set();
      const accepted = [];
      found.sort((a, b) => a.dist - b.dist);
      for (const f of found) {
        if (seenIds.has(f.id)) continue;
        const nn = normName(f.name);
        if (!nn) continue;
        const dup = accepted.find((a) => a.nn === nn && haversine(a.lat, a.lng, f.lat, f.lng) < 150);
        if (dup) continue;
        // 아파트 동 라벨 등 과도한 세분화 제거: "xxx 101동"
        if (/\d+동$/.test(f.name) && accepted.some((a) => f.name.startsWith(a.name.replace(/\s*\d+동$/, '')))) continue;
        seenIds.add(f.id);
        accepted.push({ ...f, nn });
      }
      const max = src.maxPois || 40;
      const siteNn = normName(this.scene.site.name);
      let shown = 0;
      const pois = accepted.map((f) => {
        const old = prev.get(f.id);
        const isSite = siteNn && f.nn === siteNn;
        let visible = old ? old.visible : !isSite && shown < max;
        if (!old && visible) shown++;
        return {
          id: f.id, name: old?.name || wrapLabel(f.name), kind: old?.kind || f.kind, source: f.source,
          anchor: { lat: f.lat, lng: f.lng }, dist: Math.round(f.dist),
          label: old?.label ? { ...old.label } : { pos: null },
          visible,
        };
      });
      this.scene.pois = keep.concat(pois);
      this.placePoiLabels(false);
      this.log(`기업·시설 ${pois.length}건 (표시 ${pois.filter((p) => p.visible).length}) — 목록에서 체크로 조정`);
      this.commit();
    } finally {
      this.ui.setBusy(false);
    }
  }

  /** POI 라벨 자동 배치 */
  placePoiLabels(force) {
    const map = this.view.map;
    const [w, h] = map.getSize();
    const st = this.scene.style;
    const size = st.poiFontSize * (st.fontScale || 1);
    const obstacles = this._fixedObstacles();
    // 도로 라벨·구역 라벨 장애물
    for (const r of this.scene.roads) {
      if (r.visible === false || !r.label?.pos || r.label.visible === false) continue;
      const [x, y] = map.latLngToContainer(r.label.pos.lat, r.label.pos.lng);
      const { w: tw, h: th } = textBlockSize(r.label.text || r.name, st.roadFontSize * (st.fontScale || 1));
      obstacles.push(rotatedBox(x, y, tw + 12, th + 5, r.label.angle || 0));
    }
    for (const a of this.scene.areas) {
      if (a.visible === false || !a.name || a.label?.visible === false) continue;
      const ll = areaLabelAnchor(a);
      if (!ll) continue;
      const [x, y] = map.latLngToContainer(ll[0], ll[1]);
      const { w: tw, h: th } = textBlockSize(a.name, (st.roadFontSize + 2) * (st.fontScale || 1));
      obstacles.push({ x: x - tw / 2, y: y - th / 2, w: tw, h: th });
    }
    // 도로선 자체도 장애물 (라벨이 선 위에 얹히지 않도록 20px 간격 샘플링)
    for (const r of this.scene.roads) {
      if (r.visible === false) continue;
      const half = Math.max(4, (roadStroke(r, st).width || 4) / 2 + 2);
      for (const seg of r.segments) {
        let prev = null;
        for (const c of seg) {
          const [x, y] = map.latLngToContainer(c[0], c[1]);
          if (prev) {
            const d = Math.hypot(x - prev[0], y - prev[1]);
            const n = Math.max(1, Math.ceil(d / 20));
            for (let i = 0; i <= n; i++) {
              const px = prev[0] + ((x - prev[0]) * i) / n, py = prev[1] + ((y - prev[1]) * i) / n;
              if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
              obstacles.push({ x: px - half, y: py - half, w: half * 2, h: half * 2 });
            }
          }
          prev = [x, y];
        }
      }
    }
    const items = [];
    for (const p of this.scene.pois) {
      if (p.visible === false) continue;
      const [ax, ay] = map.latLngToContainer(p.anchor.lat, p.anchor.lng);
      const { w: tw, h: th } = textBlockSize(p.name, size);
      if (p.label?.pos && (!force || p.label.manual)) {
        const [x, y] = map.latLngToContainer(p.label.pos.lat, p.label.pos.lng);
        obstacles.push({ x: x - tw / 2, y: y - th / 2, w: tw, h: th });
        continue;
      }
      if (ax < -50 || ay < -50 || ax > w + 50 || ay > h + 50) continue;
      items.push({ id: p.id, ax, ay, w: tw + 4, h: th + 2, priority: -(p.dist || 0) });
    }
    const res = placePointLabels(items, obstacles, { w, h });
    let collided = 0;
    for (const p of this.scene.pois) {
      const r = res.get(p.id);
      if (!r) continue;
      p.label = p.label || {};
      p.label.pos = map.containerToLatLng(r.x, r.y);
      p.label.manual = false;
      if (r.collides) collided++;
    }
    if (collided) this.log(`※ 자리가 없어 겹치는 라벨 ${collided}개는 자동으로 숨겨집니다 (목록에 '겹침' 표시 → 드래그로 옮기면 표시됨)`);
  }

  autoPlaceLabels() {
    this.placeRoadLabels(true);
    this.placeAreaLabels(true);
    this.placePoiLabels(true);
    this.log('라벨을 현재 화면 기준으로 재배치했습니다.');
    this.commit();
  }

  async loadAll() {
    if (!this.scene.site.center) {
      this.scene.site.center = { ...this.view.map.center };
      this.log('대지 중심이 없어 화면 중심을 대지로 설정했습니다. (①에서 변경 가능)');
    }
    await this.loadRoads();
    await this.loadAreas();
    await this.loadPois();
    this.log('✔ 자동 생성 완료. 라벨을 드래그해 다듬은 뒤 ⑥에서 내보내세요.');
  }

  // ---------- 내보내기 ----------
  _exportBase() {
    const m = this.view.map;
    const [w, h] = m.getSize();
    return { center: { ...m.center }, zoom: m.zoom, w, h };
  }

  _fileBase() {
    const n = (this.scene.meta.name || '대지분석도').replace(/[\\/:*?"<>|]/g, '_');
    return n;
  }

  async _composite(width, opts = {}) {
    const b = this._exportBase();
    const k = width / b.w;
    let src = this.tileSource();
    const prog = (msg, p) => this.ui.progress(msg, p);
    try {
      return await renderComposite({ scene: this.scene, ...b, k, tileUrl: src.url, tileMaxZoom: src.maxZoom, onProgress: prog, ...opts });
    } catch (e) {
      if ((e.code === 'TAINTED' || e.code === 'TILES_FAILED') && src.id !== 'esri-sat') {
        const ok = confirm(`현재 배경지도(${src.name})는 브라우저 보안(CORS) 정책 때문에 이미지로 저장할 수 없습니다.\n\n배경을 Esri 위성영상으로 바꿔서 저장할까요? (취소하면 화면 캡처를 사용하세요)`);
        if (!ok) throw new Error('내보내기 취소');
        src = this.tileSource('esri-sat');
        return await renderComposite({ scene: this.scene, ...b, k, tileUrl: src.url, tileMaxZoom: src.maxZoom, onProgress: prog, ...opts });
      }
      throw e;
    }
  }

  async exportPNG(width, type = 'png') {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await this._composite(width);
      const blob = await canvasToBlob(res.canvas, type === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
      downloadBlob(blob, `${this._fileBase()}_${width}px.${type === 'jpeg' ? 'jpg' : 'png'}`);
      this.log(`${type.toUpperCase()} 저장: ${res.W}×${res.H}px${res.tileInfo.failed ? ` (타일 ${res.tileInfo.failed}개 실패)` : ''}`);
      return res;
    } catch (e) {
      this.log(`내보내기 실패: ${e.message}`);
      throw e;
    } finally {
      this.busy = false;
      this.ui.progress(null);
    }
  }

  async exportSVG(width, includeBackground) {
    if (this.busy) return;
    this.busy = true;
    try {
      const b = this._exportBase();
      const k = width / b.w;
      let doc;
      if (includeBackground) {
        const res = await this._composite(width, { keepBase: true, withOverlay: true });
        doc = buildSvgDocument({ ...res, k, includeBackground: true });
      } else {
        const W = Math.round(b.w * k), H = Math.round(b.h * k);
        const { renderOverlay, renderInsetOverlay } = await import('./render/svg.js');
        const P = makeProjector(b.center, b.zoom, b.w, b.h, k);
        const overlaySvg = renderOverlay(this.scene, { project: P, W, H, k, interactive: false });
        let ir = null, insetSvg = null;
        if (this.scene.inset.enabled) {
          ir = insetRect(this.scene, W, H, k);
          const ic = this.scene.inset.center || siteCenter(this.scene);
          const IP = makeProjector(ic, this.scene.inset.zoom, ir.w / k, ir.h / k, k);
          insetSvg = renderInsetOverlay(this.scene, { project: IP, W: ir.w, H: ir.h, k, interactive: false });
        }
        doc = buildSvgDocument({ W, H, k, overlaySvg, insetRect: ir, insetSvg, includeBackground: false });
      }
      downloadBlob(new Blob([doc], { type: 'image/svg+xml;charset=utf-8' }), `${this._fileBase()}_${width}px.svg`);
      this.log('SVG 저장 완료');
      return doc;
    } catch (e) {
      this.log(`SVG 실패: ${e.message}`);
      throw e;
    } finally {
      this.busy = false;
      this.ui.progress(null);
    }
  }

  async exportPPTX(width = 3000) {
    if (this.busy) return;
    this.busy = true;
    try {
      const b = this._exportBase();
      const k = width / b.w;
      let baseDataUrl = null, insetBaseDataUrl = null;
      try {
        const res = await this._composite(width, { keepBase: true, withOverlay: false });
        baseDataUrl = res.baseDataUrl; insetBaseDataUrl = res.insetBaseDataUrl;
      } catch (e) {
        this.log(`배경 이미지 없이 PPTX를 만듭니다 (${e.message})`);
      }
      this.ui.progress('PPTX 작성 중…', 0.95);
      const blob = await buildPPTX(this.scene, { ...b, k, baseDataUrl, insetBaseDataUrl });
      downloadBlob(blob, `${this._fileBase()}.pptx`);
      this.log(`PPTX 저장 완료 (${Math.round(blob.size / 1024)} KB) — PowerPoint에서 라벨·도형 편집 가능`);
      return blob;
    } catch (e) {
      this.log(`PPTX 실패: ${e.message}`);
      throw e;
    } finally {
      this.busy = false;
      this.ui.progress(null);
    }
  }

  exportDXF(projection = 'epsg5186') {
    const b = this._exportBase();
    const dxf = buildDXF(this.scene, { ...b, projection });
    downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${this._fileBase()}_${projection === 'local' ? 'local' : 'EPSG5186'}.dxf`);
    this.log(`DXF 저장 (${projection === 'local' ? '로컬 좌표' : 'EPSG:5186'})`);
    return dxf;
  }

  // ---------- 프로젝트 ----------
  saveProject() {
    downloadBlob(new Blob([sceneToJSON(this.scene)], { type: 'application/json' }), `${this._fileBase()}.sitediagram.json`);
    this.log('프로젝트 JSON 저장');
  }

  async loadProjectFile(file) {
    const text = await file.text();
    try {
      this.replaceScene(sceneFromJSON(text));
      this.log(`프로젝트 불러옴: ${file.name}`);
    } catch (e) {
      this.log(`프로젝트 파일 오류: ${e.message}`);
    }
  }

  replaceScene(scene) {
    this.scene = scene;
    this.selectedId = null;
    this.draft = null;
    this.mode = 'pan';
    this.view.map.setView(scene.view.center, scene.view.zoom, { silent: true });
    this.view.applyBase();
    this.view.applyFilter();
    this.view.applyAspect();
    this.commit();
    this.ui.refreshAll();
  }

  newProject() {
    if (!confirm('현재 작업을 지우고 새 프로젝트를 시작할까요? (저장하지 않은 내용은 사라집니다)')) return;
    const s = defaultScene();
    s.view.center = { ...this.view.map.center };
    s.view.zoom = this.view.map.zoom;
    this.replaceScene(s);
  }
}

async function boot() {
  if (new URLSearchParams(location.search).get('mock') === '1') {
    const { installMocks } = await import('./mock/mock.js');
    installMocks();
  }
  window.__app = new App();
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();
