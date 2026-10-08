// 라이브 미리보기: 메인 지도 + 인셋, 오버레이 렌더·라벨 드래그·선택
import { SlippyMap } from './engine.js';
import { renderOverlay, renderInsetOverlay } from '../render/svg.js';
import { filterCss, insetFilterCss, insetRect, insetCenter } from '../render/layout.js';
import { project, unproject } from '../core/geo.js';

export class LiveView {
  constructor(app, mapEl, insetEl) {
    this.app = app;
    this.mapEl = mapEl;
    this.insetEl = insetEl;
    const sc = app.scene;
    this.map = new SlippyMap(mapEl, {
      center: sc.view.center,
      zoom: sc.view.zoom,
      tileUrl: () => '',
      maxZoom: 21,
      interactive: true,
    });
    this.inset = new SlippyMap(insetEl, {
      center: insetCenter(sc),
      zoom: sc.inset.zoom,
      tileUrl: () => '',
      interactive: false,
    });
    this.svg = this.map.svg;
    this.renderState = null;
    this._raf = null;

    this.map.on('render', () => this._onMapRender());
    this.map.on('moveend', () => {
      sc.view.center = { ...this.map.center };
      sc.view.zoom = this.map.zoom;
      this.app.onViewChanged();
      this.renderOverlay();
    });
    this.map.on('click', (e) => this.app.onMapClick(e));
    this.map.on('dblclick', (e) => this.app.onMapDblClick(e));
    this.map.on('contextmenu', (e) => this.app.onMapContextMenu(e));
    this._bindLabelDrag();
    this.applyBase();
    this.applyFilter();
  }

  /** 베이스 타일 소스 적용 */
  applyBase() {
    const src = this.app.tileSource();
    this.map.setTileSource(src.url, { tileMaxZoom: src.maxZoom, crossOrigin: false });
    this.inset.setTileSource(src.url, { tileMaxZoom: src.maxZoom, crossOrigin: false });
    const hyb = this.app.scene.style.hybridLabels ? this.app.tileSource('vworld-hybrid') : null;
    this.map.setOverlayTileSource(hyb && hyb.available ? hyb.url : null);
  }

  applyFilter() {
    const st = this.app.scene.style;
    this.map.setFilter(filterCss(st));
    this.inset.setFilter(insetFilterCss(st));
  }

  _onMapRender() {
    // 팬/줌 도중: 마지막 렌더 기준 변환으로 즉시 반응, 끝나면 재렌더
    const rs = this.renderState;
    if (!rs) { this.renderOverlay(); return; }
    const [w, h] = this.map.getSize();
    const sc = Math.pow(2, this.map.zoom - rs.zoom);
    const [cx, cy] = this.map.latLngToContainer(rs.center.lat, rs.center.lng);
    const tx = cx - sc * (rs.w / 2), ty = cy - sc * (rs.h / 2);
    this.svg.style.transformOrigin = '0 0';
    this.svg.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
    if (rs.w !== w || rs.h !== h) this.scheduleRender();
  }

  scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.renderOverlay(); });
  }

  renderOverlay() {
    const [w, h] = this.map.getSize();
    if (!w || !h) return;
    const sc = this.app.scene;
    const ctx = {
      project: (lat, lng) => this.map.latLngToContainer(lat, lng),
      W: w, H: h, k: 1,
      interactive: true,
      selectedId: this.app.selectedId,
      draft: this.app.draft,
    };
    this.svg.style.transform = '';
    this.svg.innerHTML = renderOverlay(sc, ctx);
    this.app.suppressed = renderOverlay.lastSuppressed;
    this.app.suppressedReasons = renderOverlay.lastReasons;
    this.renderState = { center: { ...this.map.center }, zoom: this.map.zoom, w, h };
    this.renderInset();
    this.app.ui && this.app.ui.updateSuppressed && this.app.ui.updateSuppressed();
  }

  renderInset() {
    const sc = this.app.scene;
    const [W] = this.map.getSize();
    const [, H] = this.map.getSize();
    if (!sc.inset.enabled || !W) { this.insetEl.style.display = 'none'; return; }
    const ir = insetRect(sc, W, H, 1);
    this.insetEl.style.display = '';
    this.insetEl.style.left = ir.x + 'px';
    this.insetEl.style.top = ir.y + 'px';
    this.insetEl.style.width = ir.w + 'px';
    this.insetEl.style.height = ir.h + 'px';
    this.inset.setView(insetCenter(sc), sc.inset.zoom, { silent: true });
    const [iw, ih] = this.inset.getSize();
    if (!iw) return;
    this.inset.svg.innerHTML = renderInsetOverlay(sc, {
      project: (lat, lng) => this.inset.latLngToContainer(lat, lng),
      W: iw, H: ih, k: 1, interactive: false,
    });
  }

  /** 라벨 드래그 & 선택 */
  _bindLabelDrag() {
    const svg = this.svg;
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-drag]');
      if (!g || e.button !== 0) return;
      if (this.app.mode !== 'pan' && this.app.mode !== 'select') return;
      e.stopPropagation();
      e.preventDefault();
      const id = g.dataset.drag;
      drag = { id, g, sx: e.clientX, sy: e.clientY, ox: parseFloat(g.dataset.x), oy: parseFloat(g.dataset.y), moved: false, pid: e.pointerId, base: g.getAttribute('transform') || '' };
      svg.setPointerCapture(e.pointerId);
      this.app.select(id);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 2) return;
      drag.moved = true;
      drag.g.setAttribute('transform', `translate(${dx} ${dy}) ${drag.base}`);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const d = drag; drag = null;
      if (d.moved) {
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        const ll = this.map.containerToLatLng(d.ox + dx, d.oy + dy);
        this.app.moveLabel(d.id, ll);
      } else {
        this.renderOverlay();
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', (e) => {
      const g = e.target.closest('[data-drag]');
      if (!g) return;
      e.stopPropagation();
      e.preventDefault();
      this.app.editLabel(g.dataset.drag);
    });
    svg.addEventListener('contextmenu', (e) => {
      const g = e.target.closest('[data-drag]');
      if (!g) return;
      e.stopPropagation();
      e.preventDefault();
      this.app.toggleHide(g.dataset.drag);
    });
  }

  /** 프레임 비율에 맞춰 지도 컨테이너 크기 조정 */
  applyAspect() {
    const wrap = this.mapEl.parentElement;
    const aspect = this.app.scene.view.aspect || '16:9';
    const cs = getComputedStyle(wrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const avail = [wrap.clientWidth - padX, wrap.clientHeight - padY];
    let ratio = null;
    if (aspect === '16:9') ratio = 16 / 9;
    else if (aspect === '4:3') ratio = 4 / 3;
    else if (aspect === '3:2') ratio = 3 / 2;
    else if (aspect === 'A3') ratio = 420 / 297;
    else if (aspect === '1:1') ratio = 1;
    if (!ratio) { this.mapEl.style.width = '100%'; this.mapEl.style.height = '100%'; return; }
    let w = avail[0], h = w / ratio;
    if (h > avail[1]) { h = avail[1]; w = h * ratio; }
    this.mapEl.style.width = Math.floor(w) + 'px';
    this.mapEl.style.height = Math.floor(h) + 'px';
  }

  /** 뷰 중심을 대지로 */
  centerOnSite(zoom) {
    const c = this.app.scene.site.center || this.app.scene.view.center;
    this.map.setView(c, zoom ?? this.map.zoom);
  }

  /** 가장 큰 반경이 프레임에 들어오는 줌 계산 */
  fitRadius(radiusM, padding = 1.15) {
    const [w, h] = this.map.getSize();
    const c = this.app.scene.site.center || this.app.scene.view.center;
    const mppNeeded = (radiusM * 2 * padding) / Math.min(w, h);
    const zoom = Math.log2((156543.03392804097 * Math.cos((c.lat * Math.PI) / 180)) / mppNeeded);
    this.map.setView(c, Math.min(this.map.maxZoom, Math.max(this.map.minZoom, zoom)));
  }
}
