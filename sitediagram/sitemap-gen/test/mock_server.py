#!/usr/bin/env python3
"""개발·테스트용 모의 서버: 정적 파일 + 가짜 타일/Overpass/브이월드/카카오 SDK.
사용: python3 test/mock_server.py [port]  →  http://localhost:8765/?mock=1
"""
import io
import json
import math
import os
import random
import re
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

C_LAT, C_LNG = 36.9700, 127.8000

# ---------------- 합성 데이터 ----------------
def line(points):
    return [{"lat": p[0], "lon": p[1]} for p in points]

def curve(p0, p1, amp=0.0012, n=14, phase=0.0):
    """두 점 사이를 n분할하고 수직 방향으로 사인 곡선 오프셋 → 실제 도로처럼 완만히 휘는 폴리라인"""
    (a0, b0), (a1, b1) = p0, p1
    dx, dy = a1 - a0, b1 - b0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    pts = []
    for i in range(n + 1):
        t = i / n
        off = amp * math.sin(math.pi * t * 1.0 + phase) * (0.6 + 0.4 * math.sin(3 * t + phase))
        pts.append((a0 + dx * t + nx * off, b0 + dy * t + ny * off))
    return pts

ROADS = [
    ("첨단산업3로", "tertiary", curve((36.9660, 127.786), (36.9655, 127.812), 0.0008)),
    ("첨단산업7로", "tertiary", curve((36.9745, 127.790), (36.9742, 127.806), 0.0005, phase=1.0)),
    ("첨단산업9로", "secondary", curve((36.9800, 127.788), (36.9805, 127.812), 0.0009, phase=0.5)),
    ("첨단산업8로", "primary", curve((36.955, 127.8062), (36.985, 127.8068), 0.0010)),
    ("첨단산업6로", "tertiary", curve((36.955, 127.7930), (36.975, 127.7933), 0.0006, phase=2.0)),
    ("첨단산업4로", "tertiary", curve((36.955, 127.7995), (36.980, 127.7990), 0.0007)),
    ("첨단산업5로", "tertiary", curve((36.958, 127.7880), (36.980, 127.7878), 0.0005, phase=0.7)),
    ("기업도시로", "secondary", curve((36.9900, 127.7900), (36.9780, 127.8200), 0.0015, phase=0.3)),
    ("중부내륙고속도로", "motorway", curve((36.950, 127.8190), (36.990, 127.8235), 0.0020, n=20)),
    ("샛길", "residential", [(36.9705, 127.7960), (36.9705, 127.7985)]),  # 짧은 소로(숨김 대상)
]
RAIL = ("충북선", curve((36.9500, 127.7800), (36.9900, 127.8300), 0.0025, n=20))
RIVER = ("달천", curve((36.950, 127.812), (36.985, 127.818), 0.0030, n=24, phase=0.9))

INDUSTRIAL = ("충주첨단일반산업단지", [(36.9585, 127.7865), (36.9830, 127.7870), (36.9845, 127.8000), (36.9820, 127.8125), (36.9600, 127.8130), (36.9560, 127.8000), (36.9585, 127.7865)])
PARKS = [
    ("화성공원", [(36.9718, 127.7955), (36.9728, 127.7955), (36.9728, 127.7968), (36.9718, 127.7968), (36.9718, 127.7955)]),
    ("산성공원", [(36.9555, 127.7995), (36.9568, 127.7995), (36.9568, 127.8010), (36.9555, 127.8010), (36.9555, 127.7995)]),
]
COMPANIES = [
    ("현대모비스 충주공장", 36.9775, 127.7935), ("미원스페셜티케미칼", 36.9770, 127.7985), ("유한킴벌리 충주공장", 36.9765, 127.8105),
    ("한국팜비오", 36.9820, 127.8010), ("글로텍", 36.9805, 127.7930), ("다산기업", 36.9790, 127.8010), ("벨맷플로우컨트롤", 36.9780, 127.8020),
    ("한성공업 콤푸레샤", 36.9790, 127.8055), ("서림", 36.9770, 127.8060), ("자은테크", 36.9755, 127.8065), ("리켐", 36.9730, 127.7990),
    ("퍼스트칼라", 36.9695, 127.7975), ("LT소재 충주공장", 36.9680, 127.7915), ("하이텍팜 충주공장", 36.9690, 127.8010), ("대신전선", 36.9655, 127.7960),
    ("서울금속", 36.9640, 127.7905), ("전성", 36.9610, 127.8000), ("대유플러스", 36.9590, 127.8030),
]
APTS = [("충주오드카운티APT", 36.9560, 127.7890), ("충주지웰APT", 36.9535, 127.7950)]
FACILITY = [("폐수처리장", 36.9585, 127.7985)]


def sq(lat, lng, d=0.0006):
    return [(lat - d, lng - d), (lat - d, lng + d), (lat + d, lng + d), (lat + d, lng - d), (lat - d, lng - d)]


