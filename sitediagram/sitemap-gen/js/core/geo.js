// 지리 계산 유틸리티: 웹 메르카토르 투영, 거리, 폴리곤, TM(EPSG:5186) 투영
export const TILE = 256;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const MAX_LAT = 85.05112878;

export function clampLat(lat) {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/** 위경도 → 주어진 줌의 월드 픽셀 좌표 */
export function project(lat, lng, zoom) {
  const s = TILE * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * s;
  const sin = Math.sin(clampLat(lat) * D2R);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return [x, y];
}

/** 월드 픽셀 좌표 → 위경도 */
export function unproject(x, y, zoom) {
  const s = TILE * Math.pow(2, zoom);
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  const lat = R2D * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lat, lng];
}

/** 해당 위도·줌에서 CSS 픽셀 1개가 나타내는 지상 거리(m) */
export function metersPerPixel(lat, zoom) {
  return (156543.03392804097 * Math.cos(lat * D2R)) / Math.pow(2, zoom);
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 중심에서 동쪽으로 dist(m) 떨어진 점의 경도 */
export function lngOffset(lat, lng, distM) {
  return lng + distM / (111320 * Math.cos(lat * D2R));
}
export function latOffset(lat, distM) {
  return lat + distM / 110574;
}

/** 중심·반경(m)으로 bbox {south, west, north, east} */
export function bboxAround(lat, lng, radiusM) {
  return {
    south: lat - radiusM / 110574,
    north: lat + radiusM / 110574,
    west: lngOffset(lat, lng, -radiusM),
    east: lngOffset(lat, lng, radiusM),
  };
}

export function expandBbox(b, ratio) {
  const dLat = (b.north - b.south) * ratio;
  const dLng = (b.east - b.west) * ratio;
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLng, east: b.east + dLng };
}

export function bboxOfCoords(coords) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const [lat, lng] of coords) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lng < w) w = lng;
    if (lng > e) e = lng;
  }
  return { south: s, north: n, west: w, east: e };
}

export function bboxIntersects(a, b) {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

export function inBbox(lat, lng, b) {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

/** 폴리라인 길이(m) */
export function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return d;
}

/** 면적가중 폴리곤 중심(위경도 평면 근사) */
export function polygonCentroid(ring) {
  if (!ring || ring.length < 3) {
    if (ring && ring.length) return [ring[0][0], ring[0][1]];
    return null;
  }
  const lat0 = ring[0][0];
  const kx = Math.cos(lat0 * D2R);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [y1, x1r] = ring[i];
    const [y2, x2r] = ring[(i + 1) % ring.length];
    const x1 = x1r * kx, x2 = x2r * kx;
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-14) {
    // 퇴화 폴리곤 → 평균
    let sy = 0, sx = 0;
    for (const [y, x] of ring) { sy += y; sx += x; }
    return [sy / ring.length, sx / ring.length];
  }
  a *= 0.5;
  return [cy / (6 * a), cx / (6 * a) / kx];
}

/** 폴리곤 면적(㎡, 근사) */
export function polygonArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring[0][0];
  const kx = 111320 * Math.cos(lat0 * D2R);
  const ky = 110574;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [y1, x1] = ring[i];
    const [y2, x2] = ring[(i + 1) % ring.length];
    a += x1 * kx * y2 * ky - x2 * kx * y1 * ky;
  }
  return Math.abs(a) / 2;
}

export function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 선분들을 끝점 기준으로 이어 붙여 닫힌 링으로 조립 (OSM 멀티폴리곤용) */
export function assembleRings(segments) {
  const segs = segments.filter((s) => s && s.length >= 2).map((s) => s.slice());
  const rings = [];
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 5000) {
      const tail = key(ring[ring.length - 1]);
      let found = -1, reverse = false;
      for (let i = 0; i < segs.length; i++) {
        if (key(segs[i][0]) === tail) { found = i; break; }
        if (key(segs[i][segs[i].length - 1]) === tail) { found = i; reverse = true; break; }
      }
      if (found < 0) break;
      let next = segs.splice(found, 1)[0];
      if (reverse) next = next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** 폴리라인 단순화 (Douglas-Peucker, 단위: 입력 좌표계) */
export function simplify(points, tol) {
  if (points.length <= 2) return points;
  const sqTol = tol * tol;
  const sqSegDist = (p, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const out = [points[0]];
  const step = (first, last) => {
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sqTol && idx > 0) { step(first, idx); out.push(points[idx]); step(idx, last); }
  };
  step(0, points.length - 1);
  out.push(points[points.length - 1]);
  return out;
}

// ---------- TM 투영 (EPSG:5186 Korea 2000 / Central Belt 2010, GRS80) ----------
export const EPSG5186 = { lat0: 38, lon0: 127, k0: 1.0, fe: 200000, fn: 600000, a: 6378137, f: 1 / 298.257222101 };
export const EPSG5174 = { lat0: 38, lon0: 127.0028902777778, k0: 1.0, fe: 200000, fn: 500000, a: 6377397.155, f: 1 / 299.1528128 }; // 참고용(Bessel, 데이텀 변환 미적용)

function meridianArc(phi, a, e2) {
  const e4 = e2 * e2, e6 = e4 * e2;
  return a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi -
    (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) +
    (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) -
    (35 * e6 / 3072) * Math.sin(6 * phi)
  );
}

/** 위경도 → TM 평면좌표 [E, N] (m) */
export function tmForward(lat, lng, p = EPSG5186) {
  const { a, f, k0, fe, fn } = p;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const phi = lat * D2R, lam = lng * D2R, lam0 = p.lon0 * D2R, phi0 = p.lat0 * D2R;
  const sinP = Math.sin(phi), cosP = Math.cos(phi), tanP = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T = tanP * tanP;
  const C = ep2 * cosP * cosP;
  const A = (lam - lam0) * cosP;
  const M = meridianArc(phi, a, e2);
  const M0 = meridianArc(phi0, a, e2);
  const A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;
  const E = fe + k0 * N * (A + ((1 - T + C) * A3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120);
  const Nn = fn + k0 * (M - M0 + N * tanP * (A2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720));
  return [E, Nn];
}

/** 로컬 평면좌표 (원점=origin, 단위 m, 동=+x 북=+y) */
export function localForward(lat, lng, origin) {
  const kx = 111320 * Math.cos(origin.lat * D2R);
  return [(lng - origin.lng) * kx, (lat - origin.lat) * 110574];
}

export function normalizeAngleDeg(a) {
  // 텍스트가 거꾸로 보이지 않도록 -90~90 범위로
  let d = a % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  if (d > 90) d -= 180;
  if (d < -90) d += 180;
  return d;
}
