// 카카오맵 JavaScript SDK (services 라이브러리) — 주소 지오코딩·키워드 장소검색
let _sdkPromise = null;

export function loadKakaoSdk(cfg) {
  if (_sdkPromise) return _sdkPromise;
  _sdkPromise = new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) return resolve(window.kakao);
    if (!cfg.kakaoJsKey && !cfg.kakaoSdkUrl) return reject(new Error('카카오 JavaScript 키가 설정되지 않았습니다.'));
    const url = cfg.kakaoSdkUrl || `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cfg.kakaoJsKey)}&libraries=services&autoload=false`;
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => {
      try {
        window.kakao.maps.load(() => resolve(window.kakao));
      } catch (e) { reject(e); }
    };
    s.onerror = () => { _sdkPromise = null; reject(new Error('카카오 SDK 로드 실패 (키·도메인 등록 확인)')); };
    document.head.appendChild(s);
  });
  return _sdkPromise;
}

/** 주소 → 좌표. 주소 검색 실패 시 키워드(장소) 검색으로 폴백 */
export async function geocode(cfg, query) {
  const kakao = await loadKakaoSdk(cfg);
  const S = kakao.maps.services;
  const geocoder = new S.Geocoder();
  const byAddress = await new Promise((resolve) => {
    geocoder.addressSearch(query, (result, status) => {
      if (status === S.Status.OK && result.length) {
        const r = result[0];
        resolve({ lat: parseFloat(r.y), lng: parseFloat(r.x), name: r.address_name || query, type: 'address' });
      } else resolve(null);
    });
  });
  if (byAddress) return byAddress;
  const places = new S.Places();
  return new Promise((resolve) => {
    places.keywordSearch(query, (data, status) => {
      if (status === S.Status.OK && data.length) {
        const r = data[0];
        resolve({ lat: parseFloat(r.y), lng: parseFloat(r.x), name: r.place_name, address: r.road_address_name || r.address_name, type: 'place' });
      } else resolve(null);
    }, { size: 5 });
  });
}

/** 키워드 장소검색 (최대 3페이지 × 15건) */
export async function searchKeyword(cfg, keyword, { lat, lng, radius, pages = 3 }) {
  const kakao = await loadKakaoSdk(cfg);
  const S = kakao.maps.services;
  const places = new S.Places();
  const all = [];
  for (let page = 1; page <= pages; page++) {
    const { data, status, pagination } = await new Promise((resolve) => {
      places.keywordSearch(keyword, (data, status, pagination) => resolve({ data, status, pagination }), {
        location: new kakao.maps.LatLng(lat, lng),
        radius: Math.min(20000, Math.max(100, Math.round(radius))),
        sort: S.SortBy.DISTANCE,
        page,
        size: 15,
      });
    });
    if (status !== S.Status.OK || !data || !data.length) break;
    all.push(...data);
    if (!pagination || !pagination.hasNextPage) break;
  }
  return all.map((r) => ({
    id: String(r.id),
    name: r.place_name,
    lat: parseFloat(r.y),
    lng: parseFloat(r.x),
    category: r.category_name || '',
    categoryCode: r.category_group_code || '',
    address: r.road_address_name || r.address_name || '',
  }));
}

export function kindFromKakao(p) {
  const c = p.category || '';
  if (/아파트|주택|빌라|오피스텔|주거/.test(c) || /아파트|APT/i.test(p.name)) return 'apartment';
  if (/학교|관공서|행정|주민센터|우체국|경찰|소방|병원|도서관|공공기관/.test(c)) return 'public';
  if (/공원|녹지|수목원/.test(c) || /공원$/.test(p.name)) return 'park';
  if (/하수|폐수|처리장|변전소|정수장|발전소|소각/.test(p.name + c)) return 'facility';
  return 'company';
}
