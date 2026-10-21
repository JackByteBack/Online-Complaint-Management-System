'use strict';
/* screenshot.js — captures every key OCMS page into ./screenshots using headless Chrome.
 * Logs in once per role over HTTP, injects the session cookie via CDP, then screenshots.
 *   node screenshot.js     (needs the server on :3000 running)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const M = require('./models');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, 'screenshots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9223;
const VW = 1440, VH = 1000, SCALE = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loginCookie(email, password) {
  const r = await fetch(BASE + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual'
  });
  const sc = r.headers.get('set-cookie');
  if (!sc) throw new Error(`login failed for ${email} (HTTP ${r.status})`);
  return sc.split(';')[0]; // ocms_sid=...
}

// ---- tiny CDP client over Node's built-in WebSocket ----
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  let idc = 0;
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) events.forEach(h => h(m));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++idc;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = (name, ms = 8000) => new Promise(resolve => {
    const t = setTimeout(() => { i = () => {}; resolve(false); }, ms); // resolve(false) on timeout
    let i = h => { if (h.method === name) { clearTimeout(t); i = () => {}; events.splice(events.indexOf(h), 1); resolve(true); } };
    events.push(i);
  });
  ws.addEventListener('open', () => ws.__ready && ws.__ready());
  return { ws, send, waitEvent };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // pick the best-owned ticket for the detail shot: richest timeline, prefer In Progress/Resolved
  await mongoose.connect('mongodb://127.0.0.1:27017/ocms');
  const ravi = await M.User.findOne({ email: 'ravi@proton.test' }).lean();
  const mine = await M.Complaint.find({ citizenId: ravi._id }).select('ticketNo status').lean();
  const counts = await M.Update.aggregate([
    { $match: { complaintId: { $in: mine.map(c => c._id) } } },
    { $group: { _id: '$complaintId', n: { $sum: 1 } } },
    { $sort: { n: -1 } }
  ]);
  const byId = _id => mine.find(c => String(c._id) === String(_id));
  const nice = counts.map(c => byId(c._id)).find(c => c && ['In Progress', 'Resolved'].includes(c.status))
    || mine.find(c => c.status === 'Resolved') || mine[0];
  const complaintUrl = nice ? `/complaints/${nice._id}` : '/dashboard';
  console.log('detail ticket:', nice && nice.ticketNo);
  await mongoose.disconnect();

  // one session cookie per role
  const admin = await loginCookie('admin@ocms.test', 'Admin@12345');
  const officer = await loginCookie('road@ocms.test', 'Officer@123');
  const citizen = await loginCookie('ravi@proton.test', 'Citizen@123');

  // launch headless chrome
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ocms-shots-'));
  const chrome = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${VW},${VH}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'
  ], { stdio: 'ignore' });

  // wait for the debug endpoint, then attach to the page target (browser-level WS only supports Target.*)
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find(t => t.type === 'page');
    } catch { /* chrome still booting */ }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('no chrome page target found');

  const { ws, send, waitEvent } = cdp(page.webSocketDebuggerUrl);
  const opened = new Promise(r => { ws.__ready = r; ws.addEventListener('open', r); });
  await Promise.race([opened, sleep(3000)]);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: SCALE, mobile: false });

  const cookie = async value => {
    if (!value) return;
    await send('Network.setCookie', { name: 'ocms_sid', value: value.split('=')[1], url: BASE, httpOnly: true });
  };

  const shot = async (name, url, { full = false } = {}) => {
    if (url) {
      const loaded = waitEvent('Page.loadEventFired');
      await send('Page.navigate', { url: BASE + url });
      await loaded || sleep(2500);
      await sleep(600); // let EJS paint settle
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('✔', name);
  };

  // ---- public pages ----
  await cookie(null);
  await shot('01-home', '/');
  await shot('02-login', '/login');
  await shot('03-register', '/register');
  await shot('04-faqs', '/faqs');
  await shot('05-search-text-search', '/search?q=pothole');
  await shot('06-search-combo-filters', '/search?priority=High&priority=Critical&status=In%20Progress&status=Submitted&due=1');

  // ---- citizen ----
  await cookie(citizen);
  await shot('07-citizen-dashboard', '/dashboard');
  await shot('08-file-complaint', '/complaints/new');
  await shot('09-complaint-detail', complaintUrl, { full: true });
  await shot('10-notifications', '/notifications');
  await shot('11-profile', '/profile');
  await shot('12-access-guard-403', '/admin');   // citizen blocked from admin — role guard

  // ---- officer ----
  await cookie(officer);
  await shot('13-officer-queue', '/queue');

  // ---- admin ----
  await cookie(admin);
  await shot('14-admin-overview', '/admin');
  await shot('15-admin-manage', '/admin/manage', { full: true });
  await shot('16-admin-users', '/admin/users?role=citizen&role=officer');
  await shot('17-reports-aggregations', '/reports', { full: true });
  await shot('18-audit-log', '/audit');
  await shot('19-portal-settings', '/admin/settings');

  chrome.kill();
  await Promise.race([
    new Promise(r => chrome.on('exit', r)),
    sleep(2000)
  ]);
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('\ndone →', OUT);
  process.exit(0);
}

main().catch(e => { console.error('SCREENSHOT ERROR:', e.message); process.exit(1); });
