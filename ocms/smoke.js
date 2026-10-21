'use strict';
// smoke.js — runs the whole app end-to-end over HTTP against a seeded database.
//   node smoke.js            (expects the server running on :3000)
// Prints PASS/FAIL per step and exits non-zero on the first failure.

const BASE = process.env.SMOKE_URL || 'http://localhost:3000';
const jars = {}; // named cookie jars

async function req(jar, method, path, form) {
  const headers = {};
  if (jars[jar]) headers.cookie = jars[jar];
  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jars[jar] = setCookie.split(';')[0];
  const text = await res.text();
  return { status: res.status, text, location: res.headers.get('location') };
}

let failed = 0;
const steps = [];
async function step(name, fn) {
  try {
    await fn();
    steps.push(`PASS  ${name}`);
  } catch (e) {
    failed++;
    steps.push(`FAIL  ${name} — ${e.message}`);
    throw new Error(`smoke failed at: ${name}: ${e.message}`);
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  let ticketUrl;

  await step('home page renders', async () => {
    const r = await req('anon', 'GET', '/');
    expect(r.status === 200, `status ${r.status}`);
    expect(r.text.includes('File Complaint') || r.text.includes('Register'), 'hero CTA missing');
  });

  await step('register citizen', async () => {
    const r = await req('c1', 'POST', '/register', { name: 'Smoke Citizen', email: `smoke${Date.now()}@t.test`, password: 'Password123' });
    expect(r.status === 302 && r.location === '/dashboard', JSON.stringify({ status: r.status, loc: r.location }));
    const d = await req('c1', 'GET', '/dashboard');
    expect(d.status === 200 && d.text.includes('Smoke Citizen'), 'dashboard missing name');
  });

  await step('create complaint', async () => {
    const r = await req('c1', 'POST', '/complaints', {
      title: 'Smoke pothole on test street', description: 'Deep pothole created by the smoke test, dangerously deep.',
      categoryCode: 'POTHOLE', priority: 'High', wardId: '', tags: 'smoke,test'
    });
    expect(r.status === 302 && /\/complaints\/[a-f0-9]{24}/.test(r.location), JSON.stringify({ status: r.status, loc: r.location }));
    ticketUrl = r.location;
    const d = await req('c1', 'GET', ticketUrl);
    expect(d.status === 200 && d.text.includes('OCMS-'), 'ticket page missing ticketNo');
    expect(d.text.includes('#smoke'), 'tags missing');
  });

  await step('comment as citizen', async () => {
    const r = await req('c1', 'POST', `${ticketUrl}/updates`, { text: 'Smoke comment from citizen' });
    expect(r.status === 302, `status ${r.status}`);
    const d = await req('c1', 'GET', ticketUrl);
    expect(d.text.includes('Smoke comment from citizen'), 'comment missing');
  });

  await step('attachment upload', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const r = await req('c1', 'POST', `${ticketUrl}/attachments`, { name: 'smoke.png', mime: 'image/png', data: png });
    expect(r.status === 302, `status ${r.status}`);
  });

  await step('officer login + queue', async () => {
    const login = await req('o1', 'POST', '/login', { email: 'road@ocms.test', password: 'Officer@123' });
    expect(login.status === 302, `login ${login.status}`);
    const q = await req('o1', 'GET', '/queue');
    expect(q.status === 200, `queue ${q.status}`);
  });

  await step('officer resolves ticket', async () => {
    const r = await req('o1', 'POST', `${ticketUrl}/status`, { status: 'Resolved', note: 'Patched by smoke crew' });
    expect(r.status === 302, `status ${r.status}`);
    const d = await req('c1', 'GET', ticketUrl);
    expect(d.text.includes('Patched by smoke crew'), 'resolution note missing');
  });

  await step('citizen rates + closes', async () => {
    const f = await req('c1', 'POST', `${ticketUrl}/feedback`, { rating: '5', comment: 'Fixed fast' });
    expect(f.status === 302, `feedback ${f.status}`);
    const c = await req('c1', 'POST', `${ticketUrl}/close`);
    expect(c.status === 302, `close ${c.status}`);
    const d = await req('c1', 'GET', ticketUrl);
    expect(d.text.includes('st-Closed'), 'status not Closed');
  });

  await step('admin login + pages', async () => {
    const l = await req('a1', 'POST', '/login', { email: 'admin@ocms.test', password: 'Admin@12345' });
    expect(l.status === 302 && l.location === '/admin', `login ${l.status} ${l.location}`);
    for (const p of ['/admin', '/admin/manage', '/admin/users', '/reports', '/audit', '/admin/settings', '/notifications']) {
      const r = await req('a1', 'GET', p);
      expect(r.status === 200, `${p} → ${r.status}`);
    }
  });

  await step('reports pipelines return data', async () => {
    const r = await req('a1', 'GET', '/reports');
    expect(r.text.includes('Pipeline 1'), 'pipeline sections missing');
    expect(r.text.includes('Roads'), 'department rows missing');
  });

  await step('text search + filters', async () => {
    const t = await req('a1', 'GET', '/search?q=pothole');
    expect(t.status === 200 && t.text.includes('matching ticket'), 'text search failed');
    const f = await req('a1', 'GET', '/search?priority=High&priority=Critical&status=Submitted&due=1&tags=smoke');
    expect(f.status === 200, 'combo filters failed');
  });

  await step('create + guard + delete flow (admin)', async () => {
    const deps = await req('a1', 'GET', '/admin/manage');
    const deptId = (deps.text.match(/value="([a-f0-9]{24})"/) || [])[1];
    const ok = await req('a1', 'POST', '/admin/categories', { code: 'SMK', name: 'Smoke Category', departmentId: deptId });
    expect(ok.status === 302, `create ${ok.status}`);
    // duplicate code → unique-index catch on 11000 → redirect carries the message
    const held = await req('a1', 'POST', '/admin/categories', { code: 'SMK', name: 'Dup', departmentId: deptId });
    expect(held.status === 302 && /already\+?exists/.test(held.location || ''), `duplicate guard: ${held.status} ${held.location}`);
    // find the SMK row's own delete link and delete it
    const page = await req('a1', 'GET', '/admin/manage');
    const pos = page.text.indexOf('>SMK<');
    expect(pos > 0, 'SMK row missing');
    const seg = page.text.slice(pos, pos + 2000);
    const del = seg.match(/\/admin\/categories\/([a-f0-9]{24})\/delete/);
    expect(del, 'delete form missing for SMK row');
    const res = await req('a1', 'POST', `/admin/categories/${del[1]}/delete`);
    expect(res.status === 302, `delete ${res.status}`);
    const after = await req('a1', 'GET', '/admin/manage');
    expect(after.text.indexOf('>SMK<') < 0, 'SMK still listed after delete');
  });

  await step('notifications mark read', async () => {
    const r = await req('c1', 'POST', '/notifications/read');
    expect(r.status === 302, `status ${r.status}`);
    const p = await req('c1', 'GET', '/notifications');
    expect(p.text.includes('unread') === false || p.text.includes('new') === false, 'still unread');
  });

  await step('role guards block', async () => {
    const r = await req('c1', 'GET', '/admin');
    expect(r.status === 403, `citizen accessing /admin → ${r.status}`);
    const a = await req('o1', 'GET', '/admin');
    expect(a.status === 403, `officer accessing /admin → ${a.status}`);
    const n = await req('anon', 'GET', '/dashboard', undefined);
    expect(n.status === 302, `anon → ${n.status}`);
    const nf = await req('anon', 'GET', '/nope/deep');
    expect(nf.status === 404, `404 page → ${nf.status}`);
  });

  console.log(steps.join('\n'));
  console.log(failed ? `\n${failed} FAILED` : '\nALL SMOKE TESTS PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(steps.join('\n')); console.error('SMOKE ERROR:', e.message); process.exit(1); });
