// 가상인허가센터 데이터 동기화 (GitHub Actions에서 주 1회 실행)
// 사용: node permit-center/scripts/sync.mjs   (환경변수 LAW_OC: 국가법령정보 OPEN API 인증값, 없으면 'test')
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data');
new Function(fs.readFileSync(path.join(here, 'sync-core.js'), 'utf8'))();
const C = globalThis.SyncCore;

const BASE = 'https://www.law.go.kr';
const OC = process.env.LAW_OC || 'test';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(url, kind) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'permit-center-sync/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return kind === 'json' ? JSON.parse(await r.text()) : new Uint8Array(await r.arrayBuffer());
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}
const env = {
  getJSON: (p, params) => req(BASE + p + '?' + new URLSearchParams({ OC, ...params }), 'json'),
  getBytes: u => req(BASE + u.replace(/^https?:\/\/(www\.)?law\.go\.kr/, ''), 'bytes'),
  inflateRaw: async d => new Uint8Array(zlib.inflateRawSync(Buffer.from(d), { finishFlush: zlib.constants.Z_SYNC_FLUSH })),
  sleep, log: (...a) => console.log(...a)
};
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { fs.mkdirSync(path.dirname(path.join(DATA, f)), { recursive: true }); fs.writeFileSync(path.join(DATA, f), JSON.stringify(o)); };

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const prevMeta = readJSON('meta.json', { laws: {}, changes: [] });

// 1) 국가 법령
console.log('== 국가 법령');
const N = await C.buildNational(env);
const changes = [...(prevMeta.changes || [])];
for (const [name, v] of Object.entries(N.laws)) {
  const old = prevMeta.laws?.[name];
  if (old && v.date && old.date && old.date !== v.date) changes.unshift({ date: today, type: 'law', name, from: old.date, to: v.date, kind: v.kind || '', reviews: v.reviews || [] });
}
const failedChecks = N.checks.filter(c => !c.ok);
writeJSON('national.json', { updated: today, laws: N.laws, evidence: N.evidence, checks: N.checks, parkNat: N.parkNat });

// 2) 지자체 조례
console.log('== 지자체 조례');
const regions = await C.buildLocal(env);
const prevIdx = readJSON('regions.json', { regions: {} });
const index = {};
let i = 0;
for (const [org, R] of Object.entries(regions)) {
  const id = 'r' + String(++i).padStart(3, '0');
  const srcDates = ['plan', 'bld', 'scape', 'park'].map(k => R[k]?.src ? R[k].src.name + '@' + R[k].src.date : '').join('|');
  const old = prevIdx.regions?.[org];
  if (old && old.srcDates && old.srcDates !== srcDates) changes.unshift({ date: today, type: 'ordin', name: org, from: old.srcDates, to: srcDates });
  index[org] = {
    id, sido: R.sido, sgg: R.sgg, parent: R.parent, metroGu: !!R.metroGu, srcDates,
    bcr: R.plan?.bcr || {}, far: R.plan?.far || {},
    scapeTiers: R.bld?.scapeTiers || [], park: R.park?.units || {}, disabledPct: R.park?.disabledPct ?? null,
    has: { plan: !!R.plan, bld: !!R.bld?.scapeText, scape: !!R.scape?.bldText, park: !!(R.park && Object.keys(R.park.units || {}).length) }
  };
  writeJSON('r/' + id + '.json', R);
}
writeJSON('regions.json', { updated: today, count: Object.keys(index).length, regions: index });

const stat = k => Object.values(index).filter(x => x.has[k]).length;
const meta = { updated: today, laws: N.laws, changes: changes.slice(0, 200), failedChecks, coverage: { regions: Object.keys(index).length, plan: stat('plan'), landscapeRule: stat('bld'), scapeOrdin: stat('scape'), parking: stat('park') } };
writeJSON('meta.json', meta);
console.log('coverage', meta.coverage);

// 3) 이슈 본문 (변경 감지 시)
const newChanges = changes.filter(c => c.date === today);
if (newChanges.length || failedChecks.length) {
  const body = ['## 가상인허가센터 기준 변경 감지 (' + today + ')', '',
    ...newChanges.map(c => c.type === 'law' ? '- **' + c.name + '** 시행일 ' + c.from + ' → ' + c.to + ' (' + c.kind + ') — 영향: ' + c.reviews.join(', ') : '- 조례 개정: **' + c.name + '**'),
    ...(failedChecks.length ? ['', '### 자동 검증값 불일치 (rules.js 기준값 재확인 필요)', ...failedChecks.map(c => '- ' + c.law + ' [' + c.id + '] 기대값 ' + c.expected + ' / 원문 ' + c.found)] : []),
    '', '조례 수치(건폐율·용적률·주차·조경)는 이미 자동 반영되었습니다. 법령 개정은 판정 로직(rules.js) 검토가 필요합니다.'];
  fs.writeFileSync(path.join(DATA, '..', 'scripts', 'issue.md'), body.join('\n'));
  console.log('ISSUE');
}