def roads_elements():
    els = []
    i = 1000
    for name, cls, pts in ROADS:
        els.append({"type": "way", "id": i, "tags": {"highway": cls, "name": name}, "geometry": line(pts)})
        i += 1
    els.append({"type": "way", "id": i, "tags": {"railway": "rail", "name": RAIL[0]}, "geometry": line(RAIL[1])}); i += 1
    els.append({"type": "way", "id": i, "tags": {"waterway": "river", "name": RIVER[0]}, "geometry": line(RIVER[1])}); i += 1
    return els


def areas_elements():
    els = [{"type": "way", "id": 2000, "tags": {"landuse": "industrial", "name": INDUSTRIAL[0]}, "geometry": line(INDUSTRIAL[1])}]
    for j, (name, pts) in enumerate(PARKS):
        els.append({"type": "way", "id": 2001 + j, "tags": {"leisure": "park", "name": name}, "geometry": line(pts)})
    # 멀티폴리곤 relation (이름 없는 산업지역 → 숨김 대상)
    els.append({"type": "relation", "id": 2100, "tags": {"landuse": "industrial", "type": "multipolygon"},
                "members": [{"type": "way", "ref": 1, "role": "outer", "geometry": line(sq(36.9500, 127.7850, 0.001)[:3])},
                            {"type": "way", "ref": 2, "role": "outer", "geometry": line(sq(36.9500, 127.7850, 0.001)[2:])}]})
    return els


def pois_elements():
    els = []
    i = 3000
    for name, lat, lng in COMPANIES[:10]:  # 절반만 OSM에 존재 (카카오와 중복 테스트)
        els.append({"type": "way", "id": i, "tags": {"building": "industrial", "name": name}, "geometry": line(sq(lat, lng))}); i += 1
    for name, lat, lng in APTS:
        els.append({"type": "way", "id": i, "tags": {"building": "apartments", "name": name}, "geometry": line(sq(lat, lng, 0.0008))}); i += 1
    for name, lat, lng in FACILITY:
        els.append({"type": "way", "id": i, "tags": {"man_made": "wastewater_plant", "name": name}, "geometry": line(sq(lat, lng, 0.0005))}); i += 1
    els.append({"type": "node", "id": i, "lat": 36.9735, "lon": 127.7905, "tags": {"amenity": "school", "name": "충주첨단초등학교"}})
    return els


def kakao_sdk_js():
    places = []
    for name, lat, lng in COMPANIES:
        places.append({"id": str(abs(hash(name)) % 10**8), "place_name": name, "x": str(lng), "y": str(lat), "category_name": "산업 > 제조", "category_group_code": ""})
    for name, lat, lng in APTS:
        places.append({"id": str(abs(hash(name)) % 10**8), "place_name": name, "x": str(lng), "y": str(lat), "category_name": "부동산 > 주거시설 > 아파트", "category_group_code": ""})
    places.append({"id": "9001", "place_name": "맛있는식당", "x": "127.7990", "y": "36.9710", "category_name": "음식점 > 한식", "category_group_code": "FD6"})
    places.append({"id": "9002", "place_name": "충주첨단산업단지 폐수처리장", "x": "127.7985", "y": "36.9585", "category_name": "공공기관", "category_group_code": "PO3"})
    places.append({"id": "9003", "place_name": "SBC리니어", "x": "127.8000", "y": "36.9700", "category_name": "산업 > 제조", "category_group_code": ""})
    data = json.dumps(places, ensure_ascii=False)
    return f"""
(function(){{
  const PLACES = {data};
  function dist(a,b,c,d){{ const R=6371008.8,dl=(c-a)*Math.PI/180,dn=(d-b)*Math.PI/180; const x=Math.sin(dl/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dn/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }}
  class LatLng {{ constructor(lat,lng){{ this.lat=lat; this.lng=lng; }} getLat(){{return this.lat;}} getLng(){{return this.lng;}} }}
  class Places {{
    keywordSearch(q, cb, opts={{}}){{
      const page = opts.page || 1;
      let list = PLACES.slice();
      if (opts.location) {{ list = list.filter(p => dist(opts.location.lat, opts.location.lng, +p.y, +p.x) <= (opts.radius||20000)); list.sort((a,b)=>dist(opts.location.lat,opts.location.lng,+a.y,+a.x)-dist(opts.location.lat,opts.location.lng,+b.y,+b.x)); }}
      // 키워드 필터: 간단히 일부 키워드만 매칭
      const kw = q.replace(/\\s/g,'');
      list = list.filter(p => (kw==='공장' || kw==='산업' || kw==='주식회사') ? true : (p.place_name.replace(/\\s/g,'').includes(kw) || p.category_name.includes(kw)));
      const start = (page-1)*15; const pageItems = list.slice(start, start+15);
      setTimeout(() => cb(pageItems, pageItems.length ? 'OK' : 'ZERO_RESULT', {{ hasNextPage: list.length > start+15, totalCount: list.length }}), 10);
    }}
  }}
  class Geocoder {{
    addressSearch(q, cb){{ setTimeout(() => {{ if (/충주/.test(q)) cb([{{ x: '{C_LNG}', y: '{C_LAT}', address_name: '충청북도 충주시 (모의)' }}], 'OK'); else cb([], 'ZERO_RESULT'); }}, 10); }}
  }}
  window.kakao = {{ maps: {{ load: (cb) => setTimeout(cb, 5), LatLng, services: {{ Places, Geocoder, Status: {{ OK:'OK', ZERO_RESULT:'ZERO_RESULT', ERROR:'ERROR' }}, SortBy: {{ DISTANCE:'distance', ACCURACY:'accuracy' }} }} }} }};
}})();
"""


