// 공용 레이아웃 계산 (인셋 위치·크기, 배경 필터)
import { siteCenter } from '../core/scene.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function filterCss(st) {
  return `grayscale(${st.grayscale}) brightness(${st.brightness}) contrast(${st.contrast})`;
}

export function insetFilterCss(st) {
  // 인셋은 조금 더 밝고 컬러감 있게
  return `grayscale(${Math.max(0, st.grayscale - 0.5)}) brightness(${Math.min(1.15, st.brightness + 0.2)}) contrast(${st.contrast})`;
}

export function insetFilterStyle(st) {
  return { grayscale: Math.max(0, st.grayscale - 0.5), brightness: Math.min(1.15, st.brightness + 0.2), contrast: st.contrast };
}

/** 인셋 사각형(출력 px). k = 출력 배율 */
export function insetRect(scene, W, H, k) {
  const size = clamp(scene.inset.size || 0.24, 0.1, 0.5);
  const iw = Math.round(W * size), ih = Math.round(iw * 0.9);
  const m = Math.round(Math.max(8, W * 0.012));
  const pos = scene.inset.pos || 'tl';
  const x = pos.endsWith('r') ? W - m - iw : m;
  const y = pos.startsWith('b') ? H - m - ih : m;
  return { x, y, w: iw, h: ih, border: Math.max(1.5, 2 * k) };
}

export function insetCenter(scene) {
  return scene.inset.center || siteCenter(scene);
}
