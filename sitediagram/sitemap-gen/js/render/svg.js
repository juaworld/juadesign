// 씬 → SVG 마크업 렌더러 (미리보기·PNG·SVG 내보내기 공용)
// 모든 라벨은 렌더 시점에 충돌 검사를 거쳐, 겹치는 라벨은 우선순위가 낮은 쪽을 숨긴다(suppressed).
import { lngOffset, polygonCentroid, polygonArea, normalizeAngleDeg } from '../core/geo.js';
import { FONT_STACK, measureText, rectsOverlap, rotatedBox } from '../core/labels.js';
import { POI_KINDS, siteCenter } from '../core/scene.js';
import { insetRect } from './layout.js';

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();

export function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

export function luminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pathFromRings(rings, P) {
  let d = '';
  for (const ring of rings) {
    if (!ring || ring.length < 2) continue;
    ring.forEach((c, i) => {
      const [x, y] = P(c[0], c[1]);
      d += (i === 0 ? 'M' : 'L') + f1(x) + ' ' + f1(y);
    });
    d += 'Z';
  }
  return d;
}

function pathFromLines(segments, P) {
  let d = '';
  for (const seg of segments) {
    if (!seg || seg.length < 2) continue;
    seg.forEach((c, i) => {
      const [x, y] = P(c[0], c[1]);
      d += (i === 0 ? 'M' : 'L') + f1(x) + ' ' + f1(y);
    });
  }
  return d;
}

/**
 * 글자 굵기 설정(style.textWeight, 1~10) → font-weight + 보정 외곽선 두께(em).
 * 10 = 굵게(700). 6~10은 보통(400), 6 이하는 가는(300) 글꼴에 글자색 외곽선을 얇게 더해 사이 굵기를 만든다
 * (맑은 고딕처럼 중간 굵기 폰트가 없는 환경에서도 PC마다 같은 두께로 보이게 하기 위함).
 * 세로획 기준: 굵게 ≈ 0.14em, 보통 ≈ 0.085em → 목표 두께 = 0.14em × (설정/10)
 */
export function textWeight(st, base = 700) {
  if (base >= 900) return { weight: 900, boost: 0 }; // SITE 글자는 항상 가장 굵게
  const raw = st && st.textWeight != null && st.textWeight !== '' ? Number(st.textWeight) : 10;
  const t = Number.isFinite(raw) ? Math.min(10, Math.max(1, raw)) : 10;
  if (t >= 10) return { weight: base, boost: 0 };
  const stem = 0.14 * (t / 10); // 목표 세로획(em): 굵게 0.14 · 보통 0.085 · 가늘게(Light/Semilight) 0.055
  const b = (base, w) => ({ weight: w, boost: stem - base < 0.004 ? 0 : stem - base }); // 0.004em 미만 보정은 생략
  if (stem >= 0.085) return b(0.085, 400);
  if (stem >= 0.055) return b(0.055, 300);
  return { weight: 300, boost: 0 };
}

/** 텍스트 블록 크기 (여러 줄 지원). boost = 보정 외곽선(em) */
export function textBlockSize(text, size, weight = 700, boost = 0) {
  const lines = String(text).split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureText(l, size, weight));
  return { w: w + boost * size, h: lines.length * size * 1.2, lines };
}

function textEl(lines, x, y, size, attrs) {
  const lh = size * 1.2;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  let t = `<text x="${f1(x)}" y="${f1(y0)}" font-size="${f1(size)}" font-family='${FONT_STACK}' dominant-baseline="central" ${attrs}>`;
  lines.forEach((l, i) => {
    t += `<tspan x="${f1(x)}" ${i ? `dy="${f1(lh)}"` : ''}>${esc(l)}</tspan>`;
  });
  return t + '</text>';
}

/** 보정 외곽선 속성 (boost>0일 때 글자색으로 얇은 외곽선 → 중간 굵기) */
function boostAttrs(fill, size, boost) {
  return boost > 0 ? ` stroke="${fill}" stroke-width="${(Math.round(boost * size * 100) / 100).toString()}" stroke-linejoin="round"` : '';
}

