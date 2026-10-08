// 개발·테스트용 모의 환경 (?mock=1): 외부 API 대신 로컬 모의 서버 사용
export function installMocks() {
  const cfg = (window.SITEDIAGRAM_CONFIG = window.SITEDIAGRAM_CONFIG || {});
  cfg.vworldKey = 'MOCK';
  cfg.kakaoJsKey = 'MOCK';
  cfg.kakaoSdkUrl = '/mock/kakao-sdk.js';
  cfg.vworldDataUrl = '/mock/vworld';
  cfg.overpassEndpoints = ['/mock/overpass'];
  cfg.vworldIndustrialLayer = '';
  for (const k of Object.keys(cfg.tileSources)) {
    const s = cfg.tileSources[k];
    s.url = (x, y, z) => `/mock/tile/${z}/${x}/${y}.png${k === 'vworld-hybrid' ? '?overlay=1' : ''}`;
  }
  console.log('[mock] 모의 환경 활성화');
}