def tile_png(z, x, y, overlay=False):
    img = Image.new("RGBA" if overlay else "RGB", (256, 256), (0, 0, 0, 0) if overlay else (0, 0, 0))
    d = ImageDraw.Draw(img)
    if overlay:
        d.text((8, 8), f"{z}/{x}/{y}", fill=(255, 255, 0, 255))
        return img
    rnd = random.Random(z * 1000003 + x * 1009 + y)
    # 위성사진 느낌: 녹색/갈색 패치 + 회색 블록(건물)
    for _ in range(40):
        px, py = rnd.randint(0, 255), rnd.randint(0, 255)
        w, h = rnd.randint(20, 90), rnd.randint(20, 90)
        g = rnd.choice([(70, 95, 55), (95, 110, 60), (120, 105, 70), (60, 80, 50), (140, 130, 110)])
        d.rectangle([px, py, px + w, py + h], fill=g)
    for _ in range(12):
        px, py = rnd.randint(0, 255), rnd.randint(0, 255)
        w, h = rnd.randint(10, 40), rnd.randint(10, 40)
        c = rnd.randint(150, 230)
        d.rectangle([px, py, px + w, py + h], fill=(c, c, c))
    d.rectangle([0, 0, 255, 255], outline=(40, 40, 40))
    d.text((6, 6), f"{z}/{x}/{y}", fill=(255, 255, 255))
    return img


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # 조용히
        if os.environ.get("MOCK_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        m = re.match(r"^/mock/tile/(\d+)/(-?\d+)/(-?\d+)\.png$", u.path)
        if m:
            z, x, y = map(int, m.groups())
            img = tile_png(z, x, y, overlay="overlay" in u.query)
            buf = io.BytesIO(); img.save(buf, "PNG")
            return self._send(200, "image/png", buf.getvalue())
        if u.path == "/mock/kakao-sdk.js":
            return self._send(200, "application/javascript; charset=utf-8", kakao_sdk_js().encode("utf-8"))
        if u.path == "/mock/vworld":
            q = urllib.parse.parse_qs(u.query)
            cb = q.get("callback", ["cb"])[0]
            data = q.get("data", [""])[0]
            gf = q.get("geomFilter", [""])[0]
            if data == "LP_PA_CBND_BUBUN":
                mm = re.match(r"POINT\(([-\d.]+) ([-\d.]+)\)", gf)
                lng, lat = float(mm.group(1)), float(mm.group(2))
                # 60m 격자 필지로 스냅
                glat, glng = 0.00055, 0.0007
                la0 = math.floor(lat / glat) * glat; ln0 = math.floor(lng / glng) * glng
                ring = [[ln0, la0], [ln0 + glng, la0], [ln0 + glng, la0 + glat], [ln0, la0 + glat], [ln0, la0]]
                pnu = f"4313025{int(la0*1e5)%100000:05d}{int(ln0*1e5)%100000:05d}"
                res = {"response": {"status": "OK", "record": {"total": "1", "current": "1"}, "result": {"featureCollection": {"type": "FeatureCollection", "features": [
                    {"type": "Feature", "id": pnu, "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"pnu": pnu, "jibun": f"{int(ln0*1e4)%1000}-{int(la0*1e4)%100}번지", "addr": "충청북도 충주시 주덕읍 (모의)"}}]}}}}
            else:
                res = {"response": {"status": "NOT_FOUND"}}
            body = f"{cb}({json.dumps(res, ensure_ascii=False)});".encode("utf-8")
            return self._send(200, "application/javascript; charset=utf-8", body)
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8")
        if u.path == "/mock/overpass":
            q = urllib.parse.parse_qs(body).get("data", [""])[0]
            if '"highway"' in q:
                els = roads_elements()
            elif '"leisure"' in q:
                els = areas_elements()
            else:
                els = pois_elements()
            return self._send(200, "application/json; charset=utf-8", json.dumps({"elements": els}, ensure_ascii=False).encode("utf-8"))
        return self._send(404, "text/plain", b"not found")


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"mock server: http://localhost:{PORT}/?mock=1")
    srv.serve_forever()