/** 후광(halo) 텍스트. opts.st = scene.style (글자 굵기 설정) */
function haloText(text, x, y, size, fill, k, opts = {}) {
  const { weight, boost } = textWeight(opts.st, opts.weight || 700);
  const { lines } = textBlockSize(text, size, weight, boost);
  const halo = opts.halo || 'rgba(0,0,0,0.78)';
  const hw = (opts.haloWidth ?? 3) * k;
  const anchor = `text-anchor="${opts.anchor || 'middle'}" font-weight="${weight}"`;
  if (!(boost > 0)) {
    return textEl(lines, x, y, size, `${anchor} fill="${fill}" stroke="${halo}" stroke-width="${f1(hw)}" stroke-linejoin="round" paint-order="stroke"${opts.extra || ''}`);
  }
  // 외곽선 보정이 있으면 두 겹: 후광(글자 두께 보정만큼 넓힘) + 글자(보정 외곽선 포함)
  return textEl(lines, x, y, size, `${anchor} fill="none" stroke="${halo}" stroke-width="${f1(hw + boost * size)}" stroke-linejoin="round"${opts.extra || ''}`)
    + textEl(lines, x, y, size, `${anchor} fill="${fill}"${boostAttrs(fill, size, boost)}${opts.extra || ''}`);
}

/** 박스(pill) 텍스트: 중앙 (x,y). st = scene.style (글자 굵기 설정) */
function boxText(text, x, y, size, k, { bg, fg, rx = 3, padX = 6, padY = 3, weight = 700, opacity = 1, stroke = null, st = null }) {
  const tw = textWeight(st, weight);
  const { w, h, lines } = textBlockSize(text, size, tw.weight, tw.boost);
  const bw = w + padX * 2 * k, bh = h + padY * 2 * k;
  let s = `<rect x="${f1(x - bw / 2)}" y="${f1(y - bh / 2)}" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(rx * k)}" fill="${bg}" opacity="${opacity}"${stroke ? ` stroke="${stroke}" stroke-width="${f1(k)}"` : ''}/>`;
  s += textEl(lines, x, y, size, `text-anchor="middle" font-weight="${tw.weight}" fill="${fg}"${boostAttrs(fg, size, tw.boost)}`);
  return { svg: s, w: bw, h: bh };
}

function dragAttrs(ctx, id, x, y) {
  return ctx.interactive ? ` class="drag" data-drag="${id}" data-x="${f1(x)}" data-y="${f1(y)}"` : '';
}

function selBox(ctx, id, x, y, w, h, k) {
  if (!ctx.interactive || ctx.selectedId !== id) return '';
  return `<rect x="${f1(x - w / 2 - 3 * k)}" y="${f1(y - h / 2 - 3 * k)}" width="${f1(w + 6 * k)}" height="${f1(h + 6 * k)}" fill="none" stroke="#19C3FF" stroke-width="${f1(1.5 * k)}" stroke-dasharray="${f1(4 * k)} ${f1(3 * k)}" pointer-events="none"/>`;
}

export function areaStyle(area, st) {
  const w = (d) => (area.width != null && area.width !== '' ? Number(area.width) : d);
  switch (area.kind) {
    case 'industrial':
      return { fill: hexToRgba(st.industrialColor, 0.05), stroke: st.industrialColor, width: w(2.5), dash: [10, 6], text: st.industrialColor, halo: 'rgba(255,255,255,0.9)', fontDelta: 2 };
    case 'park':
      return { fill: hexToRgba(st.parkColor, 0.16), stroke: hexToRgba(st.parkColor, 0.6), width: w(1), dash: null, text: st.parkColor, halo: 'rgba(0,0,0,0.8)', fontDelta: 0 };
    case 'water':
      return { fill: hexToRgba(st.waterColor, 0.25), stroke: w(0) > 0 ? st.waterColor : 'none', width: w(0), dash: null, text: st.waterColor, halo: 'rgba(0,0,0,0.8)', fontDelta: 0 };
    default:
      return { fill: 'rgba(255,255,255,0.08)', stroke: area.color || '#FFFFFF', width: w(2), dash: [8, 5], text: area.color || '#FFFFFF', halo: 'rgba(0,0,0,0.8)', fontDelta: 0 };
  }
}

