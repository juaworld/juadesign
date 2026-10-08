// DXF(R12 호환) 작성기 — 외부 라이브러리 없음. 한글은 \U+XXXX 이스케이프(AutoCAD 표준)로 기록
import { tmForward, localForward, EPSG5186, lngOffset, metersPerPixel, normalizeAngleDeg } from '../core/geo.js';
import { areaLabelAnchor, poiLabelLatLng, roadStroke } from './svg.js';
import { siteCenter } from '../core/scene.js';

const ACI = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [7, 255, 255, 255],
  [8, 128, 128, 128], [9, 192, 192, 192], [11, 255, 170, 170], [20, 255, 63, 0], [30, 255, 127, 0], [40, 255, 191, 0],
  [60, 191, 255, 0], [70, 127, 255, 0], [90, 0, 255, 63], [110, 0, 255, 191], [130, 0, 191, 255], [140, 0, 127, 255],
  [150, 0, 63, 255], [170, 63, 0, 255], [190, 127, 0, 255], [200, 191, 0, 255], [210, 255, 0, 191], [220, 255, 0, 127],
  [240, 255, 0, 63], [250, 51, 51, 51], [252, 105, 105, 105], [254, 190, 190, 190],
];

export function hexToAci(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 7;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  let best = 7, bd = Infinity;
  for (const [i, cr, cg, cb] of ACI) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function dxfText(s) {
  let out = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp < 128) out += ch;
    else if (cp <= 0xffff) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    else out += '?';
  }
  return out;
}

const n3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

