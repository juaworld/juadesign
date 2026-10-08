// 라벨 측정·충돌 회피 자동 배치
export const FONT_STACK = '"Pretendard", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", "Nanum Gothic", sans-serif';

let _canvas = null;
function ctx2d() {
  if (!_canvas) {
    _canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(10, 10) : document.createElement('canvas');
  }
  return _canvas.getContext('2d');
}

const _cache = new Map();
/** 텍스트 폭(px) 측정 — 폰트 크기·굵기별 캐시 */
export function measureText(text, sizePx, weight = 700) {
  const key = `${weight}|${sizePx}|${text}`;
  let w = _cache.get(key);
  if (w == null) {
    const c = ctx2d();
    c.font = `${weight} ${sizePx}px ${FONT_STACK}`;
    w = c.measureText(text).width;
    if (_cache.size > 5000) _cache.clear();
    _cache.set(key, w);
  }
  return w;
}

export function rectsOverlap(a, b, pad = 0) {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

/**
 * 점 라벨 자동 배치.
 * items: [{id, ax, ay, w, h, priority}] (anchor 픽셀, 라벨 박스 크기)
 * obstacles: [{x,y,w,h}] 이미 차지된 영역
 * frame: {w,h}
 * 반환: Map(id → {x,y}) 라벨 박스 중심 좌표
 */
export function placePointLabels(items, obstacles, frame, opts = {}) {
  const gap = opts.gap ?? 8;
  const placed = obstacles.map((o) => ({ ...o }));
  const result = new Map();
  const sorted = items.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const it of sorted) {
    const { w, h } = it;
    // 1순위: 건물(앵커) 위에 그대로 → 8방향 × 3단계 거리
    const cands = [[it.ax - w / 2, it.ay - h / 2]];
    for (const d of [gap, gap * 2.6, gap * 4.6]) {
      cands.push(
        [it.ax + d, it.ay - h / 2], // 우
        [it.ax - w - d, it.ay - h / 2], // 좌
        [it.ax - w / 2, it.ay - h - d], // 상
        [it.ax - w / 2, it.ay + d], // 하
        [it.ax + d * 0.75, it.ay - h - d * 0.6], // 우상
        [it.ax + d * 0.75, it.ay + d * 0.6], // 우하
        [it.ax - w - d * 0.75, it.ay - h - d * 0.6], // 좌상
        [it.ax - w - d * 0.75, it.ay + d * 0.6], // 좌하
      );
    }
    let best = null, bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const [x, y] = cands[i];
      const box = { x, y, w, h };
      let score = i; // 선호 순서 가중
      if (x < 2 || y < 2 || x + w > frame.w - 2 || y + h > frame.h - 2) score += 1e5;
      for (const p of placed) {
        const ov = overlapArea(box, p);
        if (ov > 0) score += 1000 + ov;
        else if (rectsOverlap(box, p, opts.pad ?? 3)) score += 300; // 너무 붙음
      }
      if (score < bestScore) { bestScore = score; best = box; }
      if (score === i) break; // 완벽한 후보
    }
    const collides = bestScore >= 1000;
    if (!collides) placed.push(best);
    result.set(it.id, { x: best.x + best.w / 2, y: best.y + best.h / 2, box: best, collides });
  }
  return result;
}

/**
 * 선형(도로) 라벨 위치 후보: 프레임 안쪽 폴리라인의 가장 긴 구간에서 1/2, 1/3, 2/3 지점
 * pts: [[x,y]...] 픽셀 좌표
 */
/** 선분을 사각형으로 클리핑 (Liang–Barsky). 반환 null 또는 [p0, p1] */
function clipSegment(a, b, xmin, ymin, xmax, ymax) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const checks = [[-dx, a[0] - xmin], [dx, xmax - a[0]], [-dy, a[1] - ymin], [dy, ymax - a[1]]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

export function lineLabelCandidates(pts, frame, margin = 30) {
  // 프레임(여백 적용) 내부로 클리핑한 연속 구간으로 분리
  const runs = [];
  let cur = [];
  for (let i = 1; i < pts.length; i++) {
    const c = clipSegment(pts[i - 1], pts[i], margin, margin, frame.w - margin, frame.h - margin);
    if (!c) { if (cur.length) { runs.push(cur); cur = []; } continue; }
    if (!cur.length) cur.push(c[0]);
    else {
      const last = cur[cur.length - 1];
      if (Math.hypot(last[0] - c[0][0], last[1] - c[0][1]) > 0.5) { runs.push(cur); cur = [c[0]]; }
    }
    cur.push(c[1]);
  }
  if (cur.length) runs.push(cur);
  const len = (run) => {
    let d = 0;
    for (let i = 1; i < run.length; i++) d += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    return d;
  };
  runs.sort((a, b) => len(b) - len(a));
  const out = [];
  for (const run of runs.slice(0, 2)) {
    if (run.length < 2) continue;
    const total = len(run);
    for (const frac of [0.5, 0.33, 0.67, 0.2, 0.8]) {
      const target = total * frac;
      let acc = 0;
      for (let i = 1; i < run.length; i++) {
        const seg = Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
        if (acc + seg >= target || i === run.length - 1) {
          const t = seg > 0 ? Math.min(1, Math.max(0, (target - acc) / seg)) : 0;
          const x = run[i - 1][0] + (run[i][0] - run[i - 1][0]) * t;
          const y = run[i - 1][1] + (run[i][1] - run[i - 1][1]) * t;
          const angle = (Math.atan2(run[i][1] - run[i - 1][1], run[i][0] - run[i - 1][0]) * 180) / Math.PI;
          out.push({ x, y, angle, runLength: total });
          break;
        }
        acc += seg;
      }
    }
  }
  return out;
}

/** 회전된 박스를 감싸는 축정렬 사각형 */
export function rotatedBox(cx, cy, w, h, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const bw = w * c + h * s, bh = w * s + h * c;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}
