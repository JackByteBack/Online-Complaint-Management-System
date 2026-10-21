'use strict';
// spotcheck.js — admin flows not covered by smoke.js: assign, escalate, settings, ward create.
const jar = {};
async function req(m, p, form) {
  const headers = {};
  if (jar.j) headers.cookie = jar.j;
  let body;
  if (form) { body = new URLSearchParams(form).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch('http://localhost:3000' + p, { method: m, headers, body, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) jar.j = sc.split(';')[0];
  return { s: r.status, t: await r.text(), loc: r.headers.get('location') };
}

(async () => {
  const l = await req('POST', '/login', { email: 'admin@ocms.test', password: 'Admin@12345' });
  console.log('admin login:', l.s, l.loc);

  const q = await req('GET', '/search?status=Submitted');
  const ids = [...q.t.matchAll(/\/complaints\/([a-f0-9]{24})/g)].map(x => x[1]);
  console.log('submitted tickets found:', ids.length);

  let tid = null, offId = null;
  for (const id of ids) {
    const cp = await req('GET', '/complaints/' + id);
    if (cp.s !== 200) { console.log('  ticket', id.slice(-6), 'status', cp.s); continue; }
    const m = cp.t.match(/name="officerUserId"[\s\S]*?<option value="([a-f0-9]{24})"/);
    if (m) { tid = id; offId = m[1]; break; }
  }
  console.log('ticket with officer available:', tid && tid.slice(-6), 'officer:', offId && offId.slice(-6));
  if (!tid) { console.log('no submitted ticket had an officer dropdown entry'); process.exit(1); }

  const asr = await req('POST', '/complaints/' + tid + '/assign', { officerUserId: offId, note: 'spot-check dispatch' });
  console.log('assign →', asr.s, asr.loc);

  const esc = await req('POST', '/complaints/' + tid + '/escalate', { reason: 'manual spot check' });
  console.log('escalate →', esc.s, esc.loc);

  const cd = await req('GET', '/complaints/' + tid);
  console.log('detail after:', cd.s, '| Critical badge:', cd.t.includes('pr-Critical'), '| escalation entry:', cd.t.includes('Escalation'), '| reassignment entry:', cd.t.includes('Reassignment'));

  await req('POST', '/admin/settings', { key: 'portalOpen', value: 'true' });
  const sp = await req('GET', '/admin/settings?ok=1');
  console.log('settings page:', sp.s === 200, '| saved alert:', sp.t.includes('alert ok'));

  await req('POST', '/admin/wards', { code: 'W-Z9', name: 'SpotCheck Ward', city: 'Mumbai', population: '5' });
  const mg = await req('GET', '/admin/manage');
  const wardRow = mg.t.indexOf('W-Z9');
  const wardId = wardRow > 0 ? (mg.t.slice(wardRow, wardRow + 600).match(/wards\/([a-f0-9]{24})\/delete/) || [])[1] : null;
  console.log('ward created + listed:', Boolean(wardId));
  if (wardId) {
    const gRes = await req('POST', '/admin/wards/' + wardId + '/delete');
    console.log('ward deleted:', gRes.s === 302);
  }

  const sla = await req('POST', '/admin/sla', { categoryCode: 'ROAD', priority: 'High', maxDays: '9' });
  const mg2 = await req('GET', '/admin/manage');
  console.log('sla upsert visible:', sla.s === 302 && mg2.t.includes('<td>9</td>'));

  console.log('\nSPOTCHECK DONE');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
