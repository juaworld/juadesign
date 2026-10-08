// PPTX 작성기 — 항공사진은 그림, 도형·라벨은 편집 가능한 PowerPoint 개체로 내보내기 (외부 라이브러리 없음)
import { buildZip, dataUrlToBytes } from '../core/zip.js';
import { lngOffset, normalizeAngleDeg } from '../core/geo.js';
import { textBlockSize, textWeight, areaStyle, roadStroke, roadLabelColors, areaLabelAnchor, poiLabelLatLng, renderOverlay, esc } from './svg.js';
import { measureText } from '../core/labels.js';
import { POI_KINDS, siteCenter } from '../core/scene.js';
import { insetRect, insetCenter } from './layout.js';
import { makeProjector } from './png.js';

const SLIDE_W = 12192000; // 13.333in (EMU)
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const FONT = '맑은 고딕';
const FONT_LIGHT = 'Malgun Gothic Semilight'; // Windows 8.1+ 기본 탑재. 없으면 PowerPoint가 기본 글꼴로 대체

const hex6 = (c, fallback = 'FFFFFF') => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  return m ? m[1].toUpperCase() : fallback;
};
const alphaPct = (a) => Math.round(Math.max(0, Math.min(1, a)) * 100000);

function solidFill(hex, alpha = 1) {
  return `<a:solidFill><a:srgbClr val="${hex6(hex)}">${alpha < 1 ? `<a:alpha val="${alphaPct(alpha)}"/>` : ''}</a:srgbClr></a:solidFill>`;
}

