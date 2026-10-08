// 고해상도 래스터 합성: 타일 재취득(+필터) → 오버레이 SVG 래스터화 → 인셋
import { TILE, project } from '../core/geo.js';
import { renderOverlay, renderInsetOverlay, wrapSvgDocument } from './svg.js';
import { filterCss, insetFilterCss, insetFilterStyle, insetRect, insetCenter } from './layout.js';
export { filterCss, insetFilterCss, insetRect, insetCenter };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 출력 좌표계 투영 함수 */
export function makeProjector(center, zoom, w, h, k) {
  const [cx, cy] = project(center.lat, center.lng, zoom);
  return (lat, lng) => {
    const [x, y] = project(lat, lng, zoom);
    return [(x - cx + w / 2) * k, (y - cy + h / 2) * k];
  };
}

export function loadImage(url, cors) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/** CSS filter 미지원 캔버스용 픽셀 폴백 */
function applyFilterFallback(ctx, W, H, st) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const g = clamp(st.grayscale, 0, 1), b = st.brightness, c = st.contrast;
  const ig = 1 - g;
  const m = [0.2126 + 0.7874 * ig, 0.7152 - 0.7152 * ig, 0.0722 - 0.0722 * ig, 0.2126 - 0.2126 * ig, 0.7152 + 0.2848 * ig, 0.0722 - 0.0722 * ig, 0.2126 - 0.2126 * ig, 0.7152 - 0.7152 * ig, 0.0722 + 0.9278 * ig];
  const icpt = 255 * 0.5 * (1 - c);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], bb = d[i + 2];
    let nr = m[0] * r + m[1] * gg + m[2] * bb;
    let ng = m[3] * r + m[4] * gg + m[5] * bb;
    let nb = m[6] * r + m[7] * gg + m[8] * bb;
    nr = nr * b * c + icpt; ng = ng * b * c + icpt; nb = nb * b * c + icpt;
    d[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    d[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    d[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * 타일을 캔버스에 합성. 반환: 실패 타일 수
 * opts: { center, zoom, w, h, k, tileUrl, tileMaxZoom, style(필터용), filter(css), onProgress }
 */
export async function drawTiles(ctx, opts) {
  const { center, zoom, w, h, k, tileUrl, tileMaxZoom = 19, onProgress } = opts;
  const W = Math.round(w * k), H = Math.round(h * k);
  const zEff = zoom + Math.log2(k);
  const tz = clamp(Math.round(zEff), 0, tileMaxZoom);
  const s = Math.pow(2, zEff - tz);
  const [cx, cy] = project(center.lat, center.lng, tz);
  const tlx = cx - W / 2 / s, tly = cy - H / 2 / s;
  const brx = cx + W / 2 / s, bry = cy + H / 2 / s;
  const n = Math.pow(2, tz);
  const x0 = Math.floor(tlx / TILE), x1 = Math.floor((brx - 0.001) / TILE);
  const y0 = clamp(Math.floor(tly / TILE), 0, n - 1), y1 = clamp(Math.floor((bry - 0.001) / TILE), 0, n - 1);
  const jobs = [];
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) jobs.push({ tx, ty });
  const supportsFilter = 'filter' in ctx;
  ctx.save();
  if (opts.filter && supportsFilter) ctx.filter = opts.filter;
  let done = 0, failed = 0;
  await pool(jobs, 8, async ({ tx, ty }) => {
    const img = await loadImage(tileUrl((((tx % n) + n) % n), ty, tz), true);
    if (img) {
      const dx = (tx * TILE - tlx) * s, dy = (ty * TILE - tly) * s, sz = TILE * s;
      ctx.drawImage(img, dx, dy, sz + 0.7, sz + 0.7);
    } else failed++;
    done++;
    onProgress && onProgress(done / jobs.length);
  });
  ctx.restore();
  // CORS 오염 검사
  try { ctx.getImageData(0, 0, 1, 1); } catch (e) {
    const err = new Error('CORS');
    err.code = 'TAINTED';
    throw err;
  }
  if (failed === jobs.length && jobs.length) {
    const err = new Error('배경 타일을 하나도 불러오지 못했습니다 (키·네트워크·CORS 확인)');
    err.code = 'TILES_FAILED';
    throw err;
  }
  if (opts.filter && !supportsFilter && opts.style) applyFilterFallback(ctx, W, H, opts.style);
  return { failed, total: jobs.length, tz };
}

export async function drawSvgOnto(ctx, svgStr, x, y, W, H) {
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url, false);
    if (!img) throw new Error('오버레이 SVG 래스터화 실패');
    ctx.drawImage(img, x, y, W, H);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 전체 합성. 반환 { canvas, baseDataUrl? }
 * opts: { scene, center, zoom, w, h, k, tileUrl, tileMaxZoom, onProgress, withOverlay=true, keepBase=false }
 */
export async function renderComposite(opts) {
  const { scene, center, zoom, w, h, k, tileUrl, tileMaxZoom, onProgress } = opts;
  const st = scene.style;
  const W = Math.round(w * k), H = Math.round(h * k);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, H);
  onProgress && onProgress('배경 타일 합성 중…', 0);
  const base = await drawTiles(ctx, { center, zoom, w, h, k, tileUrl, tileMaxZoom, filter: filterCss(st), style: st, onProgress: (p) => onProgress && onProgress('배경 타일 합성 중…', p * 0.7) });

  let baseDataUrl = null;
  if (opts.keepBase) baseDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // 인셋 배경 (별도 캔버스)
  let insetSvg = null, ir = null, insetBaseDataUrl = null;
  if (scene.inset.enabled) {
    ir = insetRect(scene, W, H, k);
    const ic = document.createElement('canvas');
    ic.width = ir.w; ic.height = ir.h;
    const ictx = ic.getContext('2d');
    ictx.fillStyle = '#222'; ictx.fillRect(0, 0, ir.w, ir.h);
    const icen = insetCenter(scene);
    onProgress && onProgress('인셋 합성 중…', 0.72);
    await drawTiles(ictx, { center: icen, zoom: scene.inset.zoom, w: ir.w / k, h: ir.h / k, k, tileUrl, tileMaxZoom, filter: insetFilterCss(st), style: insetFilterStyle(st) });
    if (opts.keepBase) insetBaseDataUrl = ic.toDataURL('image/jpeg', 0.92);
    const P = makeProjector(icen, scene.inset.zoom, ir.w / k, ir.h / k, k);
    insetSvg = renderInsetOverlay(scene, { project: P, W: ir.w, H: ir.h, k, interactive: false });
    if (opts.withOverlay !== false) await drawSvgOnto(ictx, wrapSvgDocument(insetSvg, ir.w, ir.h), 0, 0, ir.w, ir.h);
    ctx.drawImage(ic, ir.x, ir.y);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = ir.border;
    ctx.strokeRect(ir.x - ir.border / 2, ir.y - ir.border / 2, ir.w + ir.border, ir.h + ir.border);
  }

  let overlaySvg = null;
  if (opts.withOverlay !== false) {
    onProgress && onProgress('라벨·도형 그리는 중…', 0.85);
    const P = makeProjector(center, zoom, w, h, k);
    overlaySvg = renderOverlay(scene, { project: P, W, H, k, interactive: false });
    await drawSvgOnto(ctx, wrapSvgDocument(overlaySvg, W, H), 0, 0, W, H);
  }
  onProgress && onProgress('완료', 1);
  return { canvas, W, H, baseDataUrl, insetBaseDataUrl, insetRect: ir, insetSvg, overlaySvg, tileInfo: base };
}

/** SVG 문서 생성 (배경 이미지 포함 가능) */
export function buildSvgDocument({ W, H, k, overlaySvg, baseDataUrl, insetRect: ir, insetSvg, insetBaseDataUrl, includeBackground }) {
  let inner = '';
  if (includeBackground && baseDataUrl) inner += `<image x="0" y="0" width="${W}" height="${H}" href="${baseDataUrl}" preserveAspectRatio="none"/>`;
  else inner += `<rect width="${W}" height="${H}" fill="#1a1a1a"/>`;
  if (ir) {
    inner += `<svg x="${ir.x}" y="${ir.y}" width="${ir.w}" height="${ir.h}" viewBox="0 0 ${ir.w} ${ir.h}">`;
    if (includeBackground && insetBaseDataUrl) inner += `<image x="0" y="0" width="${ir.w}" height="${ir.h}" href="${insetBaseDataUrl}" preserveAspectRatio="none"/>`;
    else inner += `<rect width="${ir.w}" height="${ir.h}" fill="#2a2a2a"/>`;
    inner += insetSvg || '';
    inner += '</svg>';
    inner += `<rect x="${ir.x - ir.border / 2}" y="${ir.y - ir.border / 2}" width="${ir.w + ir.border}" height="${ir.h + ir.border}" fill="none" stroke="#FFFFFF" stroke-width="${ir.border}"/>`;
  }
  inner += overlaySvg || '';
  return wrapSvgDocument(inner, W, H);
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 인코딩 실패'))), type, quality));
}