export function roadStroke(road, st) {
  const cls = road.cls || 'road';
  if (cls === 'motorway' || cls === 'trunk') return { color: road.color || st.motorwayColor, width: st.roadWidth * 1.6, major: true };
  if (cls === 'rail') return { color: st.railColor, width: st.roadWidth * 1.1, rail: true };
  if (cls === 'water') return { color: st.waterColor, width: st.roadWidth * 0.9, water: true };
  if (cls === 'primary') return { color: road.color || st.roadPalette[2], width: st.roadWidth * 1.25 };
  return { color: road.color || st.roadPalette[0], width: road.width || st.roadWidth };
}

/** 도로 라벨 색: 선 색 배경 + 흰/검 글자 (고속도로도 선 색 그대로 — 검정 배경 없음). 철도만 어두운 배경 */
export function roadLabelColors(s) {
  if (s.rail) return { bg: '#2E3238', fg: '#FFFFFF' };
  return { bg: s.color, fg: luminance(s.color) > 0.6 ? '#111111' : '#FFFFFF' };
}

/** 라벨 기준 위치: 저장된 pos가 없으면 기본 위치 */
export function areaLabelAnchor(area) {
  if (area.label && area.label.pos) return [area.label.pos.lat, area.label.pos.lng];
  let best = null, bestA = -1;
  for (const ring of area.polys || []) {
    const a = polygonArea(ring);
    if (a > bestA) { bestA = a; best = ring; }
  }
  return best ? polygonCentroid(best) : null;
}

export function poiLabelLatLng(poi) {
  if (poi.label && poi.label.pos) return [poi.label.pos.lat, poi.label.pos.lng];
  return [poi.anchor.lat, poi.anchor.lng];
}

const PIN_PATH = 'M0 0 C-5 -8 -11 -12 -11 -20 A11 11 0 1 1 11 -20 C11 -12 5 -8 0 0 Z';

/**
 * 라벨 후보 수집 → 충돌 해결 → 렌더
 * ctx = { project, W, H, k, interactive, selectedId, draft }
 * 반환: SVG 내부 마크업. 숨겨진 라벨 id는 renderOverlay.lastSuppressed(Set)에 기록
 */
