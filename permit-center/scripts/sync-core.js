/* 가상인허가센터 법령·조례 동기화 코어
   - 브라우저와 Node(GitHub Actions) 양쪽에서 동작 (플랫폼 함수는 env로 주입)
   - env = { getJSON(path, params) -> obj, getBytes(url) -> Uint8Array, inflateRaw(bytes) -> Uint8Array, sleep(ms), log(...) } */
(function (G) {
  const ZONE_NAMES = ['제1종전용주거지역','제2종전용주거지역','제1종일반주거지역','제2종일반주거지역','제3종일반주거지역','준주거지역','중심상업지역','일반상업지역','근린상업지역','유통상업지역','전용공업지역','일반공업지역','준공업지역','보전녹지지역','생산녹지지역','자연녹지지역','보전관리지역','생산관리지역','계획관리지역','농림지역','자연환경보전지역'];
  const PARK_USES = {
    '공장':['공장'], '창고시설':['창고'], '제1종근린생활시설':['제1종'], '제2종근린생활시설':['제2종'], '업무시설':['업무시설'],
    '판매시설':['판매시설'], '문화및집회시설':['문화및집회','문화 및 집회'], '종교시설':['종교시설'], '의료시설':['의료시설'],
    '교육연구시설':['교육연구'], '노유자시설':['노유자'], '수련시설':['수련시설'], '운동시설':['운동시설'], '숙박시설':['숙박시설'],
    '위락시설':['위락시설'], '기타':['그 밖의','그밖의','기타 건축물']
  };
  const td = new TextDecoder('utf-8'), td16 = new TextDecoder('utf-16le');
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const nospace = s => String(s || '').replace(/\s+/g, '');

  /* ---------- 숫자 ---------- */
  function koNum(s) { // "1천500" "2천" "1만" "2,000" "3,000"
    s = String(s).replace(/,/g, '').replace(/\s/g, '');
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    let total = 0, m;
    const re = /(\d+(?:\.\d+)?)?(만|천|백)?/g;
    let rest = s;
    const mm = rest.match(/^(?:(\d+(?:\.\d+)?)만)?(?:(\d+(?:\.\d+)?)?천)?(?:(\d+(?:\.\d+)?)?백)?(\d+)?$/);
    if (!mm) return NaN;
    if (mm[1]) total += parseFloat(mm[1]) * 10000;
    if (s.includes('천')) total += (mm[2] ? parseFloat(mm[2]) : 1) * 1000;
    if (s.includes('백')) total += (mm[3] ? parseFloat(mm[3]) : 1) * 100;
    if (mm[4]) total += parseFloat(mm[4]);
    return total;
  }

  /* ---------- 조례 본문 ---------- */
  function ordinArticles(L) {
    const jo = [].concat(L?.조문?.조 || []);
    return jo.filter(a => a && a.조제목 !== undefined).map(a => ({ no: a.조문번호, title: norm(a.조제목), text: norm(a.조내용) }));
  }
  function percentOf(text) { // "50퍼센트" "50%" "100분의 50"
    const m = text.match(/(\d+(?:\.\d+)?)\s*(?:퍼센트|%|％)/) || text.match(/100분의\s*(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  function expandZones(t) { // "제1종·제2종전용주거지역" → 제1종전용주거지역 제2종전용주거지역
    return t.replace(/((?:제[123]종[·ㆍ,및]*){2,})(전용|일반)주거지역/g, (m, a, b) => a.match(/제[123]종/g).map(x => x + b + '주거지역').join('·'))
      .replace(/((?:(?:보전|생산|자연)[·ㆍ,및]*){2,})녹지지역/g, (m, a) => a.match(/보전|생산|자연/g).map(x => x + '녹지지역').join('·'))
      .replace(/((?:(?:보전|생산|계획)[·ㆍ,및]*){2,})관리지역/g, (m, a) => a.match(/보전|생산|계획/g).map(x => x + '관리지역').join('·'))
      .replace(/((?:(?:중심|일반|근린|유통)[·ㆍ,및]*){2,})상업지역/g, (m, a) => a.match(/중심|일반|근린|유통/g).map(x => x + '상업지역').join('·'))
      .replace(/((?:(?:전용|일반|준)[·ㆍ,및]*){2,})공업지역/g, (m, a) => a.match(/전용|일반|준/g).map(x => x + '공업지역').join('·'));
  }
  function parseZoneTable(text) {
    // 제1항만 대상 (② 이후 특례 제외), 호 단위로 "지역명들 : N퍼센트"
    let body = text; const cut = body.search(/②/); if (cut > 0) body = body.slice(0, cut);
    const t = expandZones(nospace(body).replace(/ㆍ/g, '·'));
    const out = {};
    const items = t.split(/(?<=[^\d제])(?=\d{1,2}\.)/);
    for (const it of items) {
      const p = percentOf(it); if (p === null) continue;
      const head = it.split(/\d+(?:\.\d+)?(?:퍼센트|%|％)|100분의/)[0];
      for (const z of ZONE_NAMES) if (head.includes(z) && !(z in out)) out[z] = p;
    }
    if (Object.keys(out).length < 5) { // 호 구분이 없는 서술형
      for (const z of ZONE_NAMES) { const i = t.indexOf(z); if (i < 0 || z in out) continue; const p = percentOf(t.slice(i + z.length, i + z.length + 40)); if (p !== null) out[z] = p; }
    }
    return out;
  }
  function parseZoneBylaw(text, mode) { // 별표(표) — 셀 순서로 "지역 ‖ 건폐율 ‖ 용적률"
    const cells = expandZones(String(text).replace(/ㆍ/g, '·')).split(/‖|\n/).map(c => nospace(c)).filter(Boolean);
    const bcr = {}, far = {};
    for (let i = 0; i < cells.length; i++) {
      const zs = ZONE_NAMES.filter(z => cells[i].includes(z) && cells[i].length < z.length * 6);
      if (!zs.length) continue;
      const nums = [];
      for (let j = i + 1; j < Math.min(cells.length, i + 6) && nums.length < 2; j++) {
        if (ZONE_NAMES.some(z => cells[j].includes(z))) break;
        const m = cells[j].match(/^(\d+(?:\.\d+)?)(?:퍼센트|%|％)?(?:이하)?$/) || cells[j].match(/(\d+(?:\.\d+)?)(?:퍼센트|%|％)/);
        if (m) nums.push(parseFloat(m[1]));
      }
      for (const z of zs) {
        if (mode === 'far') { if (nums[0] != null && !(z in far)) far[z] = nums[0]; }
        else { if (nums[0] != null && !(z in bcr)) bcr[z] = nums[0]; if (mode === 'both' && nums[1] != null && !(z in far)) far[z] = nums[1]; }
      }
    }
    return { bcr, far };
  }
  function parsePlan(arts) {
    const bcrA = arts.find(a => /용도지역/.test(a.title) && /건폐율/.test(a.title) && !/완화|강화|특례|기타/.test(a.title)) || arts.find(a => /건폐율/.test(a.title) && ZONE_NAMES.filter(z => nospace(a.text).includes(z)).length > 8);
    const farA = arts.find(a => /용도지역/.test(a.title) && /용적률/.test(a.title) && !/완화|강화|특례|기타/.test(a.title)) || arts.find(a => /용적률/.test(a.title) && ZONE_NAMES.filter(z => nospace(a.text).includes(z)).length > 8);
    return {
      bcr: bcrA ? parseZoneTable(bcrA.text) : {}, far: farA ? parseZoneTable(farA.text) : {},
      bcrArt: bcrA ? bcrA.title : null, farArt: farA ? farA.title : null,
      bcrText: bcrA ? bcrA.text.slice(0, 2200) : '', farText: farA ? farA.text.slice(0, 2200) : ''
    };
  }
  function parseScapeTiers(text) {
    // "연면적의 합계가 2천제곱미터 이상인 건축물: 대지면적의 15퍼센트 이상"
    const tiers = [];
    const t = norm(text).replace(/㎡/g, '제곱미터');
    const re = /연면적(?:의\s*합계)?(?:가|이)?\s*([\d,\.천만백]+)\s*제곱미터\s*(이상|미만|초과|이하)(?:\s*([\d,\.천만백]+)\s*제곱미터\s*(미만|이하))?[^.。]*?대지면적의\s*(\d+(?:\.\d+)?)\s*퍼센트/g;
    let m;
    while ((m = re.exec(t))) {
      const a = koNum(m[1]), b = m[3] ? koNum(m[3]) : null;
      let min = 0, max = null;
      if (m[2] === '이상' || m[2] === '초과') { min = a; if (b) max = b; } else { max = a; }
      const ctx = t.slice(Math.max(0, m.index - 40), m.index);
      tiers.push({ min, max, rate: parseFloat(m[5]), factory: /공장|물류/.test(ctx) });
    }
    return tiers;
  }
  function parseBuilding(arts) {
    const sc = arts.find(a => /조경/.test(a.title) && !/옥상|식재/.test(a.title));
    const cm = arts.filter(a => /심의/.test(a.title) && /(건축위원회|대상|기능|건축심의)/.test(a.title)).slice(0, 2);
    return {
      scapeArt: sc ? sc.title : null, scapeText: sc ? sc.text.slice(0, 2600) : '', scapeTiers: sc ? parseScapeTiers(sc.text) : [],
      cmteText: cm.map(a => '[' + a.title + '] ' + a.text).join('\n').slice(0, 3000)
    };
  }
  function parseLandscapeOrd(arts) {
    const b = arts.find(a => /건축물/.test(a.title) && /경관/.test(a.title) && /심의/.test(a.title)) || arts.find(a => /경관심의/.test(a.title) && /대상/.test(a.title) && /건축/.test(a.text));
    const d = arts.find(a => /개발사업/.test(a.title) && /경관심의|심의/.test(a.title));
    return { bldArt: b ? b.title : null, bldText: b ? b.text.slice(0, 3500) : '', devText: d ? d.text.slice(0, 1500) : '' };
  }

  /* ---------- HWPX / HWP5 텍스트 ---------- */
  async function unzipText(by, env, pick) {
    const dv = new DataView(by.buffer, by.byteOffset, by.byteLength);
    let e = by.length - 22; while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e <= 0) return '';
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = [];
    for (let i = 0; i < n; i++) {
      const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), fl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files.push({ name: td.decode(by.subarray(p + 46, p + 46 + fl)), m, cs, off }); p += 46 + fl + xl + cl;
    }
    let out = '';
    for (const f of files.filter(f => pick.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
      const lfl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true);
      const d = by.subarray(f.off + 30 + lfl + lxl, f.off + 30 + lfl + lxl + f.cs);
      out += td.decode(f.m === 0 ? d : await env.inflateRaw(d));
    }
    return out;
  }
  function hwpxToText(xml) {
    // 표의 행을 "셀 ‖ 셀" 한 줄로, 나머지 문단은 줄바꿈
    const cellText = s => s.replace(/<hp:lineBreak\/>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const rows = [];
    const trRe = /<hp:tr\b[^>]*>([\s\S]*?)<\/hp:tr>/g; let m;
    while ((m = trRe.exec(xml))) rows.push(m[1].split(/<hp:tc\b/).slice(1).map(c => cellText('<x ' + c)).join(' ‖ '));
    const rest = cellText(xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, ' '));
    return rows.join('\n') + '\n' + rest;
  }
  function cfbStreams(by) { // 최소 OLE(CFB) 리더
    const dv = new DataView(by.buffer, by.byteOffset, by.byteLength);
    if (dv.getUint32(0, true) !== 0xE011CFD0) return null;
    const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), miniCut = dv.getUint32(56, true);
    const miniFatStart = dv.getUint32(60, true), difStart = dv.getUint32(68, true);
    const sec = i => (i + 1) * ss;
    const difat = []; for (let i = 0; i < 109; i++) difat.push(dv.getUint32(76 + i * 4, true));
    let ds = difStart; while (ds !== 0xFFFFFFFE && ds !== 0xFFFFFFFF && difat.length < nFat + 200) { for (let i = 0; i < ss / 4 - 1; i++) difat.push(dv.getUint32(sec(ds) + i * 4, true)); ds = dv.getUint32(sec(ds) + ss - 4, true); }
    const fat = []; for (const s of difat.slice(0, nFat)) for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(sec(s) + i * 4, true));
    const chain = (start, f) => { const out = []; let c = start, g = 0; while (c < 0xFFFFFFFA && g++ < 1e6) { out.push(c); c = f[c]; } return out; };
    const readBig = (start, size) => { const parts = chain(start, fat); const buf = new Uint8Array(parts.length * ss); parts.forEach((s, i) => buf.set(by.subarray(sec(s), sec(s) + ss), i * ss)); return size != null ? buf.subarray(0, size) : buf; };
    const dir = readBig(dirStart), ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength), ents = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nl = ddv.getUint16(o + 64, true); if (!nl) { ents.push(null); continue; }
      ents.push({ name: td16.decode(dir.subarray(o, o + nl - 2)), type: dir[o + 66], left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
    }
    const root = ents[0], ministream = readBig(root.start, root.size);
    const mfat = []; if (miniFatStart < 0xFFFFFFFA) { const mf = readBig(miniFatStart); const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength); for (let i = 0; i < mf.length / 4; i++) mfat.push(mdv.getUint32(i * 4, true)); }
    const read = e => { if (e.size < miniCut) { const parts = chain(e.start, mfat); const buf = new Uint8Array(parts.length * mss); parts.forEach((s, i) => buf.set(ministream.subarray(s * mss, s * mss + mss), i * mss)); return buf.subarray(0, e.size); } return readBig(e.start, e.size); };
    const paths = {};
    const walk = (idx, prefix) => { if (idx === 0xFFFFFFFF || !ents[idx]) return; const e = ents[idx]; walk(e.left, prefix); walk(e.right, prefix); const p = prefix + e.name; if (e.type === 2) paths[p] = e; if (e.type === 1) walk(e.child, p + '/'); };
    walk(root.child, '');
    return { names: Object.keys(paths), read: n => read(paths[n]) };
  }
  async function hwp5ToText(by, env) {
    const c = cfbStreams(by); if (!c) return '';
    const fh = c.read('FileHeader'); const compressed = (new DataView(fh.buffer, fh.byteOffset).getUint32(36, true) & 1) === 1;
    let out = '';
    const secs = c.names.filter(n => /^BodyText\/Section\d+$/.test(n)).sort((a, b) => +a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]);
    for (const s of secs) {
      let d = c.read(s); if (compressed) d = await env.inflateRaw(d);
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); let p = 0;
      while (p + 4 <= d.length) {
        const h = dv.getUint32(p, true); let tag = h & 0x3FF, size = h >>> 20; p += 4;
        if (size === 0xFFF) { size = dv.getUint32(p, true); p += 4; }
        if (tag === 72) out += ' ‖ '; // LIST_HEADER (셀 시작)
        if (tag === 67) { // PARA_TEXT
          let i = 0; const n = size / 2; let s2 = '';
          while (i < n) { const ch = dv.getUint16(p + i * 2, true);
            if (ch < 32) { if ([1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23].includes(ch)) i += 8; else { if (ch === 10 || ch === 13) s2 += ' '; i += 1; } }
            else { s2 += String.fromCharCode(ch); i += 1; } }
          out += s2 + '\n';
        }
        p += size;
      }
    }
    return out;
  }
  async function attachmentText(by, env) {
    if (by[0] === 0x50 && by[1] === 0x4B) return hwpxToText(await unzipText(by, env, /^Contents\/section\d+\.xml$/));
    if (by[0] === 0xD0 && by[1] === 0xCF) return await hwp5ToText(by, env);
    return '';
  }

  /* ---------- 주차 ---------- */
  function parseParkingTable(text) {
    const t = String(text).replace(/\r/g, '');
    // 번호 항목 단위로 자르기 ("1. 위락시설 ‖ 시설면적 ...", "10의2. ...")
    const items = []; const re = /(?:^|\n|‖\s*)\s*(\d{1,2}(?:의\d)?)\.\s/g; let m, last = null;
    while ((m = re.exec(t))) { if (last) items.push(t.slice(last.i, m.index)); last = { i: m.index }; }
    if (last) items.push(t.slice(last.i));
    const units = {}, raw = {};
    const unitOf = s => { const x = norm(s).match(/시설면적\s*([\d,\.]+)\s*(?:㎡|제곱미터|m2|m²|㎥)\s*당\s*1\s*대/); return x ? parseFloat(x[1].replace(/,/g, '')) : null; };
    for (const [use, kws] of Object.entries(PARK_USES)) {
      for (const it of items) {
        const head = norm(it).split(/시설면적|○|「주차장법|주차장법 시행령/)[0];
        if (!kws.some(k => nospace(head).includes(nospace(k)))) continue;
        if (use === '공장' && /아파트형/.test(head) && !/제외/.test(head)) continue;
        let u = unitOf(it);
        // "다만, 공장의 경우에는 400제곱미터당 1대" 같은 단서 우선
        for (const k of kws) { const ex = norm(it).match(new RegExp(k + '[^○]{0,25}?([\\d,\\.]+)\\s*(?:㎡|제곱미터)\\s*당\\s*1\\s*대')); if (ex && norm(it).indexOf(ex[0]) > norm(it).search(/시설면적|○/)) { u = parseFloat(ex[1].replace(/,/g, '')); break; } }
        if (u) { units[use] = u; raw[use] = norm(it).slice(0, 260); }
        else if (/주차장법\s*시행령/.test(it)) { units[use] = 'national'; raw[use] = norm(it).slice(0, 220); }
        break;
      }
    }
    return { units, raw };
  }
  function disabledRatio(text) {
    const t = norm(text);
    const m = t.match(/주차대수의\s*(\d+(?:\.\d+)?)\s*퍼센트\s*이상(?:을|의)\s*장애인/) || t.match(/장애인[^.]{0,90}?주차대수의\s*(\d+(?:\.\d+)?)\s*퍼센트/) || t.match(/(\d+(?:\.\d+)?)\s*퍼센트\s*이상을\s*장애인/);
    return m ? parseFloat(m[1]) : null;
  }

  function findBylaw(L, n) {
    const list = [].concat(L?.별표?.별표단위 || []);
    return list.find(b => new RegExp('별표\\s*' + n + '(?![\\d의])').test(b.별표제목 || '')) || list.find(b => { const m = String(b.별표제목 || '').match(/별표\s*(\d+)\s*[~∼\-]\s*(?:별표\s*)?(\d+)/); return m && +m[1] <= +n && +n <= +m[2]; }) || list.find(b => +b.별표번호 === +n && (b.별표구분 || '별표') === '별표');
  }

  /* ---------- 검색 ---------- */
  async function searchOrdin(env, query) {
    const out = []; let page = 1, total = 1;
    while (out.length < total && page < 40) {
      const j = await env.getJSON('/DRF/lawSearch.do', { target: 'ordin', type: 'JSON', display: 100, page, query });
      const s = j.OrdinSearch || {}; total = +s.totalCnt || 0;
      const l = [].concat(s.law || []); if (!l.length) break; out.push(...l); page++;
    }
    return out;
  }
  const KINDS = {
    plan: { queries: ['도시계획 조례', '군계획 조례', '도시·군계획 조례'], ok: n => /(도시|군|도시·군|도시ㆍ군)\s*계획\s*조례$/.test(n) && !/시행규칙|위원회|특별회계|기금/.test(n) },
    bld: { queries: ['건축 조례'], ok: n => /건축\s*조례$/.test(n) && !/관리|심의|안전|미술|디자인|허가|분쟁|자산|문화|기본|에너지|녹색|한옥|공공/.test(n) },
    scape: { queries: ['경관 조례'], ok: n => /경관\s*조례$/.test(n) && !/야간|농촌|산림|하천|공공디자인/.test(n) },
    park: { queries: ['주차장 설치 및 관리 조례', '주차장 조례', '주차장 설치 및 관리 운영'], ok: n => /주차장/.test(n) && /조례$/.test(n) && !/공영|특별회계|기금|시행규칙|거주자|요금|무료|공유|셔틀|임시|민영|청사|소속기관|부설주차장 관리|개방/.test(n), score: n => (/설치/.test(n) ? 10 : 0) + (/주차장\s*조례$/.test(n) ? 5 : 0) }
  };
  const METRO = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시'];
  const LEGACY = { '전남광주통합특별시': gu => (/^(동구|서구|남구|북구|광산구)$/.test(gu) ? '(구)광주광역시' : '(구)전라남도') };
  const SIDO = ['전남광주통합특별시','서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도'];

  async function buildLocal(env, opts = {}) {
    const lists = {};
    for (const [k, def] of Object.entries(KINDS)) {
      const map = {};
      for (const q of def.queries) for (const it of await searchOrdin(env, q)) {
        const nm = norm(it.자치법규명).replace(/\s*\[[^\]]*\]\s*$/, ''), org = norm(it.지자체기관명);
        if (it.자치법규종류 !== '조례' || !def.ok(nm) || !org) continue;
        const sc = (def.score ? def.score(nm) : 0) - nm.length / 100;
        if (!map[org] || sc > map[org].sc) map[org] = { name: nm, mst: it.자치법규일련번호, date: it.시행일자, pub: it.공포일자, sc };
      }
      lists[k] = map; env.log('[' + k + '] ' + Object.keys(map).length + '건');
    }
    const orgs = new Set([...Object.keys(lists.bld), ...Object.keys(lists.plan), ...Object.keys(lists.park), ...Object.keys(lists.scape)]);
    const regions = {};
    for (const org of orgs) {
      const parts = org.split(' '); const sido = parts[0];
      if (!SIDO.includes(sido)) continue;
      if (parts.length === 1 && !['세종특별자치시', '제주특별자치도'].includes(sido)) continue; // 광역 단위는 상위 조례로만 사용
      const sgg = parts.slice(1).join(' ') || '(전역)';
      const legacy = LEGACY[sido] ? LEGACY[sido](sgg) : null;
      regions[org] = { sido, sgg, parent: parts.length > 1 ? sido : null, legacy, metroGu: parts.length > 1 && (METRO.includes(sido) || legacy === '(구)광주광역시') };
    }
    const cache = {};
    const getOrd = async (mst) => { if (!cache[mst]) { cache[mst] = (await env.getJSON('/DRF/lawService.do', { target: 'ordin', type: 'JSON', MST: mst })).LawService; await env.sleep(80); } return cache[mst]; };
    const parentsOf = R => [R.parent, R.legacy].filter(Boolean);
    const srcList = (kind, org, R) => [lists[kind][org]].concat(parentsOf(R).map(x => lists[kind][x])).filter(Boolean);
    const names = Object.keys(regions).filter(o => !opts.only || opts.only.includes(o));
    let i = 0;
    for (const org of names) {
      const R = regions[org]; i++;
      try {
        // 도시계획 (자치구는 광역시 조례)
        const ps = R.metroGu ? (parentsOf(R).map(x => lists.plan[x]).filter(Boolean)[0] || lists.plan[org]) : srcList('plan', org, R)[0];
        if (ps) {
          const Lp = await getOrd(ps.mst); const P = parsePlan(ordinArticles(Lp));
          // 조문이 "별표 N에 따른다"인 경우 별표 파일을 읽는다
          const needB = Object.keys(P.bcr).length < 5, needF = Object.keys(P.far).length < 5;
          const tasks = P.bcrArt && P.bcrArt === P.farArt ? [['both', P.bcrText]] : [['bcr', P.bcrText], ['far', P.farText]];
          for (const [mode, txt] of tasks) {
            if ((mode === 'bcr' && !needB) || (mode === 'far' && !needF) || (mode === 'both' && !needB && !needF)) continue;
            const mm = String(txt).match(/별표\s*(\d+)/); if (!mm) continue;
            const b = findBylaw(Lp, mm[1]); if (!b || !b.별표첨부파일명) continue;
            try {
              const by = await env.getBytes(b.별표첨부파일명); const T = await attachmentText(by, env); const Z = parseZoneBylaw(T, mode);
              if (needB && Object.keys(Z.bcr).length) P.bcr = Z.bcr;
              if (needF && Object.keys(Z.far).length) P.far = Z.far;
              P[mode + 'Bylaw'] = b.별표제목; await env.sleep(80);
            } catch (e) { env.log('별표 실패', org, e.message); }
          }
          R.plan = { ...P, src: ps };
        }
        // 건축조례 (조경 조항이 없으면 상위 조례)
        for (const src of srcList('bld', org, R)) {
          const B = parseBuilding(ordinArticles(await getOrd(src.mst)));
          if (!R.bld) R.bld = { ...B, src };
          if (B.scapeText && !R.bld.scapeText) Object.assign(R.bld, { scapeArt: B.scapeArt, scapeText: B.scapeText, scapeTiers: B.scapeTiers, scapeFrom: src.name });
          if (B.cmteText && !R.bld.cmteText) R.bld.cmteText = B.cmteText;
          if (R.bld.scapeText && R.bld.cmteText) break;
        }
        // 경관조례
        for (const src of srcList('scape', org, R)) {
          const S = parseLandscapeOrd(ordinArticles(await getOrd(src.mst)));
          if (S.bldText) { R.scape = { ...S, src }; break; }
        }
        // 주차장 조례 (부설주차장 별표)
        for (const src of srcList('park', org, R)) {
          const L = await getOrd(src.mst);
          const arts = ordinArticles(L);
          const refArt = arts.find(a => /부설주차장/.test(a.title) && /설치/.test(a.title) && /별표\s*\d+/.test(a.text) && !/비용|면제|인근|기계식/.test(a.title));
          const refN = refArt ? (refArt.text.match(/설치기준[^.]{0,30}?별표\s*(\d+)/) || refArt.text.match(/별표\s*(\d+)/))[1] : null;
          const bp = [].concat(L?.별표?.별표단위 || []).find(b => /부설주차장/.test(b.별표제목 || '') && /설치/.test(b.별표제목 || '')) || [].concat(L?.별표?.별표단위 || []).find(b => /설치대상\s*시설물/.test(b.별표제목 || '')) || (refN ? findBylaw(L, refN) : null);
          let text = bp && norm(bp.별표내용).length > 50 ? String(bp.별표내용) : '';
          let fileType = text ? 'text' : null;
          if (!text && bp && bp.별표첨부파일명) {
            try { const by = await env.getBytes(bp.별표첨부파일명.replace(/^http:\/\/www\.law\.go\.kr/, '')); text = await attachmentText(by, env); fileType = by[0] === 0x50 ? 'hwpx' : by[0] === 0xD0 ? 'hwp' : 'other'; await env.sleep(80); }
            catch (e) { env.log('첨부 실패', org, e.message); }
          }
          const P = parseParkingTable(text);
          const dArt = arts.find(a => /장애인/.test(a.title) && /주차/.test(a.title) && /부설/.test(a.text)) || arts.find(a => /장애인/.test(a.title) && /주차/.test(a.title));
          const ratio = disabledRatio(text) ?? (dArt ? disabledRatio(dArt.text) : null);
          if (Object.keys(P.units).length || ratio) { R.park = { units: P.units, raw: P.raw, disabledPct: ratio, file: fileType, table: bp?.별표제목 || null, fileUrl: bp?.별표첨부파일명 || null, src }; break; }
          if (!R.park) R.park = { units: {}, raw: {}, disabledPct: ratio, file: fileType, table: bp?.별표제목 || null, fileUrl: bp?.별표첨부파일명 || null, src, parseFail: true };
        }
      } catch (e) { R.error = String(e.message || e); env.log('오류', org, R.error); }
      if (i % 20 === 0) env.log(i + '/' + names.length);
    }
    return regions;
  }

  /* ---------- 국가 법령 추적 ---------- */
  const NATIONAL = [
    { name: '건축법 시행령', reviews: ['permit','struct','cmte'] },
    { name: '건축법 시행규칙', reviews: ['permit'] },
    { name: '국토의 계획 및 이용에 관한 법률 시행령', reviews: ['permit','dev'] },
    { name: '녹색건축물 조성 지원법 시행령', reviews: ['energy','zeb'] },
    { name: '건축물의 에너지절약설계기준', admrul: true, reviews: ['energy'] },
    { name: '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행령', reviews: ['ba','bf'] },
    { name: '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행규칙', reviews: ['ba'] },
    { name: '경관법 시행령', reviews: ['scape'] },
    { name: '주차장법 시행령', reviews: ['permit'] },
    { name: '소방시설 설치 및 관리에 관한 법률 시행령', reviews: ['fire'] },
    { name: '도시교통정비 촉진법 시행령', reviews: ['traffic'] },
    { name: '지하안전관리에 관한 특별법 시행령', reviews: ['under'] },
    { name: '환경영향평가법 시행령', reviews: ['env'] },
    { name: '산업집적활성화 및 공장설립에 관한 법률 시행령', reviews: ['factory'] },
    { name: '장애인고용촉진 및 직업재활법 시행령', reviews: ['ba'] }
  ];
  const flatArticle = a => { let t = (a.조문내용 || '') + ' '; [].concat(a.항 || []).forEach(h => { t += (h.항내용 || '') + ' '; [].concat(h.호 || []).forEach(o => { t += (o.호내용 || '') + ' '; [].concat(o.목 || []).forEach(m => t += (m.목내용 || '') + ' '); }); }); return norm(t); };
  const tbl = s => norm(String(s || '').replace(/[│┌┐└┘├┤┬┴┼─━┃┏┓┗┛┠┨┯┷┳┻╋]+/g, ' | '));
  /* 근거 원문 발췌 + 자동 검증값 */
  const EVIDENCE = [
    { id: 'energy10', law: '녹색건축물 조성 지원법 시행령', art: '10', check: [/연면적의 합계가\s*(\d+)\s*제곱미터 이상/, 500] },
    { id: 'zeb12', law: '녹색건축물 조성 지원법 시행령', art: '12' },
    { id: 'zebB1', law: '녹색건축물 조성 지원법 시행령', bylaw: /제로에너지건축물 인증 의무 대상/ },
    { id: 'baB1', law: '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행령', bylaw: /편의시설 설치 대상시설/ },
    { id: 'bfB22', law: '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행령', bylaw: /공공기관의 장애물 없는 생활환경 인증 의무/ },
    { id: 'bfB23', law: '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행령', bylaw: /외의 자의 장애물 없는 생활환경 인증 의무/ },
    { id: 'empObl', law: '장애인고용촉진 및 직업재활법 시행령', artTitle: /고용의무|의무고용/ },
    { id: 'bld2', law: '건축법 시행령', art: '2', slice: /17\. "다중이용 건축물"[\s\S]{0,1300}/ },
    { id: 'bld27', law: '건축법 시행령', art: '27', check: [/연면적의 합계가 2천\s*제곱미터 이상인 경우: 대지면적의\s*(\d+)\s*퍼센트/, 10] },
    { id: 'bld32', law: '건축법 시행령', art: '32' },
    { id: 'bld55', law: '건축법 시행령', art: '5의5' },
    { id: 'bld11', law: '건축법 시행령', art: '11' },
    { id: 'fire7', law: '소방시설 설치 및 관리에 관한 법률 시행령', art: '7', check: [/(\d+)\s*제곱미터 이상인 건축물이나 시설/, 400] },
    { id: 'trafficB1', law: '도시교통정비 촉진법 시행령', bylaw: /교통영향평가 대상사업의 범위/, slice: /2\. 건축물[\s\S]{0,6000}/ },
    { id: 'under13', law: '지하안전관리에 관한 특별법 시행령', art: '13', check: [/굴착깊이[\s\S]{0,200}?가\s*(\d+)미터 이상/, 20] },
    { id: 'under23', law: '지하안전관리에 관한 특별법 시행령', art: '23', check: [/굴착깊이가\s*(\d+)미터 이상/, 10] },
    { id: 'eiaB4', law: '환경영향평가법 시행령', bylaw: /소규모 환경영향평가 대상사업/, slice: /1\. 「국토의[\s\S]{0,3500}/ },
    { id: 'parkB1', law: '주차장법 시행령', bylaw: /부설주차장의 설치대상/ },
    { id: 'factory', law: '산업집적활성화 및 공장설립에 관한 법률 시행령', artTitle: /공장설립등의 승인|승인대상/ }
  ];

  async function buildNational(env) {
    const laws = {}, docs = {};
    for (const L of NATIONAL) {
      try {
        const target = L.admrul ? 'admrul' : 'law';
        const j = await env.getJSON('/DRF/lawSearch.do', { target, type: 'JSON', display: 20, query: L.name });
        const arr = [].concat((L.admrul ? j.AdmRulSearch?.admrul : j.LawSearch?.law) || []);
        const it = arr.find(x => norm(x.법령명한글 || x.행정규칙명) === L.name) || arr[0];
        if (!it) { laws[L.name] = { missing: true }; continue; }
        laws[L.name] = { mst: it.법령일련번호 || it.행정규칙일련번호, date: it.시행일자, pub: it.공포일자 || it.발령일자, kind: it.제개정구분명, reviews: L.reviews };
        if (!L.admrul) { docs[L.name] = (await env.getJSON('/DRF/lawService.do', { target: 'law', type: 'JSON', MST: laws[L.name].mst })).법령; await env.sleep(100); }
      } catch (e) { laws[L.name] = { error: String(e.message || e) }; }
    }
    const evidence = {}, checks = [];
    for (const E of EVIDENCE) {
      const D = docs[E.law]; if (!D) continue;
      let text = '';
      if (E.bylaw) { const b = [].concat(D.별표?.별표단위 || []).find(x => E.bylaw.test(x.별표제목 || '')); text = b ? tbl(b.별표내용) : ''; }
      else {
        const jo = [].concat(D.조문?.조문단위 || []).filter(a => a.조문여부 === '조문');
        const a = E.artTitle ? jo.find(x => E.artTitle.test(x.조문제목 || '')) : jo.find(x => (x.조문번호 + (x.조문가지번호 ? '의' + x.조문가지번호 : '')) === E.art);
        text = a ? flatArticle(a) : '';
      }
      if (E.slice) { const m = text.match(E.slice); if (m) text = m[0]; }
      evidence[E.id] = { law: E.law, date: laws[E.law]?.date, text: text.slice(0, 7000) };
      if (E.check) { const m = text.match(E.check[0]); const v = m ? parseFloat(m[1]) : null; checks.push({ id: E.id, law: E.law, expected: E.check[1], found: v, ok: v === E.check[1] }); }
    }
    const parkNat = evidence.parkB1 ? parseParkingTable(evidence.parkB1.text.replace(/\|\s*(\d{1,2}\.)\s/g, '\n$1 ')).units : {};
    return { laws, evidence, checks, parkNat };
  }

  G.SyncCore = { parseZoneBylaw, expandZones, findBylaw, parseZoneTable, buildLocal, buildNational, parsePlan, parseBuilding, parseLandscapeOrd, parseParkingTable, parseScapeTiers, attachmentText, ordinArticles, koNum, disabledRatio, ZONE_NAMES };
})(typeof globalThis !== 'undefined' ? globalThis : window);