class DxfWriter {
  constructor() { this.ent = []; this.layers = new Map(); this.ext = [Infinity, Infinity, -Infinity, -Infinity]; }
  layer(name, aci, ltype = 'CONTINUOUS') { if (!this.layers.has(name)) this.layers.set(name, { aci, ltype }); return name; }
  _ext(x, y) {
    if (x < this.ext[0]) this.ext[0] = x; if (y < this.ext[1]) this.ext[1] = y;
    if (x > this.ext[2]) this.ext[2] = x; if (y > this.ext[3]) this.ext[3] = y;
  }
  polyline(layer, pts, closed = false, aci = null) {
    if (pts.length < 2) return;
    const e = ['0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0', '10', '0.0', '20', '0.0', '30', '0.0'];
    if (aci != null) e.push('62', String(aci));
    for (const [x, y] of pts) { this._ext(x, y); e.push('0', 'VERTEX', '8', layer, '10', n3(x), '20', n3(y), '30', '0.0'); }
    e.push('0', 'SEQEND', '8', layer);
    this.ent.push(e.join('\r\n'));
  }
  circle(layer, cx, cy, r, aci = null) {
    this._ext(cx - r, cy - r); this._ext(cx + r, cy + r);
    const e = ['0', 'CIRCLE', '8', layer, '10', n3(cx), '20', n3(cy), '30', '0.0', '40', n3(r)];
    if (aci != null) e.push('62', String(aci));
    this.ent.push(e.join('\r\n'));
  }
  text(layer, x, y, h, str, rot = 0, aci = null) {
    this._ext(x, y);
    const lines = String(str).split('\n');
    lines.forEach((line, i) => {
      const yy = y - i * h * 1.5 + ((lines.length - 1) * h * 1.5) / 2;
      const e = ['0', 'TEXT', '8', layer, '10', n3(x), '20', n3(yy), '30', '0.0', '40', n3(h), '1', dxfText(line), '50', n3(rot), '7', 'STANDARD', '72', '1', '73', '2', '11', n3(x), '21', n3(yy), '31', '0.0'];
      if (aci != null) e.push('62', String(aci));
      this.ent.push(e.join('\r\n'));
    });
  }
  toString() {
    const L = [];
    const push = (...a) => L.push(...a);
    const ext = isFinite(this.ext[0]) ? this.ext : [0, 0, 1, 1];
    push('0', 'SECTION', '2', 'HEADER');
    push('9', '$ACADVER', '1', 'AC1009');
    push('9', '$INSBASE', '10', '0.0', '20', '0.0', '30', '0.0');
    push('9', '$EXTMIN', '10', n3(ext[0]), '20', n3(ext[1]), '30', '0.0');
    push('9', '$EXTMAX', '10', n3(ext[2]), '20', n3(ext[3]), '30', '0.0');
    push('9', '$LTSCALE', '40', '1.0');
    push('0', 'ENDSEC');
    push('0', 'SECTION', '2', 'TABLES');
    push('0', 'TABLE', '2', 'LTYPE', '70', '2');
    push('0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0');
    push('0', 'LTYPE', '2', 'DASHED', '70', '0', '3', 'Dashed __ __ __', '72', '65', '73', '2', '40', '30.0', '49', '20.0', '49', '-10.0');
    push('0', 'ENDTAB');
    push('0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size + 1));
    push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS');
    for (const [name, l] of this.layers) push('0', 'LAYER', '2', name, '70', '0', '62', String(l.aci), '6', l.ltype);
    push('0', 'ENDTAB');
    push('0', 'TABLE', '2', 'STYLE', '70', '1');
    push('0', 'STYLE', '2', 'STANDARD', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '2.5', '3', 'malgun.ttf', '4', '');
    push('0', 'ENDTAB');
    push('0', 'ENDSEC');
    push('0', 'SECTION', '2', 'ENTITIES');
    for (const e of this.ent) push(e);
    push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\r\n') + '\r\n';
  }
}

/**
 * 씬 → DXF 문자열
 * opts: { center, zoom, w, h, projection: 'epsg5186'|'local' }
 */
export function buildDXF(scene, opts) {
  const { center, zoom, w, h } = opts;
  const site = siteCenter(scene);
  const origin = { lat: site.lat, lng: site.lng };
  const T = opts.projection === 'local' ? (lat, lng) => localForward(lat, lng, origin) : (lat, lng) => tmForward(lat, lng, EPSG5186);
  const mpp = metersPerPixel(center.lat, zoom); // m / CSS px
  const st = scene.style;
  const fs = st.fontScale || 1;
  const d = new DxfWriter();

  // 프레임 (현재 화면 범위)
  {
    const half = [w / 2, h / 2];
    const corners = [[-half[0], -half[1]], [half[0], -half[1]], [half[0], half[1]], [-half[0], half[1]]];
    // 화면 픽셀 → 위경도 (중심 기준 근사: 메르카토르 스케일)
    const pts = corners.map(([px, py]) => {
      const lat = center.lat - (py * mpp) / 110574;
      const lng = lngOffset(center.lat, center.lng, px * mpp);
      return T(lat, lng);
    });
    d.polyline(d.layer('FRAME', 8), pts, true);
  }

  // 구역
  for (const a of scene.areas) {
    if (a.visible === false) continue;
    const layer = a.kind === 'industrial' ? d.layer('AREA_INDUSTRIAL', hexToAci(st.industrialColor), 'DASHED')
      : a.kind === 'park' ? d.layer('AREA_PARK', hexToAci(st.parkColor))
      : a.kind === 'water' ? d.layer('AREA_WATER', hexToAci(st.waterColor))
      : d.layer('AREA_CUSTOM', 7, 'DASHED');
    for (const ring of a.polys || []) d.polyline(layer, ring.map((c) => T(c[0], c[1])), true);
    if (a.name && a.label?.visible !== false) {
      const ll = areaLabelAnchor(a);
      if (ll) { const [x, y] = T(ll[0], ll[1]); d.text(d.layer('AREA_LABEL', 7), x, y, (st.roadFontSize + (a.kind === 'industrial' ? 2 : 0)) * fs * mpp, a.name, 0, hexToAci(a.kind === 'industrial' ? st.industrialColor : a.kind === 'park' ? st.parkColor : '#FFFFFF')); }
    }
  }

  // 도로
  for (const r of scene.roads) {
    if (r.visible === false) continue;
    const s = roadStroke(r, st);
    const layer = d.layer(`ROAD_${(r.cls || 'road').toUpperCase()}`, hexToAci(s.color));
    for (const seg of r.segments) d.polyline(layer, seg.map((c) => T(c[0], c[1])), false, hexToAci(s.color));
    if (st.showRoadLabels && r.label && r.label.visible !== false && r.label.pos) {
      const [x, y] = T(r.label.pos.lat, r.label.pos.lng);
      d.text(d.layer('ROAD_LABEL', 7), x, y, st.roadFontSize * fs * mpp, r.label.text || r.name, -normalizeAngleDeg(r.label.angle || 0), hexToAci(s.color));
    }
  }

  // 필지
  for (const pc of scene.site.parcels) {
    if (!pc.ring || pc.ring.length < 3) continue;
    const layer = pc.group === 'expansion' ? d.layer('SITE_EXPANSION', hexToAci(st.expansionColor), 'DASHED')
      : pc.group === 'existing' ? d.layer('SITE_EXISTING', hexToAci(st.existingColor))
      : d.layer('SITE_PARCEL', hexToAci(st.siteColor));
    d.polyline(layer, pc.ring.map((c) => T(c[0], c[1])), true);
  }

  // 반경 원
  {
    const [cx, cy] = T(site.lat, site.lng);
    const layer = d.layer('RING', 7, 'DASHED');
    for (const r of scene.rings) {
      if (r.visible === false || !(r.radius > 0)) continue;
      d.circle(layer, cx, cy, r.radius);
      if (r.label) d.text(d.layer('RING_LABEL', 7), cx + r.radius, cy, 11 * fs * mpp, r.label);
    }
    if (scene.site.center) {
      const pin = d.layer('SITE_PIN', hexToAci(st.siteColor));
      const c = 6 * mpp;
      d.polyline(pin, [[cx - c, cy], [cx + c, cy]]);
      d.polyline(pin, [[cx, cy - c], [cx, cy + c]]);
      d.circle(pin, cx, cy, c * 0.8);
      d.text(pin, cx + c * 2.5, cy + c * 2, st.siteFontSize * fs * mpp, 'SITE');
      if (scene.site.name) {
        const lp = scene.site.label?.pos;
        const [lx, ly] = lp ? T(lp.lat, lp.lng) : [cx, cy - 16 * mpp];
        d.text(d.layer('SITE_LABEL', 7), lx, ly, st.siteFontSize * 0.62 * fs * mpp, scene.site.name);
      }
    }
  }

  // POI
  if (st.showPoiLabels) {
    const lab = d.layer('POI_LABEL', 7);
    const anc = d.layer('POI_ANCHOR', 8);
    for (const p of scene.pois) {
      if (p.visible === false) continue;
      const [lat, lng] = poiLabelLatLng(p);
      const [x, y] = T(lat, lng);
      d.text(lab, x, y, st.poiFontSize * fs * mpp, p.name);
      const [ax, ay] = T(p.anchor.lat, p.anchor.lng);
      if (Math.hypot(ax - x, ay - y) > 14 * mpp) d.circle(anc, ax, ay, 2 * mpp);
    }
  }

  return d.toString();
}