export async function buildPPTX(scene, opts) {
  const { w, h } = opts;
  const SW = SLIDE_W, SH = Math.round((SLIDE_W * h) / w);
  const E = SW / w; // EMU per CSS px
  const PT = 960 / w; // pt per CSS px
  const emu = (v) => Math.round(v * E);
  const fsz = (pxFont) => Math.max(500, Math.round(pxFont * PT * 100));
  const P = makeProjector(opts.center, opts.zoom, w, h, 1);
  const st = scene.style;
  const fs = st.fontScale || 1;
  const TWg = textWeight(st); // 글자 굵기 설정(측정용)
  const center = siteCenter(scene);
  let nextId = 2;
  const id = () => nextId++;
  const shapes = [];

  // 숨김(겹침) 라벨 집합: 미리보기와 동일 기하로 계산
  renderOverlay(scene, { project: P, W: w, H: h, k: 1, interactive: false });
  const suppressed = renderOverlay.lastSuppressed || new Set();

  // ---------- 도형 빌더 ----------
  const xfrm = (x, y, cx, cy, rot = 0) => `<a:xfrm${rot ? ` rot="${Math.round(rot * 60000)}"` : ''}><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.max(1, Math.round(cx))}" cy="${Math.max(1, Math.round(cy))}"/></a:xfrm>`;

  function lineXml(color, widthPx, dash, alpha = 1) {
    if (!color || !(widthPx > 0)) return '<a:ln><a:noFill/></a:ln>';
    let d = '';
    if (dash) d = `<a:custDash><a:ds d="${Math.round((dash[0] / widthPx) * 100000)}" sp="${Math.round((dash[1] / widthPx) * 100000)}"/></a:custDash>`;
    return `<a:ln w="${Math.max(3175, emu(widthPx))}" cap="rnd">${solidFill(color, alpha)}${d}<a:round/></a:ln>`;
  }

  function pic(name, rId, x, y, cx, cy) {
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id()}" name="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x, y, cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }

  /** 자유형: paths = [[ [x,y]px ... ], ...] */
  function freeform(name, paths, { closed = false, fill = null, fillAlpha = 1, line = null, lineWidth = 2, dash = null, lineAlpha = 1 } = {}) {
    const pts = paths.flat();
    if (pts.length < 2) return '';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    const pad = 0.5; // 0폭 방지
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const cw = emu(maxX - minX), ch = emu(maxY - minY);
    let pathXml = '';
    for (const path of paths) {
      if (path.length < 2) continue;
      pathXml += `<a:path w="${cw}" h="${ch}"${fill ? '' : ' fill="none"'}>`;
      path.forEach(([x, y], i) => {
        const px = Math.round(emu(x - minX)), py = Math.round(emu(y - minY));
        pathXml += i === 0 ? `<a:moveTo><a:pt x="${px}" y="${py}"/></a:moveTo>` : `<a:lnTo><a:pt x="${px}" y="${py}"/></a:lnTo>`;
      });
      if (closed) pathXml += '<a:close/>';
      pathXml += '</a:path>';
    }
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id()}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(emu(minX), emu(minY), cw, ch)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${pathXml}</a:pathLst></a:custGeom>${fill ? solidFill(fill, fillAlpha) : '<a:noFill/>'}${lineXml(line, lineWidth, dash, lineAlpha)}</p:spPr></p:sp>`;
  }

  function prst(name, geom, x, y, cx, cy, { fill = null, fillAlpha = 1, line = null, lineWidth = 1, dash = null, lineAlpha = 1, rot = 0, adj = null } = {}) {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id()}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, cx, cy, rot)}<a:prstGeom prst="${geom}"><a:avLst>${adj != null ? `<a:gd name="adj" fmla="val ${adj}"/>` : ''}</a:avLst></a:prstGeom>${fill ? solidFill(fill, fillAlpha) : '<a:noFill/>'}${lineXml(line, lineWidth, dash, lineAlpha)}</p:spPr></p:sp>`;
  }

  /** 텍스트 상자: (cx,cy) 중심 px, fontPx, 옵션 */
  function textbox(name, text, cxPx, cyPx, fontPx, { color = '#FFFFFF', bold = true, heavy = false, bg = null, bgAlpha = 1, glow = null, rot = 0, padX = 3, padY = 1.5, rounded = false, align = 'ctr', anchorLeft = false, border = null } = {}) {
    const lines = String(text).split('\n').filter((l) => l.length);
    if (!lines.length) return '';
    // 글자 굵기 설정: 10=굵게, 그 외 보통 글자 + 글자색 외곽선(미리보기와 동일한 두께 보정)
    const TW = heavy ? { weight: 700, boost: 0 } : textWeight(st, bold ? 700 : 400);
    const { w: tw, h: th } = textBlockSize(text, fontPx, TW.weight, TW.boost);
    const bw = tw + padX * 2, bh = th + padY * 2;
    const x = anchorLeft ? cxPx : cxPx - bw / 2;
    const y = cyPx - bh / 2;
    const geom = rounded ? 'roundRect' : 'rect';
    let rpr = `<a:rPr lang="ko-KR" altLang="en-US" sz="${fsz(fontPx)}" b="${TW.weight >= 700 ? 1 : 0}" dirty="0">`;
    if (TW.boost > 0) rpr += `<a:ln w="${Math.max(635, Math.round(TW.boost * fontPx * PT * 12700))}">${solidFill(color)}</a:ln>`; // 글자 외곽선(굵기 보정)
    rpr += solidFill(color);
    if (glow) rpr += `<a:effectLst><a:glow rad="${Math.max(12700, emu(glow.radius || 2.5))}">${`<a:srgbClr val="${hex6(glow.color || '#000000')}"><a:alpha val="${alphaPct(glow.alpha ?? 0.7)}"/></a:srgbClr>`}</a:glow></a:effectLst>`;
    const face = TW.weight <= 300 ? FONT_LIGHT : FONT; // 가는 글꼴 설정이면 맑은 고딕 Semilight
    rpr += `<a:latin typeface="${face}"/><a:ea typeface="${face}"/></a:rPr>`;
    const paras = lines.map((l) => `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r>${rpr}<a:t>${esc(l)}</a:t></a:r></a:p>`).join('');
    const ins = `lIns="${emu(padX)}" tIns="${emu(padY)}" rIns="${emu(padX)}" bIns="${emu(padY)}"`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id()}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(emu(x), emu(y), emu(bw), emu(bh), rot)}<a:prstGeom prst="${geom}"><a:avLst>${rounded ? '<a:gd name="adj" fmla="val 22000"/>' : ''}</a:avLst></a:prstGeom>${bg ? solidFill(bg, bgAlpha) : '<a:noFill/>'}${border ? lineXml(border, 0.8) : '<a:ln><a:noFill/></a:ln>'}</p:spPr><p:txBody><a:bodyPr wrap="none" ${ins} anchor="ctr" anchorCtr="1" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
  }

  function pin(cxPx, cyPx, scale, color) {
    // 22×31 단위 핀, 끝점이 (cx,cy)
    const s = scale;
    const x = cxPx - 11 * s, y = cyPx - 31 * s;
    const cw = emu(22 * s), ch = emu(31 * s);
    const path = `<a:path w="22" h="31"><a:moveTo><a:pt x="11" y="31"/></a:moveTo><a:cubicBezTo><a:pt x="6" y="23"/><a:pt x="0" y="19"/><a:pt x="0" y="11"/></a:cubicBezTo><a:arcTo wR="11" hR="11" stAng="10800000" swAng="10800000"/><a:cubicBezTo><a:pt x="22" y="19"/><a:pt x="16" y="23"/><a:pt x="11" y="31"/></a:cubicBezTo><a:close/></a:path>`;
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="${id()}" name="SITE 핀"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(emu(x), emu(y), cw, ch)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${path}</a:pathLst></a:custGeom>${solidFill(color)}${lineXml('#FFFFFF', 1.4 * s)}</p:spPr></p:sp>`;
    const dot = prst('SITE 핀 중심', 'ellipse', emu(cxPx - 4 * s), emu(cyPx - 24 * s), emu(8 * s), emu(8 * s), { fill: '#FFFFFF' });
    return body + dot;
  }

  // ---------- 슬라이드 구성 ----------
  const rels = [{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
  const media = [];
  if (opts.baseDataUrl) {
    rels.push({ id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: '../media/image1.jpeg' });
    media.push({ name: 'ppt/media/image1.jpeg', data: dataUrlToBytes(opts.baseDataUrl) });
    shapes.push(pic('배경 항공사진', 'rId2', 0, 0, SW, SH));
  } else {
    shapes.push(prst('배경', 'rect', 0, 0, SW, SH, { fill: '#2A2A2A' }));
  }
  if (st.veil && st.veilOpacity > 0) shapes.push(prst('흰색 안개 레이어', 'rect', 0, 0, SW, SH, { fill: '#FFFFFF', fillAlpha: st.veilOpacity }));

  // 구역
  for (const a of scene.areas) {
    if (a.visible === false || !a.polys?.length) continue;
    const s = areaStyle(a, st);
    const fillHex = a.kind === 'industrial' ? st.industrialColor : a.kind === 'park' ? st.parkColor : a.kind === 'water' ? st.waterColor : '#FFFFFF';
    const fillAlpha = a.kind === 'industrial' ? 0.05 : a.kind === 'park' ? 0.16 : a.kind === 'water' ? 0.25 : 0.08;
    const strokeHex = a.kind === 'water' ? null : a.kind === 'park' ? st.parkColor : a.kind === 'industrial' ? st.industrialColor : (a.color || '#FFFFFF');
    shapes.push(freeform(`구역 ${a.name || a.kind}`, a.polys.map((r) => r.map((c) => P(c[0], c[1]))), { closed: true, fill: fillHex, fillAlpha, line: strokeHex, lineWidth: s.width || 1, dash: s.dash, lineAlpha: a.kind === 'park' ? 0.6 : 1 }));
  }
  // 도로
  for (const r of scene.roads) {
    if (r.visible === false) continue;
    const s = roadStroke(r, st);
    const paths = r.segments.map((seg) => seg.map((c) => P(c[0], c[1])));
    if (s.rail) {
      shapes.push(freeform(`철도 ${r.name}`, paths, { line: s.color, lineWidth: s.width }));
      shapes.push(freeform(`철도 ${r.name} (점선)`, paths, { line: '#FFFFFF', lineWidth: s.width * 0.45, dash: [8, 8] }));
    } else {
      shapes.push(freeform(`${s.water ? '하천' : '도로'} ${r.name}`, paths, { line: s.color, lineWidth: s.width, lineAlpha: 0.95 }));
    }
  }
  // 필지
  for (const pc of scene.site.parcels) {
    if (!pc.ring || pc.ring.length < 3) continue;
    const pts = [pc.ring.map((c) => P(c[0], c[1]))];
    if (pc.group === 'expansion') shapes.push(freeform(`증축부지 ${pc.jibun || ''}`, pts, { closed: true, fill: st.expansionColor, fillAlpha: 0.2, line: st.expansionColor, lineWidth: 2.2, dash: [7, 4] }));
    else if (pc.group === 'existing') shapes.push(freeform(`기존공장 ${pc.jibun || ''}`, pts, { closed: true, fill: st.existingColor, fillAlpha: 0.38, line: st.existingColor, lineWidth: 2.2 }));
    else shapes.push(freeform(`대지 ${pc.jibun || ''}`, pts, { closed: true, fill: st.siteColor, fillAlpha: 0.3, line: st.siteColor, lineWidth: 2.2 }));
  }
  // 반경 원 + 라벨
  if (center) {
    const [cx, cy] = P(center.lat, center.lng);
    for (const r of scene.rings) {
      if (r.visible === false || !(r.radius > 0)) continue;
      const [ex, ey] = P(center.lat, lngOffset(center.lat, center.lng, r.radius));
      const rp = Math.hypot(ex - cx, ey - cy);
      shapes.push(prst(`반경 ${r.radius}m`, 'ellipse', emu(cx - rp), emu(cy - rp), emu(rp * 2), emu(rp * 2), { line: st.ringColor, lineWidth: st.ringWidth, dash: [6, 5], lineAlpha: 0.85 }));
      if (r.label && !suppressed.has(`ring:${r.id}`)) shapes.push(textbox(`반경 라벨 ${r.label}`, r.label, ex + 2, ey, 10.5 * fs, { color: '#FFFFFF', glow: { radius: 2.5, alpha: 0.75 } }));
    }
  }

  // 인셋 (그룹)
  let insetGroup = '';
  if (scene.inset.enabled) {
    const ir = insetRect(scene, w, h, 1);
    const children = [];
    const gx = emu(ir.x), gy = emu(ir.y), gw = emu(ir.w), gh = emu(ir.h);
    if (opts.insetBaseDataUrl) {
      rels.push({ id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: '../media/image2.jpeg' });
      media.push({ name: 'ppt/media/image2.jpeg', data: dataUrlToBytes(opts.insetBaseDataUrl) });
      children.push(pic('인셋 항공사진', 'rId3', gx, gy, gw, gh));
    } else children.push(prst('인셋 배경', 'rect', gx, gy, gw, gh, { fill: '#333333' }));
    const IP0 = makeProjector(insetCenter(scene), scene.inset.zoom, ir.w, ir.h, 1);
    const IP = (lat, lng) => { const [x, y] = IP0(lat, lng); return [x + ir.x, y + ir.y]; };
    for (const pc of scene.site.parcels) {
      if (!pc.ring || pc.ring.length < 3) continue;
      const pts = [pc.ring.map((c) => IP(c[0], c[1]))];
      if (pc.group === 'expansion') children.push(freeform('인셋 증축부지', pts, { closed: true, fill: st.expansionColor, fillAlpha: 0.22, line: st.expansionColor, lineWidth: 2.5, dash: [7, 4] }));
      else if (pc.group === 'existing') children.push(freeform('인셋 기존공장', pts, { closed: true, fill: st.existingColor, fillAlpha: 0.4, line: st.existingColor, lineWidth: 2.5 }));
      else children.push(freeform('인셋 대지', pts, { closed: true, fill: st.siteColor, fillAlpha: 0.3, line: st.siteColor, lineWidth: 2.5 }));
    }
    if (scene.site.center) {
      const [x, y] = IP(scene.site.center.lat, scene.site.center.lng);
      const ps = scene.inset.mode === 'detail' ? 0.75 : 0.9;
      children.push(pin(x, y, ps, st.siteColor));
      children.push(textbox('인셋 SITE', 'SITE', x + 13 * ps, y - 20 * ps, 13 * ps, { color: st.siteColor, heavy: true, glow: { radius: 2.2, color: '#FFFFFF', alpha: 0.95 }, anchorLeft: true }));
    }
    const title = (scene.inset.title || '').trim();
    const tf = 11 * fs;
    if (title) {
      const { w: tw, h: th } = textBlockSize(title, tf, TWg.weight, TWg.boost);
      children.push(textbox('인셋 제목', title, ir.x + 6 + (tw + 14) / 2, ir.y + 6 + (th + 6) / 2, tf, { color: '#FFFFFF', bg: '#000000', bgAlpha: 0.75, padX: 7, padY: 3 }));
    }
    if (scene.inset.legend && scene.site.parcels.length) {
      const groups = new Set(scene.site.parcels.map((p) => p.group || 'site'));
      const items = [];
      if (groups.has('existing')) items.push({ label: '기존공장', fill: st.existingColor, fa: 0.7, dash: null });
      if (groups.has('expansion')) items.push({ label: '증축부지', fill: st.expansionColor, fa: 0.25, dash: [4, 3] });
      if (groups.has('site')) items.push({ label: '대지', fill: st.siteColor, fa: 0.5, dash: null });
      const lh = tf * 1.6, sw = 18, sh = tf * 0.95;
      let maxW = 0;
      for (const it of items) maxW = Math.max(maxW, measureText(it.label, tf * 0.95, TWg.weight) + TWg.boost * tf * 0.95);
      const bw = sw + maxW + 22, bh = items.length * lh + 8;
      const bx = ir.x + ir.w - bw - 6, by = ir.y + ir.h - bh - 6;
      children.push(prst('인셋 범례 배경', 'rect', emu(bx), emu(by), emu(bw), emu(bh), { fill: '#000000', fillAlpha: 0.65 }));
      items.forEach((it, i) => {
        const yy = by + 4 + i * lh + lh / 2;
        children.push(prst(`범례 ${it.label}`, 'rect', emu(bx + 7), emu(yy - sh / 2), emu(sw), emu(sh), { fill: it.fill, fillAlpha: it.fa, line: it.fill, lineWidth: 1.5, dash: it.dash }));
        children.push(textbox(`범례 ${it.label} 글자`, it.label, bx + 7 + sw + 6, yy, tf * 0.95, { color: '#FFFFFF', align: 'l', anchorLeft: true, padX: 0, padY: 0 }));
      });
    }
    children.push(prst('인셋 테두리', 'rect', gx, gy, gw, gh, { line: '#FFFFFF', lineWidth: 2 }));
    insetGroup = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id()}" name="위치도 인셋"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${gx}" y="${gy}"/><a:ext cx="${gw}" cy="${gh}"/><a:chOff x="${gx}" y="${gy}"/><a:chExt cx="${gw}" cy="${gh}"/></a:xfrm></p:grpSpPr>${children.join('')}</p:grpSp>`;
  }
  shapes.push(insetGroup);

  // 구역 라벨
  for (const a of scene.areas) {
    if (a.visible === false || a.label?.visible === false || !a.name || suppressed.has(`area:${a.id}`)) continue;
    const ll = areaLabelAnchor(a);
    if (!ll) continue;
    const s = areaStyle(a, st);
    const [x, y] = P(ll[0], ll[1]);
    const glowColor = a.kind === 'industrial' ? '#FFFFFF' : '#000000';
    shapes.push(textbox(`구역 라벨 ${a.name}`, a.name, x, y, (st.roadFontSize + s.fontDelta) * fs, { color: s.text, glow: { radius: 2.5, color: glowColor, alpha: 0.85 } }));
  }
  // 도로명 라벨
  if (st.showRoadLabels) {
    for (const r of scene.roads) {
      if (r.visible === false || !r.label?.pos || r.label.visible === false || suppressed.has(`road:${r.id}`)) continue;
      const s = roadStroke(r, st);
      const [x, y] = P(r.label.pos.lat, r.label.pos.lng);
      const rot = normalizeAngleDeg(r.label.angle || 0);
      if (s.major) {
        // 고속도로·간선도로: 배경 없이 글자만
        shapes.push(textbox(`도로명 ${r.name}`, r.label.text || r.name, x, y, st.roadFontSize * fs, { color: '#FFFFFF', glow: { radius: 2.5, alpha: 0.75 }, rot }));
        continue;
      }
      const { bg, fg } = roadLabelColors(s);
      shapes.push(textbox(`도로명 ${r.name}`, r.label.text || r.name, x, y, st.roadFontSize * fs, { color: fg, bg, rounded: true, padX: 6, padY: 2.5, rot }));
    }
  }
  // 기업·시설 라벨
  if (st.showPoiLabels) {
    for (const p of scene.pois) {
      if (p.visible === false || suppressed.has(`poi:${p.id}`)) continue;
      const [lat, lng] = poiLabelLatLng(p);
      const [x, y] = P(lat, lng);
      const [ax, ay] = P(p.anchor.lat, p.anchor.lng);
      const kind = POI_KINDS[p.kind] || POI_KINDS.company;
      const color = p.color || kind.color;
      if (st.labelMode === 'box') shapes.push(textbox(`라벨 ${p.name}`, p.name, x, y, st.poiFontSize * fs, { color, bg: '#000000', bgAlpha: 0.6, rounded: true, padX: 5, padY: 2.5 }));
      else shapes.push(textbox(`라벨 ${p.name}`, p.name, x, y, st.poiFontSize * fs, { color, glow: { radius: 2.5, alpha: 0.75 } }));
    }
  }
  // SITE
  if (scene.site.center) {
    const [x, y] = P(scene.site.center.lat, scene.site.center.lng);
    const size = st.siteFontSize * fs;
    if (scene.site.pinVisible !== false) {
      const ps = (size / 20) * 1.1;
      shapes.push(pin(x, y, ps, st.siteColor));
      shapes.push(textbox('SITE', 'SITE', x + 14 * ps, y - 20 * ps, size, { color: st.siteColor, heavy: true, glow: { radius: 3, color: '#FFFFFF', alpha: 0.95 }, anchorLeft: true }));
    }
    if (scene.site.name && scene.site.label?.visible !== false) {
      const lp = scene.site.label?.pos;
      const [lx, ly] = lp ? P(lp.lat, lp.lng) : [x, y + 15];
      shapes.push(textbox('대지 명칭', scene.site.name, lx, ly, size * 0.6, { color: '#FFFFFF', bg: '#000000', bgAlpha: 0.72, rounded: true, padX: 7, padY: 3 }));
    }
  }

  // ---------- 패키지 ----------
  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const relsXml = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const title = scene.meta?.name || '대지분석도';

  const files = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>SiteDiagram</dc:creator><cp:lastModifiedBy>SiteDiagram</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SiteDiagram</Application><Slides>1</Slides><PresentationFormat>Custom</PresentationFormat></Properties>` },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: relsXml([
      { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', target: 'slideMasters/slideMaster1.xml' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', target: 'slides/slide1.xml' },
      { id: 'rId3', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps', target: 'presProps.xml' },
      { id: 'rId4', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps', target: 'viewProps.xml' },
      { id: 'rId5', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', target: 'theme/theme1.xml' },
      { id: 'rId6', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles', target: 'tableStyles.xml' },
    ]) },
    { name: 'ppt/presProps.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentationPr ${NS}/>` },
    { name: 'ppt/viewProps.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` },
    { name: 'ppt/tableStyles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: SLIDE_MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relsXml([
      { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', target: '../theme/theme1.xml' },
    ]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: SLIDE_LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relsXml([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', target: '../slideMasters/slideMaster1.xml' }]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    { name: 'ppt/slides/slide1.xml', data: slideXml },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: relsXml(rels) },
    ...media.map((m) => ({ ...m, store: true })),
  ];
  return buildZip(files, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="2800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SiteDiagram"><a:themeElements><a:clrScheme name="SiteDiagram"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="19C3FF"/></a:accent1><a:accent2><a:srgbClr val="FF2D87"/></a:accent2><a:accent3><a:srgbClr val="FFD400"/></a:accent3><a:accent4><a:srgbClr val="5CE65C"/></a:accent4><a:accent5><a:srgbClr val="B06CFF"/></a:accent5><a:accent6><a:srgbClr val="FF8A3D"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="SiteDiagram"><a:majorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="맑은 고딕"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="SiteDiagram"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
