// OpenStreetMap Overpass API — 도로·철도·수계·공원·산업지역·건물명 (한 번의 질의로 모두 가져와 캐시)
import { assembleRings, polygonCentroid, lineLength } from '../core/geo.js';

const ROAD_RE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link)$';
const AMENITY_RE = '^(school|university|college|hospital|townhall|police|fire_station|post_office|community_centre|kindergarten)$';

export const INDUSTRIAL_COMPLEX_RE = /산업단지|산단|공단|농공단지|첨단단지|industrial\s*(complex|park|estate|zone)/i;

export function bboxStr(b) {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

/** 도로·구역·POI를 한 번에 (요청 수를 줄여 공용 서버 제한 회피) */
export function buildAllQuery(b) {
  const bb = bboxStr(b);
  return `[out:json][timeout:90];(
way["highway"~"${ROAD_RE}"]["name"](${bb});
way["highway"~"^(motorway|trunk|motorway_link|trunk_link)$"](${bb});
way["railway"="rail"](${bb});
way["waterway"~"^(river|canal)$"](${bb});
way["leisure"~"^(park|garden|nature_reserve)$"](${bb});
relation["leisure"~"^(park|garden|nature_reserve)$"](${bb});
way["landuse"~"^(industrial|recreation_ground|cemetery|reservoir)$"](${bb});
relation["landuse"="industrial"](${bb});
way["natural"="water"](${bb});
relation["natural"="water"](${bb});
way["building"]["name"](${bb});
way["name"]["man_made"~"^(works|wastewater_plant|water_works)$"](${bb});
way["name"]["amenity"~"${AMENITY_RE}"](${bb});
node["name"]["office"](${bb});
node["name"]["man_made"](${bb});
node["name"]["amenity"~"${AMENITY_RE}"](${bb});
node["name"]["industrial"](${bb});
node["name"]["shop"="mall"](${bb});
);out geom;`;
}

// 하위 호환
export const buildRoadsQuery = buildAllQuery;
export const buildAreasQuery = buildAllQuery;
export const buildPoisQuery = buildAllQuery;

const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 엔드포인트 폴백 + 429/504 재시도 포함 Overpass 호출 */
export async function overpass(cfg, query, onStatus) {
  const endpoints = cfg.overpassEndpoints && cfg.overpassEndpoints.length ? cfg.overpassEndpoints : DEFAULT_ENDPOINTS;
  let lastErr = null;
  for (const ep of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        onStatus && onStatus(`OSM 질의 중… (${new URL(ep, location.href).host}${attempt ? ', 재시도' : ''})`);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 100000);
        let res;
        try {
          res = await fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: 'data=' + encodeURIComponent(query),
            signal: ac.signal,
          });
        } finally { clearTimeout(timer); }
        if (res.status === 429 || res.status === 504 || res.status === 503) {
          lastErr = new Error(`HTTP ${res.status} (서버 혼잡)`);
          if (attempt === 0) { await sleep(3000); continue; }
          break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /timed out|error/i.test(json.remark)) throw new Error(json.remark);
        return json.elements || [];
      } catch (e) {
        lastErr = e;
        break; // 네트워크/CORS 오류 → 다음 엔드포인트
      }
    }
  }
  throw new Error(`Overpass 실패: ${lastErr ? lastErr.message : '알 수 없음'}`);
}

const wayCoords = (el) => (el.geometry || []).filter((g) => g && g.lat != null).map((g) => [g.lat, g.lon]);

function relationRings(el) {
  const outers = [];
  for (const m of el.members || []) {
    if (m.type !== 'way' || !m.geometry) continue;
    if (m.role === 'inner') continue;
    outers.push(m.geometry.map((g) => [g.lat, g.lon]));
  }
  return assembleRings(outers);
}

function roadClass(tags) {
  const h = tags.highway || '';
  if (tags.railway === 'rail') return 'rail';
  if (tags.waterway) return 'water';
  if (/^(motorway|motorway_link)$/.test(h)) return 'motorway';
  if (/^(trunk|trunk_link)$/.test(h)) return 'trunk';
  if (/^(primary|primary_link)$/.test(h)) return 'primary';
  if (/^(secondary|secondary_link)$/.test(h)) return 'secondary';
  if (h === 'tertiary') return 'tertiary';
  return 'minor';
}

const CLASS_RANK = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, minor: 5, rail: 6, water: 7 };

const isRoadEl = (el) => el.type === 'way' && el.tags && (el.tags.highway || el.tags.railway === 'rail' || el.tags.waterway);
const isAreaEl = (el) => el.tags && !el.tags.highway && (
  /^(park|garden|nature_reserve)$/.test(el.tags.leisure || '') ||
  /^(industrial|recreation_ground|cemetery|reservoir)$/.test(el.tags.landuse || '') ||
  el.tags.natural === 'water');

