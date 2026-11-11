// 조문 감시 — law-watch.json 의 조문·별표 본문을 받아 지난번(data/law-watch.json)과 비교한다.
// 바뀐 것은 data/law-changes.json 에 쌓이고(업무 프로세스 첫 화면이 읽음), sync.mjs 가 Issue 본문에 붙인다.
// 사용: import { watchLaws } from './law-watch.mjs'; const r = await watchLaws(env, readJSON, writeJSON, today);
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const flat = (a) => { let t = (a.조문내용 || '') + ' '; [].concat(a.항 || []).forEach((h) => { t += (h.항내용 || '') + ' '; [].concat(h.호 || []).forEach((o) => { t += (o.호내용 || '') + ' '; [].concat(o.목 || []).forEach((m) => { t += [].concat(m.목내용 || []).join(' ') + ' '; }); }); }); return norm(t); };
const tbl = (c) => norm([].concat(c || []).map((x) => (Array.isArray(x) ? x.join(' ') : x)).join(' '));
const hash = (t) => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);

export async function watchLaws(env, readJSON, writeJSON, today) {
  const list = JSON.parse(fs.readFileSync(path.join(here, 'law-watch.json'), 'utf8')).items;
  const prev = readJSON('law-watch.json', { items: {} });
  const prevCh = readJSON('law-changes.json', { changes: [] });
  const items = {}, changes = [...(prevCh.changes || [])], errors = [];
  const docCache = {};
  async function doc(name, admrul) {
    const key = (admrul ? 'A:' : 'L:') + name;
    if (docCache[key]) return docCache[key];
    const target = admrul ? 'admrul' : 'law';
    const j = await env.getJSON('/DRF/lawSearch.do', { target, type: 'JSON', display: 20, query: name });
    const arr = [].concat((admrul ? j.AdmRulSearch?.admrul : j.LawSearch?.law) || []);
    const it = arr.find((x) => norm(x.법령명한글 || x.행정규칙명) === name) || arr[0];
    if (!it) throw new Error('법령 못 찾음: ' + name);
    const mst = it.법령일련번호 || it.행정규칙일련번호;
    const d = await env.getJSON('/DRF/lawService.do', { target, type: 'JSON', MST: mst });
    await env.sleep(120);
    return (docCache[key] = { date: it.시행일자, pub: it.공포일자 || it.발령일자, kind: it.제개정구분명, body: admrul ? d.AdmRulService || d : d.법령 });
  }
  for (const W of list) {
    try {
      const D = await doc(W.law, !!W.admrul);
      let text = '';
      if (W.bylaw) {
        const b = [].concat(D.body.별표?.별표단위 || []).find((x) => norm(x.별표제목 || '').startsWith(W.bylaw) || norm(x.별표번호 || '') === W.bylaw.replace(/별표\s*/, ''));
        text = b ? tbl(b.별표내용) : '';
      } else if (W.admrul) {
        const jo = [].concat(D.body.조문내용 || D.body.조문?.조문단위 || []);
        const a = jo.find((x) => String(x.조문번호 || '').replace(/^0+/, '') === W.art || norm(x.조문내용 || '').startsWith('제' + W.art + '조'));
        text = a ? flat(a) : norm(JSON.stringify(D.body)).match(new RegExp('제' + W.art + '조[^제]{0,6000}'))?.[0] || '';
      } else {
        const jo = [].concat(D.body.조문?.조문단위 || []).filter((a) => a.조문여부 === '조문');
        const a = jo.find((x) => (x.조문번호 + (x.조문가지번호 ? '의' + x.조문가지번호 : '')) === W.art);
        text = a ? flat(a) : '';
      }
      if (!text) { errors.push(W.id + ': 본문 없음 (' + W.law + ' ' + (W.art || W.bylaw) + ')'); continue; }
      const h = hash(text), old = prev.items?.[W.id];
      items[W.id] = { law: W.law, art: W.art || W.bylaw, keys: W.keys || [], date: D.date, hash: h, text: text.slice(0, 3000), seen: today };
      if (old && old.hash && old.hash !== h) {
        changes.unshift({ date: today, id: W.id, law: W.law, art: W.art || W.bylaw, keys: W.keys || [], from: { date: old.date, hash: old.hash }, to: { date: D.date, hash: h }, kind: D.kind || '' });
      }
    } catch (e) { errors.push(W.id + ': ' + String(e.message || e)); if (prev.items?.[W.id]) items[W.id] = prev.items[W.id]; }
  }
  writeJSON('law-watch.json', { updated: today, items });
  writeJSON('law-changes.json', { updated: today, changes: changes.slice(0, 100), errors });
  const todayCh = changes.filter((c) => c.date === today);
  return { items, changes: todayCh, errors, count: Object.keys(items).length };
}
