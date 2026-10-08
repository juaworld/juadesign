// 브이월드 데이터 API 2.0 (JSONP) — 연속지적도·건물·산업단지 등
import { polygonCentroid } from '../core/geo.js';

let _cbSeq = 0;

/** JSONP 호출 (브이월드 데이터 API는 CORS 미지원 → callback 파라미터 사용) */
export function jsonp(baseUrl, params, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const cbName = `__vw_cb_${Date.now().toString(36)}_${++_cbSeq}`;
    const qs = new URLSearchParams({ ...params, callback: cbName }).toString();
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('브이월드 응답 시간 초과')); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      script.remove();
    }
    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('브이월드 요청 실패 (키/도메인 등록 확인)')); };
    script.src = `${baseUrl}?${qs}`;
    document.head.appendChild(script);
  });
}

function geomToRings(geometry) {
  // GeoJSON [lng,lat] → [[lat,lng]...] 링 배열 (외곽만)
  const rings = [];
  if (!geometry) return rings;
  const toRing = (coords) => coords.map(([x, y]) => [y, x]);
  if (geometry.type === 'Polygon') {
    if (geometry.coordinates[0]) rings.push(toRing(geometry.coordinates[0]));
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) if (poly[0]) rings.push(toRing(poly[0]));
  } else if (geometry.type === 'LineString') {
    rings.push(toRing(geometry.coordinates));
  } else if (geometry.type === 'MultiLineString') {
    for (const l of geometry.coordinates) rings.push(toRing(l));
  } else if (geometry.type === 'Point') {
    rings.push([[geometry.coordinates[1], geometry.coordinates[0]]]);
  }
  return rings;
}

/**
 * GetFeature 호출
 * cfg: { vworldKey, vworldDomain, vworldDataUrl }
 */
export async function getFeature(cfg, { data, geomFilter, attrFilter, size = 100, page = 1, columns }) {
  if (!cfg.vworldKey) throw new Error('브이월드 인증키가 설정되지 않았습니다.');
  const params = {
    service: 'data',
    request: 'GetFeature',
    data,
    key: cfg.vworldKey,
    domain: cfg.vworldDomain || location.origin,
    geomFilter,
    geometry: 'true',
    attribute: 'true',
    crs: 'EPSG:4326',
    size: String(size),
    page: String(page),
    format: 'json',
    errorFormat: 'json',
  };
  if (attrFilter) params.attrFilter = attrFilter;
  if (columns) params.columns = columns;
  const res = await jsonp(cfg.vworldDataUrl || 'https://api.vworld.kr/req/data', params);
  const r = res && res.response;
  if (!r) throw new Error('브이월드 응답 형식 오류');
  if (r.status === 'NOT_FOUND') return { features: [], total: 0 };
  if (r.status !== 'OK') {
    const msg = (r.error && (r.error.text || r.error.code)) || r.status;
    throw new Error(`브이월드 오류: ${msg}`);
  }
  const fc = r.result && r.result.featureCollection;
  const features = (fc && fc.features) || [];
  const total = Number(r.record && r.record.total) || features.length;
  return { features, total };
}

/** 지점의 필지(연속지적도) */
export async function parcelAt(cfg, lat, lng) {
  const { features } = await getFeature(cfg, {
    data: 'LP_PA_CBND_BUBUN',
    geomFilter: `POINT(${lng} ${lat})`,
    size: 5,
  });
  if (!features.length) return null;
  const f = features[0];
  const rings = geomToRings(f.geometry);
  if (!rings.length) return null;
  const p = f.properties || {};
  // 가장 큰 링 선택
  let ring = rings[0];
  for (const r of rings) if (r.length > ring.length) ring = r;
  return {
    pnu: p.pnu || p.PNU || '',
    jibun: p.jibun || p.JIBUN || p.addr || '',
    addr: p.addr || p.ADDR || '',
    ring,
    centroid: polygonCentroid(ring),
    raw: p,
  };
}

/** bbox 내 임의 레이어 피처 (건물명·산업단지 등) */
export async function featuresInBox(cfg, data, bbox, { size = 1000, pages = 3, columns } = {}) {
  const geomFilter = `BOX(${bbox.west},${bbox.south},${bbox.east},${bbox.north})`;
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const { features, total } = await getFeature(cfg, { data, geomFilter, size, page, columns });
    for (const f of features) out.push({ properties: f.properties || {}, rings: geomToRings(f.geometry), id: f.id });
    if (features.length < size || out.length >= total) break;
  }
  return out;
}

/** 도로명주소 건물(LT_C_SPBD)에서 건물명 POI 추출 */
export async function buildingNamesInBox(cfg, bbox) {
  const feats = await featuresInBox(cfg, 'LT_C_SPBD', bbox, { size: 1000, pages: 2 });
  const out = [];
  for (const f of feats) {
    const p = f.properties;
    const nameKey = Object.keys(p).find((k) => /^buld_nm$/i.test(k)) || Object.keys(p).find((k) => /buld_nm/i.test(k));
    const name = nameKey ? String(p[nameKey] || '').trim() : '';
    if (!name || !f.rings.length) continue;
    const c = polygonCentroid(f.rings[0]);
    if (!c) continue;
    out.push({ name, lat: c[0], lng: c[1], raw: p });
  }
  return out;
}

/** 산업단지 레이어(설정에서 지정) */
export async function industrialZonesInBox(cfg, layerId, bbox) {
  if (!layerId) return [];
  const feats = await featuresInBox(cfg, layerId, bbox, { size: 50, pages: 1 });
  return feats.map((f) => {
    const p = f.properties;
    const nameKey = Object.keys(p).find((k) => /(_nm|name|NM)$/i.test(k) && String(p[k]).trim());
    return { name: nameKey ? String(p[nameKey]) : '산업단지', polys: f.rings.filter((r) => r.length >= 4), raw: p };
  }).filter((z) => z.polys.length);
}