/**
 * Overpass 결과 → 도로 묶음 (이름+등급별 병합)
 * 반환: [{name, cls, segments:[[[lat,lng]...]], length, tags}]
 */
export function parseRoads(elements) {
  const groups = new Map();
  for (const el of elements) {
    if (!isRoadEl(el)) continue;
    const coords = wayCoords(el);
    if (coords.length < 2) continue;
    const cls = roadClass(el.tags);
    const name = (el.tags.name || el.tags['name:ko'] || '').trim();
    if (!name && cls !== 'motorway' && cls !== 'trunk' && cls !== 'rail' && cls !== 'water') continue;
    const key = `${cls}|${name || el.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { name: name || (cls === 'rail' ? '철도' : cls === 'water' ? '하천' : '도로'), cls, segments: [], length: 0, osmIds: [], tags: el.tags };
      groups.set(key, g);
    }
    g.segments.push(coords);
    g.length += lineLength(coords);
    g.osmIds.push(el.id);
  }
  return Array.from(groups.values()).sort((a, b) => (CLASS_RANK[a.cls] - CLASS_RANK[b.cls]) || (b.length - a.length));
}

function areaKind(tags) {
  if (tags.landuse === 'industrial') return 'industrial';
  if (tags.natural === 'water' || tags.landuse === 'reservoir') return 'water';
  return 'park';
}

/**
 * Overpass 결과 → 구역 폴리곤.
 * 산업단지 이름 패턴이 아닌 industrial(개별 공장 부지)은 isCompanySite=true 로 표시 → POI로 활용
 */
export function parseAreas(elements) {
  const out = [];
  for (const el of elements) {
    if (!isAreaEl(el)) continue;
    let polys = [];
    if (el.type === 'way') {
      const c = wayCoords(el);
      if (c.length >= 4) polys = [c];
    } else if (el.type === 'relation') {
      polys = relationRings(el);
    }
    if (!polys.length) continue;
    const name = (el.tags.name || el.tags['name:ko'] || '').trim();
    const kind = areaKind(el.tags);
    const isCompanySite = kind === 'industrial' && !!name && !INDUSTRIAL_COMPLEX_RE.test(name);
    out.push({ kind, name, polys, osmId: `${el.type}/${el.id}`, tags: el.tags, isCompanySite });
  }
  return out;
}

export function poiKindFromTags(tags) {
  const b = tags.building || '';
  if (b === 'apartments' || b === 'residential' || b === 'dormitory') return 'apartment';
  if (tags.amenity && /^(school|university|college|kindergarten|townhall|police|fire_station|post_office|community_centre|hospital)$/.test(tags.amenity)) return 'public';
  if (b === 'school' || b === 'hospital' || b === 'public' || b === 'government') return 'public';
  if (tags.man_made && /^(wastewater_plant|water_works)$/.test(tags.man_made)) return 'facility';
  if (tags.power || tags.amenity === 'waste_transfer_station' || tags.amenity === 'recycling') return 'facility';
  if (tags.leisure === 'park') return 'park';
  return 'company';
}

/** Overpass 결과 → 이름 있는 POI (건물·사무실·시설 + 개별 공장 부지) */
export function parsePois(elements) {
  const out = [];
  for (const el of elements) {
    if (!el.tags) continue;
    if (isRoadEl(el)) continue;
    const name = (el.tags.name || el.tags['name:ko'] || '').trim();
    if (!name) continue;
    const t = el.tags;
    const isCompanySite = t.landuse === 'industrial' && !INDUSTRIAL_COMPLEX_RE.test(name);
    const isPoiTag = t.building || t.office || t.man_made || t.amenity || t.industrial || t.shop;
    if (!isPoiTag && !isCompanySite) continue;
    if (isAreaEl(el) && !isCompanySite) continue; // 공원·수역 등은 구역으로 처리
    let lat, lng;
    if (el.type === 'node') { lat = el.lat; lng = el.lon; }
    else if (el.type === 'way') {
      const c = wayCoords(el);
      if (!c.length) continue;
      [lat, lng] = polygonCentroid(c);
    } else if (el.type === 'relation') {
      const rings = relationRings(el);
      if (!rings.length) continue;
      [lat, lng] = polygonCentroid(rings[0]);
    }
    if (lat == null) continue;
    out.push({ name, lat, lng, kind: isCompanySite ? 'company' : poiKindFromTags(t), osmId: `${el.type}/${el.id}`, tags: t });
  }
  return out;
}
