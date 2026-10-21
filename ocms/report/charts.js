'use strict';
/* charts.js — generates the report graphs from LIVE aggregation results.
 * Runs the same pipelines as the /reports page (routes.js), renders them as SVG
 * bar charts, and converts each to PNG with headless Chrome.
 *   node report/charts.js      (MongoDB must be running; PNG step needs Chrome)
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = __dirname;
const INK = '#1c2430', MUTED = '#68737f', LINE = '#e3e8ee';
const GREEN = '#0e7a5f', GREEN2 = '#35b98e', RED = '#c23616', BLUE = '#2456b8';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function frame(title, subtitle, inner, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="-apple-system, 'Segoe UI', sans-serif">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="40" y="46" font-size="24" font-weight="700" fill="${INK}">${esc(title)}</text>
<text x="40" y="72" font-size="13" fill="${MUTED}">${esc(subtitle)}</text>
${inner}
<text x="40" y="${height - 18}" font-size="11" fill="${MUTED}">Source: aggregation pipeline on ocms.complaints (seed data) — generated ${new Date().toISOString().slice(0, 10)}</text>
</svg>`;
}

/* horizontal bars — rows: [{label, value, note, color}] */
function barsH(rows, { max, width = 1060, unit = '', color = GREEN }) {
  const rowH = 46, top = 110, W = width - 420;   // 420px reserved: labels (190) + value gutter (230)
  max = max || Math.max(...rows.map(r => r.value), 1);
  const inner = rows.map((r, i) => {
    const y = top + i * rowH, w = Math.max(4, r.value / max * (W - 10));
    return `<text x="40" y="${y + 16}" font-size="14" fill="${INK}">${esc(r.label)}</text>
<rect x="230" y="${y + 3}" width="${W}" height="20" rx="10" fill="${LINE}"/>
<rect x="230" y="${y + 3}" width="${w}" height="20" rx="10" fill="${r.color || color}"/>
<text x="${230 + w + 10}" y="${y + 18}" font-size="13" font-weight="700" fill="${INK}">${r.value}${unit}${r.note ? `  <tspan font-weight="400" fill="${MUTED}">· ${esc(r.note)}</tspan>` : ''}</text>`;
  }).join('\n');
  return frame('', '', inner, width, top + rows.length * rowH + 70);
}

