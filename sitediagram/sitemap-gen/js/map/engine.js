// 경량 슬리피 맵 엔진 (외부 의존성 없음): 타일 표시, 팬/줌, 오버레이 SVG 컨테이너
import { TILE, project, unproject, metersPerPixel } from '../core/geo.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SlippyMap {
  constructor(el, opts = {}) {
    this.el = el;
    el.classList.add('smap');
    this.center = { ...(opts.center || { lat: 37.5, lng: 127 }) };
    this.zoom = opts.zoom ?? 14;
    this.minZoom = opts.minZoom ?? 5;
    this.maxZoom = opts.maxZoom ?? 20;
    this.tileMaxZoom = opts.tileMaxZoom ?? 19;
    this.tileUrl = opts.tileUrl || (() => '');
    this.crossOrigin = !!opts.crossOrigin;
    this.interactive = opts.interactive !== false;
    this.dblclickZoom = true;
    this._levels = new Map();
    this._listeners = {};
    this._overlayUrl = null;

    this.tilesEl = document.createElement('div');
    this.tilesEl.className = 'smap-tiles';
    this.overlayTilesEl = document.createElement('div');
    this.overlayTilesEl.className = 'smap-tiles smap-tiles-overlay';
    this.overlayTilesEl.style.display = 'none';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'smap-overlay');
    el.appendChild(this.tilesEl);
    el.appendChild(this.overlayTilesEl);
    el.appendChild(this.svg);

    if (opts.filter) this.setFilter(opts.filter);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.render());
      this._ro.observe(el);
    }
    if (this.interactive) this._bindInteractions();
    this.render();
  }

  // ---------- 이벤트 ----------
  on(name, fn) { (this._listeners[name] ||= []).push(fn); return this; }
  off(name, fn) { this._listeners[name] = (this._listeners[name] || []).filter((f) => f !== fn); }
  emit(name, payload) { for (const fn of this._listeners[name] || []) fn(payload); }

  // ---------- 좌표 ----------
  getSize() { return [this.el.clientWidth, this.el.clientHeight]; }

  latLngToContainer(lat, lng, zoom = this.zoom, center = this.center) {
    const [cx, cy] = project(center.lat, center.lng, zoom);
    const [x, y] = project(lat, lng, zoom);
    const [w, h] = this.getSize();
    return [x - cx + w / 2, y - cy + h / 2];
  }

  containerToLatLng(px, py) {
    const [cx, cy] = project(this.center.lat, this.center.lng, this.zoom);
    const [w, h] = this.getSize();
    const [lat, lng] = unproject(cx + px - w / 2, cy + py - h / 2, this.zoom);
    return { lat, lng };
  }

  getBounds() {
    const [w, h] = this.getSize();
    const nw = this.containerToLatLng(0, 0);
    const se = this.containerToLatLng(w, h);
    return { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
  }

  metersPerPixel() { return metersPerPixel(this.center.lat, this.zoom); }

  // ---------- 뷰 조작 ----------
  setView(center, zoom, opts = {}) {
    if (center) this.center = { lat: center.lat, lng: center.lng };
    if (zoom != null) this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.render();
    if (!opts.silent) { this.emit('move'); this._scheduleMoveEnd(); }
  }

  panBy(dx, dy) {
    const [cx, cy] = project(this.center.lat, this.center.lng, this.zoom);
    const [lat, lng] = unproject(cx + dx, cy + dy, this.zoom);
    this.center = { lat, lng };
    this.render();
    this.emit('move');
  }

  zoomAround(px, py, dz) {
    const nz = clamp(this.zoom + dz, this.minZoom, this.maxZoom);
    if (nz === this.zoom) return;
    const ll = this.containerToLatLng(px, py);
    const [w, h] = this.getSize();
    const [nx, ny] = project(ll.lat, ll.lng, nz);
    // 커서 아래 지점이 고정되도록 중심 재계산
    const [lat, lng] = unproject(nx - (px - w / 2), ny - (py - h / 2), nz);
    this.zoom = nz;
    this.center = { lat, lng };
    this.render();
    this.emit('move');
    this._scheduleMoveEnd();
  }

  setTileSource(fn, opts = {}) {
    this.tileUrl = fn;
    if (opts.tileMaxZoom) this.tileMaxZoom = opts.tileMaxZoom;
    this.crossOrigin = !!opts.crossOrigin;
    this._clearLevels(this.tilesEl, this._levels);
    this.render();
  }

  /** 상위 라벨 타일(하이브리드) 설정. null이면 숨김 */
  setOverlayTileSource(fn) {
    this._overlayUrl = fn;
    this._clearLevels(this.overlayTilesEl, (this._overlayLevels = new Map()));
    this.overlayTilesEl.style.display = fn ? '' : 'none';
    this.render();
  }

  setFilter(css) { this.tilesEl.style.filter = css || ''; }

  // ---------- 렌더 ----------
  _clearLevels(container, levels) {
    for (const lv of levels.values()) lv.el.remove();
    levels.clear();
  }

  render() {
    const [w, h] = this.getSize();
    if (!w || !h) return;
    this._renderLevels(this.tilesEl, this._levels, this.tileUrl, w, h);
    if (this._overlayUrl) {
      this._overlayLevels ||= new Map();
      this._renderLevels(this.overlayTilesEl, this._overlayLevels, this._overlayUrl, w, h);
    }
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.emit('render');
  }

  _renderLevels(container, levels, urlFn, w, h) {
    const z = this.zoom;
    const tz = clamp(Math.round(z), 0, this.tileMaxZoom);
    const n = Math.pow(2, tz);
    let level = levels.get(tz);
    if (!level) {
      const el = document.createElement('div');
      el.className = 'smap-level';
      container.appendChild(el);
      level = { z: tz, el, tiles: new Map(), origin: null, pending: 0 };
      levels.set(tz, level);
    }
    // 현재 레벨 타일 범위
    const s = Math.pow(2, z - tz);
    const [cx, cy] = project(this.center.lat, this.center.lng, tz);
    const tlx = cx - w / 2 / s, tly = cy - h / 2 / s;
    const brx = cx + w / 2 / s, bry = cy + h / 2 / s;
    const x0 = Math.floor(tlx / TILE), x1 = Math.floor((brx - 0.001) / TILE);
    const y0 = clamp(Math.floor(tly / TILE), 0, n - 1), y1 = clamp(Math.floor((bry - 0.001) / TILE), 0, n - 1);
    if (!level.origin) level.origin = [x0 * TILE, y0 * TILE];
    const [ox, oy] = level.origin;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const key = `${tx}/${ty}`;
        if (level.tiles.has(key)) continue;
        const img = document.createElement('img');
        img.className = 'smap-tile';
        img.draggable = false;
        img.alt = '';
        if (this.crossOrigin) img.crossOrigin = 'anonymous';
        img.style.left = `${tx * TILE - ox}px`;
        img.style.top = `${ty * TILE - oy}px`;
        const wx = ((tx % n) + n) % n; // 경도 랩
        level.pending++;
        img.onload = () => { level.pending--; img.classList.add('loaded'); this._pruneLevels(levels, tz); };
        img.onerror = () => { level.pending--; img.style.visibility = 'hidden'; this._pruneLevels(levels, tz); };
        img.src = urlFn(wx, ty, tz);
        level.el.appendChild(img);
        level.tiles.set(key, img);
      }
    }
    // 범위 밖 타일 제거 (여유 2타일)
    for (const [key, img] of level.tiles) {
      const [tx, ty] = key.split('/').map(Number);
      if (tx < x0 - 2 || tx > x1 + 2 || ty < y0 - 2 || ty > y1 + 2) { img.remove(); level.tiles.delete(key); }
    }
    // 모든 레벨 위치 갱신
    for (const lv of levels.values()) {
      const ls = Math.pow(2, z - lv.z);
      const [lcx, lcy] = project(this.center.lat, this.center.lng, lv.z);
      const ltlx = lcx - w / 2 / ls, ltly = lcy - h / 2 / ls;
      const [lox, loy] = lv.origin || [0, 0];
      lv.el.style.transform = `translate(${(lox - ltlx) * ls}px, ${(loy - ltly) * ls}px) scale(${ls})`;
      lv.el.style.zIndex = lv.z === tz ? 2 : 1;
    }
    this._pruneLevels(levels, tz);
  }

  _pruneLevels(levels, tz) {
    const cur = levels.get(tz);
    if (!cur || cur.pending > 0) return;
    for (const [z, lv] of levels) {
      if (z !== tz) { lv.el.remove(); levels.delete(z); }
    }
  }

  // ---------- 인터랙션 ----------
  _bindInteractions() {
    const el = this.el;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      this.emit('movestart');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      this.panBy(-dx, -dy);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      el.classList.remove('dragging');
      const moved = drag.moved;
      drag = null;
      if (moved) this._scheduleMoveEnd(0);
      else {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        this.emit('click', { ...this.containerToLatLng(px, py), px, py, originalEvent: e });
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      let dz = -e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0028);
      dz = clamp(dz, -0.6, 0.6);
      this.zoomAround(e.clientX - r.left, e.clientY - r.top, dz);
    }, { passive: false });
    el.addEventListener('dblclick', (e) => {
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      this.emit('dblclick', { ...this.containerToLatLng(px, py), px, py, originalEvent: e });
      if (this.dblclickZoom) this.zoomAround(px, py, 1);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      this.emit('contextmenu', { ...this.containerToLatLng(px, py), px, py, originalEvent: e });
    });
  }

  _scheduleMoveEnd(delay = 120) {
    clearTimeout(this._moveEndTimer);
    this._moveEndTimer = setTimeout(() => this.emit('moveend'), delay);
  }
}
