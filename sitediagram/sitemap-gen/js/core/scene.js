// 씬(프로젝트) 상태 모델: 저장/불러오기 가능한 순수 JSON
export const SCENE_VERSION = 1;
export const STORAGE_KEY = 'sitediagram.scene.v1';

let _seq = 0;
export function uid(prefix = 'e') {
  _seq += 1;
  return `${prefix}${Date.now().toString(36)}${_seq.toString(36)}`;
}

export const ROAD_PALETTE = ['#19C3FF', '#FF2D87', '#FFD400', '#5CE65C', '#B06CFF', '#00E0C6', '#FF8A3D', '#FF5D5D', '#7FB2FF', '#F2A3FF'];

export const DEFAULT_KEYWORDS = ['공장', '산업', '주식회사', '테크', '케미칼', '금속', '전자', '물류', '제약', '아파트', '공원', '처리장'];
export const DEFAULT_EXCLUDE_CATEGORIES = ['FD6', 'CE7', 'CS2', 'OL7', 'PK6', 'AG2', 'PM9', 'BK9', 'AD5'];

export const POI_KINDS = {
  company: { label: '기업·공장', color: '#FFFFFF' },
  apartment: { label: '아파트·주거', color: '#FFFFFF' },
  public: { label: '공공·학교', color: '#FFE88A' },
  facility: { label: '기반시설', color: '#FFB14D' },
  park: { label: '공원·녹지', color: '#7CF28A' },
  custom: { label: '직접 입력', color: '#FFFFFF' },
};

export const AREA_KINDS = {
  industrial: { label: '산업단지 경계' },
  park: { label: '공원·녹지' },
  water: { label: '수역' },
  custom: { label: '사용자 구역' },
};

export function defaultStyle() {
  return {
    base: 'vworld-sat', // vworld-sat | esri-sat | vworld-base | osm
    hybridLabels: false,
    grayscale: 0.8,
    brightness: 0.85,
    contrast: 1.05,
    veil: true, // 흰색 반투명 레이어(안개)
    veilOpacity: 0.2,
    fontScale: 1,
    roadWidth: 4,
    roadPalette: ROAD_PALETTE.slice(),
    motorwayColor: '#D0D4D9',
    railColor: '#2B2B2B',
    waterColor: '#4FB3FF',
    ringColor: '#FFFFFF',
    ringWidth: 1.5,
    siteColor: '#FF2A2A',
    existingColor: '#2D7BFF',
    expansionColor: '#FF2A2A',
    industrialColor: '#FF3B3B',
    parkColor: '#6FE07A',
    labelMode: 'halo', // halo | box
    poiFontSize: 12,
    roadFontSize: 12,
    siteFontSize: 20,
    showRoadLabels: true,
    showPoiLabels: true,
  };
}

export function defaultScene() {
  return {
    version: SCENE_VERSION,
    meta: { name: '새 대지분석도', created: Date.now(), updated: Date.now() },
    view: { center: { lat: 36.996, lng: 127.839 }, zoom: 15.3, aspect: '16:9' },
    site: {
      name: 'SITE 명칭',
      center: null, // {lat,lng}
      label: { pos: null, visible: true },
      pinVisible: true,
      parcels: [], // {id, pnu, jibun, group:'existing'|'expansion'|'site', ring:[[lat,lng]...]}
    },
    rings: [
      { id: uid('r'), radius: 250, label: '', visible: true },
      { id: uid('r'), radius: 500, label: '0.5KM', visible: true },
      { id: uid('r'), radius: 1000, label: '1KM', visible: true },
    ],
    roads: [], // {id, name, cls, color, width, visible, segments:[[[lat,lng]...]], label:{pos, angle, visible}}
    areas: [], // {id, kind, name, polys:[ring...], visible, label:{pos, visible}, source}
    pois: [], // {id, name, kind, source, anchor:{lat,lng}, label:{pos}, visible}
    inset: { enabled: true, mode: 'detail', zoom: 17.6, size: 0.24, pos: 'tl', title: '', legend: true },
    style: defaultStyle(),
    sources: {
      kakaoKeywords: DEFAULT_KEYWORDS.slice(),
      excludeCategories: DEFAULT_EXCLUDE_CATEGORIES.slice(),
      useOsmPois: true,
      useKakao: true,
      useVworldBuildings: false,
      industrialLayer: '',
      maxPois: 40,
      minRoadLength: 250,
    },
  };
}

/** 저장된 씬을 현재 버전 스키마에 맞춰 보정 */
export function normalizeScene(s) {
  const d = defaultScene();
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s };
  out.view = { ...d.view, ...(s.view || {}) };
  out.site = { ...d.site, ...(s.site || {}) };
  out.site.label = { ...d.site.label, ...((s.site && s.site.label) || {}) };
  out.site.parcels = Array.isArray(out.site.parcels) ? out.site.parcels : [];
  out.rings = Array.isArray(s.rings) ? s.rings.map((r) => ({ id: r.id || uid('r'), visible: true, ...r })) : d.rings;
  out.roads = Array.isArray(s.roads) ? s.roads : [];
  out.areas = Array.isArray(s.areas) ? s.areas : [];
  out.pois = Array.isArray(s.pois) ? s.pois : [];
  out.inset = { ...d.inset, ...(s.inset || {}) };
  out.style = { ...d.style, ...(s.style || {}) };
  out.sources = { ...d.sources, ...(s.sources || {}) };
  out.meta = { ...d.meta, ...(s.meta || {}) };
  return out;
}

export function saveSceneLocal(scene) {
  try {
    scene.meta.updated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSceneLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeScene(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function sceneToJSON(scene) {
  return JSON.stringify(scene, null, 2);
}

export function sceneFromJSON(text) {
  const obj = JSON.parse(text);
  return normalizeScene(obj);
}

/** 가장 큰 반경(m) */
export function maxRingRadius(scene) {
  let m = 0;
  for (const r of scene.rings) if (r.visible !== false && r.radius > m) m = r.radius;
  return m || 1000;
}

/** 대지 중심(없으면 뷰 중심) */
export function siteCenter(scene) {
  return scene.site.center || scene.view.center;
}

/** 긴 이름을 2줄로 — 참고 보드처럼 "현대모비스\n충주공장" 형태 */
export function wrapLabel(name, maxLen = 7) {
  const s = String(name || '').trim();
  if (!s || s.includes('\n') || s.length <= maxLen) return s;
  const parts = s.split(/\s+/);
  if (parts.length >= 2) {
    // 가운데에 가장 가까운 공백에서 분리
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < parts.length; i++) {
      const a = parts.slice(0, i).join(' ').length, b = parts.slice(i).join(' ').length;
      const diff = Math.abs(a - b);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return parts.slice(0, best).join(' ') + '\n' + parts.slice(best).join(' ');
  }
  // 공백 없음: 접미어(공장/APT/산업단지 등) 앞에서 분리, 없으면 절반
  const m = /^(.+?)(충주공장|공장|APT|아파트|주식회사|일반산업단지|국가산업단지|도시첨단산업단지|농공단지|산업단지|처리장|물류센터|연구소|지점|케미칼|케미컬|컨트롤|테크놀로지|테크|시스템|엔지니어링|일렉트로닉스|전자|전선|금속|제약|화학|소재|플러스|정밀|산업|기업|물산|건설|푸드|바이오|파마|머티리얼즈|솔루션)$/.exec(s);
  if (m && m[1].length >= 2 && m[2].length >= 2) return m[1] + '\n' + m[2];
  if (s.length >= 9) { const h = Math.ceil(s.length / 2); return s.slice(0, h) + '\n' + s.slice(h); }
  return s;
}