/* grouped vertical bars for monthly trend — [{month, filed, resolved}] */
function trendChart(rows) {
  const width = 1060, top = 130, plotH = 320, rowW = (width - 200) / rows.length;
  const max = Math.max(...rows.map(r => Math.max(r.filed, r.resolved)), 1);
  let inner = `<line x1="50" y1="${top + plotH}" x2="${width - 40}" y2="${top + plotH}" stroke="${LINE}" stroke-width="2"/>`;
  rows.forEach((r, i) => {
    const cx = 90 + i * rowW;
    const fh = Math.max(4, r.filed / max * plotH), rh = Math.max(4, r.resolved / max * plotH);
    inner += `
<rect x="${cx}" y="${top + plotH - fh}" width="38" height="${fh}" rx="6" fill="${GREEN}"/>
<rect x="${cx + 42}" y="${top + plotH - rh}" width="38" height="${rh}" rx="6" fill="${GREEN2}"/>
<text x="${cx + 38}" y="${top + plotH + 26}" font-size="14" fill="${INK}" text-anchor="middle">${esc(r.month)}</text>
<text x="${cx + 19}" y="${top + plotH - fh - 8}" font-size="13" font-weight="700" fill="${INK}" text-anchor="middle">${r.filed}</text>
<text x="${cx + 61}" y="${top + plotH - rh - 8}" font-size="13" font-weight="700" fill="${INK}" text-anchor="middle">${r.resolved}</text>`;
  });
  inner += `
<rect x="60" y="88" width="16" height="16" rx="4" fill="${GREEN}"/>     <text x="82" y="101" font-size="13" fill="${INK}">Filed</text>
<rect x="150" y="88" width="16" height="16" rx="4" fill="${GREEN2}"/>  <text x="172" y="101" font-size="13" fill="${INK}">Resolved / Closed</text>`;
  return frame('', '', inner.replace('<text x="40" y="46"', '<text x="40" y="46" style="display:none"'), width, top + plotH + 80);
}

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/ocms');
  const now = new Date();
  const sixMonths = new Date(now.getTime() - 183 * 86400000);
  const C = mongoose.connection.collection('complaints');
  const F = mongoose.connection.collection('feedbacks');

  // same pipelines as routes.js → reports()
  const dept = await C.aggregate([
    { $match: { status: { $in: ['Resolved', 'Closed'] }, resolvedAt: { $exists: true, $ne: null } } },
    { $group: { _id: '$departmentId', resolved: { $sum: 1 }, avgDays: { $avg: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 86400000] } } } },
    { $sort: { resolved: -1 } },
    { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
    { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, name: '$dept.name', code: '$dept.code', resolved: 1, avgDays: { $round: ['$avgDays', 1] } } }
  ]).toArray();

  const trend = (await C.aggregate([
    { $match: { createdAt: { $gte: sixMonths } } },
    { $group: { _id: { ym: { $dateToString: { format: '%Y-%m', date: '$createdAt' } } }, filed: { $sum: 1 }, resolved: { $sum: { $cond: [{ $in: ['$status', ['Resolved', 'Closed']] }, 1, 0] } } } },
    { $project: { _id: 0, month: '$_id.ym', filed: 1, resolved: 1 } },
    { $sort: { month: 1 } },
    { $limit: 6 }
  ]).toArray());   // chronological oldest → newest (sort asc above)
  //

  const matrix = await C.aggregate([
    { $group: { _id: { status: '$status', priority: '$priority' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, status: '$_id.status', priority: '$_id.priority', count: 1 } }
  ]).toArray();

  const tags = await C.aggregate([
    { $match: { tags: { $exists: true, $ne: [] } } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, tag: '$_id', count: 1 } }
  ]).toArray();

  const satisf = (await F.aggregate([
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
    { $project: { _id: 0, avg: { $round: ['$avg', 2] }, n: 1 } }
  ]).toArray())[0] || { avg: '—', n: 0 };

  const totalOpen = await C.countDocuments({ status: { $in: ['Submitted', 'In Progress'] } });
  const breached = await C.countDocuments({ status: { $in: ['Submitted', 'In Progress'] }, dueAt: { $lt: now } });
  await mongoose.disconnect();

  /* ---- build the four charts ---- */
  const charts = [];

  charts.push({
    name: '01-department-performance',
    svg: barsH(dept.map(d => ({
      label: `${d.name || '—'} (${d.code || ''})`, value: d.resolved,
      note: `avg ${d.avgDays} days to resolve`, color: GREEN
    })), { unit: '' })
  });

  charts.push({
    name: '02-monthly-trend',
    svg: trendChart(trend)
  });

  const stColor = s => ({ Submitted: BLUE, 'In Progress': '#b7791f', Resolved: GREEN, Closed: GREEN, Rejected: RED }[s] || MUTED);
  charts.push({
    name: '03-status-priority-matrix',
    svg: barsH(matrix.map(m => ({
      label: `${m.status} · ${m.priority}`, value: m.count, color: stColor(m.status)
    })), { color: GREEN })
  });

  charts.push({
    name: '04-top-tags',
    svg: barsH(tags.map(t => ({ label: `#${t.tag}`, value: t.count })), { color: GREEN2 })
  });

  for (const c of charts) {
    fs.writeFileSync(path.join(DIR, 'charts', c.name + '.svg'), c.svg);
    console.log('svg →', c.name);
  }

  // svg → png via one-shot headless chrome
  for (const c of charts) {
    const svg = path.join(DIR, 'charts', c.name + '.svg');
    const png = path.join(DIR, 'charts', c.name + '.png');
    const m = fs.readFileSync(svg, 'utf8').match(/width="(\d+)" height="(\d+)"/);
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      `--screenshot=${png}`, `--window-size=${m[1]},${m[2]}`,
      `--default-background-color=FFFFFFFF`, 'file://' + svg
    ], { stdio: 'ignore' });
    console.log('png →', c.name);
  }

  // KPI meta as plain text for the report
  fs.writeFileSync(path.join(DIR, 'charts', 'kpi.json'), JSON.stringify({
    open: totalOpen, slaBreached: breached, avgRating: satisf.avg, ratedTickets: satisf.n,
    deptPerformance: dept, monthlyTrend: trend
  }, null, 2));

  console.log('\ncharts done', '(KPIs:', `open=${totalOpen}, breached=${breached}, avgRating=${satisf.avg} of ${satisf.n})`);
  process.exit(0);
})().catch(e => { console.error('CHART ERROR:', e); process.exit(1); });