export function renderOverlay(scene, ctx) {
  const P = ctx.project;
  const k = ctx.k || 1;
  const st = scene.style;
  const fs = st.fontScale || 1;
  const TW = textWeight(st); // 글자 굵기 설정
  const out = [];
  const center = siteCenter(scene);
  const W = ctx.W, H = ctx.H;

  // 0. 흰색 안개(베일) 레이어
  if (st.veil && st.veilOpacity > 0) out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF" opacity="${st.veilOpacity}" pointer-events="none"/>`);

  // 1. 구역 폴리곤
  for (const area of scene.areas) {
    if (area.visible === false || !area.polys || !area.polys.length) continue;
    const s = areaStyle(area, st);
    out.push(`<path d="${pathFromRings(area.polys, P)}" fill="${s.fill}" fill-rule="evenodd" stroke="${s.stroke}" stroke-width="${f1(s.width * k)}" ${s.dash ? `stroke-dasharray="${f1(s.dash[0] * k)} ${f1(s.dash[1] * k)}"` : ''} stroke-linejoin="round"/>`);
  }

  // 2. 도로·철도·수로
  for (const road of scene.roads) {
    if (road.visible === false) continue;
    const s = roadStroke(road, st);
    const d = pathFromLines(road.segments, P);
    if (!d) continue;
    if (s.rail) {
      out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${f1(s.width * k)}" stroke-linecap="butt"/>`);
      out.push(`<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${f1(s.width * 0.45 * k)}" stroke-dasharray="${f1(8 * k)} ${f1(8 * k)}" stroke-linecap="butt"/>`);
    } else {
      out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${f1(s.width * k)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`);
    }
  }

  // 3. 필지
  for (const pc of scene.site.parcels) {
    if (!pc.ring || pc.ring.length < 3) continue;
    const d = pathFromRings([pc.ring], P);
    if (pc.group === 'expansion') {
      out.push(`<path d="${d}" fill="${hexToRgba(st.expansionColor, 0.2)}" stroke="${st.expansionColor}" stroke-width="${f1(2.2 * k)}" stroke-dasharray="${f1(7 * k)} ${f1(4 * k)}" stroke-linejoin="round"/>`);
    } else if (pc.group === 'existing') {
      out.push(`<path d="${d}" fill="${hexToRgba(st.existingColor, 0.38)}" stroke="${st.existingColor}" stroke-width="${f1(2.2 * k)}" stroke-linejoin="round"/>`);
    } else {
      out.push(`<path d="${d}" fill="${hexToRgba(st.siteColor, 0.3)}" stroke="${st.siteColor}" stroke-width="${f1(2.2 * k)}" stroke-linejoin="round"/>`);
    }
  }

  // 4. 반경 원
  const labels = []; // {id, priority, box, svg}
  const obstacles = [];
  if (scene.inset.enabled) {
    const ir = insetRect(scene, W, H, k);
    obstacles.push({ x: ir.x - 2 * k, y: ir.y - 2 * k, w: ir.w + 4 * k, h: ir.h + 4 * k });
  }
  if (center) {
    const [cx, cy] = P(center.lat, center.lng);
    for (const r of scene.rings) {
      if (r.visible === false || !(r.radius > 0)) continue;
      const [ex, ey] = P(center.lat, lngOffset(center.lat, center.lng, r.radius));
      const rp = Math.hypot(ex - cx, ey - cy);
      out.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rp)}" fill="none" stroke="${st.ringColor}" stroke-width="${f1(st.ringWidth * k)}" stroke-dasharray="${f1(6 * k)} ${f1(5 * k)}" opacity="0.85"/>`);
      if (r.label) {
        const size = 10.5 * fs * k;
        const { w, h } = textBlockSize(r.label, size, TW.weight, TW.boost);
        const x = ex + 2 * k, y = ey;
        labels.push({ id: `ring:${r.id}`, priority: 900, box: { x: x - w / 2 - 3 * k, y: y - h / 2 - 2 * k, w: w + 6 * k, h: h + 4 * k }, svg: haloText(r.label, x, y, size, '#FFFFFF', k, { haloWidth: 3, st }) });
      }
    }
  }

  // 5. 구역 라벨
  for (const area of scene.areas) {
    if (area.visible === false || area.label?.visible === false || !area.name) continue;
    const ll = areaLabelAnchor(area);
    if (!ll) continue;
    const s = areaStyle(area, st);
    const [x, y] = P(ll[0], ll[1]);
    const size = (st.roadFontSize + s.fontDelta) * fs * k;
    const { w, h } = textBlockSize(area.name, size, TW.weight, TW.boost);
    const id = `area:${area.id}`;
    labels.push({
      id, priority: area.kind === 'industrial' ? 820 : 790 + (area.label?.manual ? 5 : 0),
      box: { x: x - w / 2 - 2 * k, y: y - h / 2 - k, w: w + 4 * k, h: h + 2 * k },
      svg: `<g${dragAttrs(ctx, id, x, y)}>${selBox(ctx, id, x, y, w, h, k)}${haloText(area.name, x, y, size, s.text, k, { halo: s.halo, haloWidth: 3.2, st })}</g>`,
    });
  }

  // 6. 도로명 라벨
  if (st.showRoadLabels) {
    let order = 0;
    for (const road of scene.roads) {
      if (road.visible === false || !road.label || road.label.visible === false || !road.label.pos) continue;
      const text = road.label.text || road.name;
      if (!text) continue;
      const s = roadStroke(road, st);
      const [x, y] = P(road.label.pos.lat, road.label.pos.lng);
      const size = st.roadFontSize * fs * k;
      const angle = normalizeAngleDeg(road.label.angle || 0);
      let b;
      if (s.major) {
        // 고속도로·간선도로: 배경 박스 없이 글자만 (흰 글자 + 후광)
        const tw = textWeight(st, 700);
        const m = textBlockSize(text, size, tw.weight, tw.boost);
        b = { svg: haloText(text, 0, 0, size, '#FFFFFF', k, { st }), w: m.w + 4 * k, h: m.h + 2 * k };
      } else {
        const { bg, fg } = roadLabelColors(s);
        b = boxText(text, 0, 0, size, k, { bg, fg, rx: 2.5, padX: 6, padY: 2.5, weight: 700, st });
      }
      const id = `road:${road.id}`;
      labels.push({
        id, priority: 700 + (road.label.manual ? 60 : 0) - order++ * 0.01,
        box: rotatedBox(x, y, b.w, b.h, angle),
        svg: `<g${dragAttrs(ctx, id, x, y)} transform="translate(${f1(x)} ${f1(y)})"><g transform="rotate(${f1(angle)})">${b.svg}</g>${selBox(ctx, id, 0, 0, b.w, b.h, k)}</g>`,
      });
    }
  }

  // 7. 기업·시설 라벨
  if (st.showPoiLabels) {
    const [scx, scy] = center ? P(center.lat, center.lng) : [W / 2, H / 2];
    for (const poi of scene.pois) {
      if (poi.visible === false) continue;
      const [lat, lng] = poiLabelLatLng(poi);
      const [x, y] = P(lat, lng);
      const [ax, ay] = P(poi.anchor.lat, poi.anchor.lng);
      const kind = POI_KINDS[poi.kind] || POI_KINDS.company;
      const color = poi.color || kind.color;
      const size = st.poiFontSize * fs * k;
      const { w, h } = textBlockSize(poi.name, size, TW.weight, TW.boost);
      const id = `poi:${poi.id}`;
      let g = `<g${dragAttrs(ctx, id, x, y)}>`;
      // 건물 위치점(작은 원)은 표시하지 않음 — 라벨만. (옵션 poiLeader가 켜진 경우에만 지시선)
      if (st.poiLeader && Math.hypot(ax - x, ay - y) > 14 * k) g += `<line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(x)}" y2="${f1(y)}" stroke="rgba(255,255,255,0.6)" stroke-width="${f1(0.8 * k)}" pointer-events="none"/>`;
      g += selBox(ctx, id, x, y, w, h, k);
      let bw = w + 4 * k, bh = h + 2 * k;
      if (st.labelMode === 'box') {
        const b = boxText(poi.name, x, y, size, k, { bg: 'rgba(0,0,0,0.6)', fg: color, rx: 3, padX: 5, padY: 2.5, st });
        g += b.svg; bw = b.w; bh = b.h;
      } else {
        g += haloText(poi.name, x, y, size, color, k, { haloWidth: 3, st });
      }
      g += '</g>';
      const dSite = Math.hypot(ax - scx, ay - scy);
      labels.push({ id, priority: (poi.label?.manual ? 650 : 600) - dSite / 10000, box: { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh }, svg: g });
    }
  }

  // 8. SITE 핀·명칭 (항상 표시, 장애물로 등록)
  if (scene.site.center) {
    const [x, y] = P(scene.site.center.lat, scene.site.center.lng);
    const size = st.siteFontSize * fs * k;
    if (scene.site.pinVisible !== false) {
      const pinScale = (size / 20) * 1.1;
      out.push(`<g transform="translate(${f1(x)} ${f1(y)}) scale(${f1(pinScale)})"><path d="${PIN_PATH}" fill="${st.siteColor}" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="0" cy="-20" r="4" fill="#FFFFFF"/></g>`);
      out.push(haloText('SITE', x + 14 * pinScale, y - 20 * pinScale, size, st.siteColor, k, { anchor: 'start', weight: 900, halo: 'rgba(255,255,255,0.95)', haloWidth: 3.5 }));
      const tw = measureText('SITE', size, 900);
      obstacles.push({ x: x - 12 * pinScale, y: y - 33 * pinScale, w: 14 * pinScale + tw + 6 * k, h: 36 * pinScale });
    }
    if (scene.site.name && scene.site.label?.visible !== false) {
      const lp = scene.site.label?.pos;
      const [lx, ly] = lp ? P(lp.lat, lp.lng) : [x, y + 15 * k];
      const nsize = size * 0.6;
      const b = boxText(scene.site.name, 0, 0, nsize, k, { bg: 'rgba(0,0,0,0.72)', fg: '#FFFFFF', rx: 2, padX: 7, padY: 3, weight: 700, st });
      const id = 'site:label';
      out.push(`<g${dragAttrs(ctx, id, lx, ly)} transform="translate(${f1(lx)} ${f1(ly)})">${b.svg}${selBox(ctx, id, 0, 0, b.w, b.h, k)}</g>`);
      obstacles.push({ x: lx - b.w / 2, y: ly - b.h / 2, w: b.w, h: b.h });
    }
  }

  // 9. 충돌 해결: 우선순위 순으로 배치, 겹치면 숨김
  const suppressed = new Set();
  const reasons = new Map();
  const kept = obstacles.slice();
  labels.sort((a, b) => b.priority - a.priority);
  const pad = 2 * k;
  for (const lb of labels) {
    const b = lb.box;
    const outside = b.x + b.w < 0 || b.y + b.h < 0 || b.x > W || b.y > H;
    if (outside) { suppressed.add(lb.id); reasons.set(lb.id, 'outside'); continue; }
    if (kept.some((o) => rectsOverlap(b, o, pad))) { suppressed.add(lb.id); reasons.set(lb.id, 'overlap'); continue; }
    kept.push(b);
    lb.keep = true;
  }
  // 그리기 순서: 구역 → 도로 → 반경 → POI (원래 순서 유지)
  for (const lb of labels.filter((l) => l.keep).sort((a, b) => a.priority - b.priority)) out.push(lb.svg);
  renderOverlay.lastSuppressed = suppressed;
  renderOverlay.lastReasons = reasons;

  // 10. 그리기 중인 도형
  if (ctx.draft && ctx.draft.coords && ctx.draft.coords.length) {
    const pts = ctx.draft.coords.map((c) => P(c[0], c[1]));
    const d = pts.map((p, i) => (i ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])).join('');
    out.push(`<path d="${d}" fill="rgba(25,195,255,0.15)" stroke="#19C3FF" stroke-width="${f1(2 * k)}" stroke-dasharray="${f1(5 * k)} ${f1(4 * k)}" pointer-events="none"/>`);
    for (const p of pts) out.push(`<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${f1(4 * k)}" fill="#19C3FF" stroke="#fff" stroke-width="${f1(1.2 * k)}" pointer-events="none"/>`);
  }

  return out.join('');
}
renderOverlay.lastSuppressed = new Set();
renderOverlay.lastReasons = new Map();

