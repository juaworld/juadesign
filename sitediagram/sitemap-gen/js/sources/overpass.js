// OpenStreetMap Overpass API — 도로·철도·수계·공원·산업지역·건물명
import { assembleRings, polygonCentroid, lineLength } from '../core/geo.js';

const ROAD_RE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link)$';

export function bboxStr(b) {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

export function buildRoadsQuery(b) {
  const bb = bboxStr(b);
  return `[out:json][timeout:60];(
way["highway"~"${ROAD_RE}"]["name"](${bb});
way["highway"~"^(motorway|trunk|motorway_link|trunk_link)$"](${bb});
way["railway"="rail"](${bb});
way["waterway"~"^(river|canal)$"](${bb});
);out geom;`;
}

export function buildAreasQuery(b) {
  const bb = bboxStr(b);
  return `[out:json][timeout:60];(
way["leisure"~"^(park|garden|nature_reserve)$"](${bb});
relation["leisure"~"^(park|garden|nature_reserve)$"](${bb});
way["landuse"~"^(industrial|recreation_ground|cemetery)$"](${bb});
relation["landuse"="industrial"](${bb});
way["natural"="water"](${bb});
relation["natural"="water"](${bb});
way["landuse"="reservoir"](${bb});
);out geom;`;
}

export function buildPoisQuery(b) {
  const bb = bboxStr(b);
  return `[out:json][timeout:60];(
way["building"]["name"](${bb});
relation["building"]["name"](${bb});
node["name"]["office"](${bb});
node["name"]["man_made"](${bb});
way["name"]["man_made"~"^(works|wastewater_plant|water_works)$"](${bb});
node["name"]["amenity"~"^(school|university|college|hospital|townhall|police|fire_station|post_office|community_centre|kindergarten)$"](${bb});
way["name"]["amenity"~"^(school|university|college|hospital|townhall|police|fire_station|post_office|community_centre|kindergarten)$"](${bb});
node["name"]["industrial"](${bb});
way["name"]["landuse"="industrial"](${bb});
node["name"]["shop"="mall"](${bb});
);out geom;`;
}

/** 엔드포인트 폴백 포함 Overpass 호출 */
export async function overpass(cfg, query, onStatus) {
  const endpoints = cfg.overpassEndpoints || ['https://overpass-api.de/api/interpreter'];
  let lastErr = null;
  for (const ep of endpoints) {
    try {
      onStatus && onStatus(`OSM 질의 중… (${new URL(ep, location.href).host})`);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 90000);
      let res;
      try {
        res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: 'data=' + encodeURIComponent(query),
          signal: ac.signal,
        });
      } finally { clearTimeout(timer); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && /timed out|error/i.test(json.remark)) throw new Error(json.remark);
      return json.elements || [];
    } catch (e) {
      lastErr = e;
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

/**
 * Overpass 결과 → 도로 묶음 (이름+등급별 병합)
 * 반환: [{name, cls, segments:[[[lat,lng]...]], length, tags}]
 */
export function parseRoads(elements) {
  const groups = new Map();
  for (const el of elements) {
    if (el.type !== 'way' || !el.tags) continue;
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

/** Overpass 결과 → 구역 폴리곤 */
export function parseAreas(elements) {
  const out = [];
  for (const el of elements) {
    if (!el.tags) continue;
    let polys = [];
    if (el.type === 'way') {
      const c = wayCoords(el);
      if (c.length >= 4) polys = [c];
    } else if (el.type === 'relation') {
      polys = relationRings(el);
    }
    if (!polys.length) continue;
    out.push({
      kind: areaKind(el.tags),
      name: (el.tags.name || el.tags['name:ko'] || '').trim(),
      polys,
      osmId: `${el.type}/${el.id}`,
      tags: el.tags,
    });
  }
  return out;
}

export function poiKindFromTags(tags) {
  const b = tags.building || '';
  if (b === 'apartments' || b === 'residential' || b === 'dormitory') return 'apartment';
  if (tags.amenity && /^(school|university|college|kindergarten|townhall|police|fire_station|post_office|community_centre|hospital)$/.test(tags.amenity)) return 'public';
  if (b === 'school' || b === 'hospital' || b === 'public' || b === 'government') return 'public';
  if (tags.man_made && /^(wastewater_plant|water_works|works)$/.test(tags.man_made)) return tags.man_made === 'works' ? 'company' : 'facility';
  if (tags.power || tags.amenity === 'waste_transfer_station' || tags.amenity === 'recycling') return 'facility';
  if (tags.leisure === 'park') return 'park';
  return 'company';
}

/** Overpass 결과 → 이름 있는 POI */
export function parsePois(elements) {
  const out = [];
  for (const el of elements) {
    if (!el.tags) continue;
    const name = (el.tags.name || el.tags['name:ko'] || '').trim();
    if (!name) continue;
    let lat, lng;
    if (el.type === 'node') { lat = el.lat; lng = el.lon; }
    else if (el.type === 'way') {
      const c = wayCoords(el);
      if (!c.length) continue;
      const cen = polygonCentroid(c);
      [lat, lng] = cen;
    } else if (el.type === 'relation') {
      const rings = relationRings(el);
      if (!rings.length) continue;
      [lat, lng] = polygonCentroid(rings[0]);
    }
    if (lat == null) continue;
    out.push({ name, lat, lng, kind: poiKindFromTags(el.tags), osmId: `${el.type}/${el.id}`, tags: el.tags });
  }
  return out;
}