/** 인셋(위치도) 오버레이: 필지·핀·제목·범례 */
export function renderInsetOverlay(scene, ctx) {
  const P = ctx.project;
  const k = ctx.k || 1;
  const st = scene.style;
  const out = [];
  for (const pc of scene.site.parcels) {
    if (!pc.ring || pc.ring.length < 3) continue;
    const d = pathFromRings([pc.ring], P);
    if (pc.group === 'expansion') {
      out.push(`<path d="${d}" fill="${hexToRgba(st.expansionColor, 0.22)}" stroke="${st.expansionColor}" stroke-width="${f1(2.5 * k)}" stroke-dasharray="${f1(7 * k)} ${f1(4 * k)}"/>`);
    } else if (pc.group === 'existing') {
      out.push(`<path d="${d}" fill="${hexToRgba(st.existingColor, 0.4)}" stroke="${st.existingColor}" stroke-width="${f1(2.5 * k)}"/>`);
    } else {
      out.push(`<path d="${d}" fill="${hexToRgba(st.siteColor, 0.3)}" stroke="${st.siteColor}" stroke-width="${f1(2.5 * k)}"/>`);
    }
  }
  if (scene.site.center) {
    const [x, y] = P(scene.site.center.lat, scene.site.center.lng);
    const pinScale = (scene.inset.mode === 'detail' ? 0.75 : 0.9) * k;
    out.push(`<g transform="translate(${f1(x)} ${f1(y)}) scale(${f1(pinScale)})"><path d="${PIN_PATH}" fill="${st.siteColor}" stroke="#FFFFFF" stroke-width="1.6"/><circle cx="0" cy="-20" r="4" fill="#FFFFFF"/></g>`);
    out.push(haloText('SITE', x + 13 * pinScale, y - 20 * pinScale, 13 * pinScale, st.siteColor, k, { anchor: 'start', weight: 900, halo: 'rgba(255,255,255,0.95)', haloWidth: 3 }));
  }
  // 제목·범례
  const title = (scene.inset.title || '').trim();
  const fsz = 11 * (st.fontScale || 1) * k;
  if (title) {
    const b = boxText(title, 0, 0, fsz, k, { bg: 'rgba(0,0,0,0.75)', fg: '#FFFFFF', rx: 0, padX: 7, padY: 3, weight: 700, st });
    out.push(`<g transform="translate(${f1(b.w / 2 + 6 * k)} ${f1(b.h / 2 + 6 * k)})">${b.svg}</g>`);
  }
  if (scene.inset.legend && scene.site.parcels.length) {
    const groups = new Set(scene.site.parcels.map((p) => p.group || 'site'));
    const items = [];
    if (groups.has('existing')) items.push({ label: '기존공장', fill: hexToRgba(st.existingColor, 0.7), stroke: st.existingColor, dash: false });
    if (groups.has('expansion')) items.push({ label: '증축부지', fill: hexToRgba(st.expansionColor, 0.25), stroke: st.expansionColor, dash: true });
    if (groups.has('site')) items.push({ label: '대지', fill: hexToRgba(st.siteColor, 0.5), stroke: st.siteColor, dash: false });
    const lh = fsz * 1.6, sw = 18 * k, sh = fsz * 0.95;
    let maxW = 0;
    const TW = textWeight(st);
    for (const it of items) maxW = Math.max(maxW, measureText(it.label, fsz * 0.95, TW.weight) + TW.boost * fsz * 0.95);
    const bw = sw + maxW + 22 * k, bh = items.length * lh + 8 * k;
    const bx = ctx.W - bw - 6 * k, by = ctx.H - bh - 6 * k;
    out.push(`<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="rgba(0,0,0,0.65)" rx="${f1(2 * k)}"/>`);
    items.forEach((it, i) => {
      const yy = by + 4 * k + i * lh + lh / 2;
      out.push(`<rect x="${f1(bx + 7 * k)}" y="${f1(yy - sh / 2)}" width="${f1(sw)}" height="${f1(sh)}" fill="${it.fill}" stroke="${it.stroke}" stroke-width="${f1(1.5 * k)}" ${it.dash ? `stroke-dasharray="${f1(4 * k)} ${f1(3 * k)}"` : ''}/>`);
      out.push(textEl([it.label], bx + 7 * k + sw + 6 * k, yy, fsz * 0.95, `text-anchor="start" font-weight="${TW.weight}" fill="#FFFFFF"${boostAttrs('#FFFFFF', fsz * 0.95, TW.boost)}`));
    });
  }
  return out.join('');
}

/** 완전한 <svg> 문서 래핑 */
export function wrapSvgDocument(inner, W, H, opts = {}) {
  const bg = opts.backgroundHref ? `<image x="0" y="0" width="${W}" height="${H}" href="${opts.backgroundHref}" preserveAspectRatio="none"/>` : (opts.backgroundColor ? `<rect width="${W}" height="${H}" fill="${opts.backgroundColor}"/>` : '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}${inner}</svg>`;
}
