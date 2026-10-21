'use strict';
// seed.js — wipes the dev database and fills all 20 collections with realistic demo data.
//   node seed.js
// Reads MONGO_URI from .env when present. WARNING: drops the target database first.

require('./env');
const mongoose = require('mongoose');
const M = require('./models');
const A = require('./auth');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ocms';

function rng(seed) { // deterministic pseudo-random so re-seeds look the same
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}
const rand = rng(2026);
const pick = arr => arr[Math.floor(rand() * arr.length)];
const daysAgo = n => new Date(Date.now() - n * 86400000);

async function main() {
  await mongoose.connect(MONGO_URI);
  await mongoose.connection.dropDatabase(); // dev-only: wipe before seeding
  console.log('· wiped database');

  /* departments ----------------------------------------------------------- */
  const departments = await M.Department.insertMany([
    { code: 'ROAD', name: 'Roads & Transport', head: 'K. Jadhav', email: 'roads@city.gov', categories: ['ROAD', 'POTHOLE', 'STREETLIGHT', 'TRAFFIC'] },
    { code: 'WTR', name: 'Water Supply', head: 'S. More', email: 'water@city.gov', categories: ['WATER', 'SEWAGE'] },
    { code: 'WST', name: 'Waste Management', head: 'P. Nair', email: 'waste@city.gov', categories: ['GARBAGE', 'DRAINAGE', 'STRAYANIMAL'] },
    { code: 'HLT', name: 'Public Health', head: 'Dr. M. Shah', email: 'health@city.gov', categories: ['SCHOOL', 'POLLUTION'] },
    { code: 'ELC', name: 'Power & Utilities', head: 'R. Fernandes', email: 'power@city.gov', categories: ['STREETLIGHT', 'POLLUTION'] }
  ]);
  const deptByCode = Object.fromEntries(departments.map(d => [d._id.toString(), d]));
  const deptForCategory = c => departments.find(d => d.categories.includes(c));

  /* wards ------------------------------------------------------------------ */
  const wards = await M.Ward.insertMany([
    { code: 'W-A1', name: 'Colaba', population: 168000 },
    { code: 'W-B2', name: 'Bandra West', population: 312000 },
    { code: 'W-C3', name: 'Andheri East', population: 529000 },
    { code: 'W-D4', name: 'Dadar', population: 241000 },
    { code: 'W-E5', name: 'Malad', population: 385000 }
  ]);

  /* categories ------------------------------------------------------------- */
  const categories = await M.Category.insertMany([
    { code: 'ROAD', name: 'Damaged Road', icon: '🛣️', description: 'Cracks, broken surface, missing manhole covers', departmentId: deptForCategory('ROAD')._id, totalFiled: 12 },
    { code: 'POTHOLE', name: 'Pothole', icon: '🕳️', description: 'Deep potholes endangering traffic', departmentId: deptForCategory('POTHOLE')._id, totalFiled: 9 },
    { code: 'WATER', name: 'Water Supply Issue', icon: '💧', description: 'No water, low pressure, contamination', departmentId: deptForCategory('WATER')._id, totalFiled: 11 },
    { code: 'SEWAGE', name: 'Sewage Blockage', icon: '🚿', description: 'Choked drains, overflowing sewers', departmentId: deptForCategory('SEWAGE')._id, totalFiled: 6 },
    { code: 'STREETLIGHT', name: 'Street Light Outage', icon: '💡', description: 'Non-functional street lights', departmentId: deptForCategory('STREETLIGHT')._id, totalFiled: 8 },
    { code: 'GARBAGE', name: 'Garbage Collection', icon: '🗑️', description: 'Missed pickups, overflowing bins', departmentId: deptForCategory('GARBAGE')._id, totalFiled: 14 },
    { code: 'DRAINAGE', name: 'Clogged Drainage', icon: '🌊', description: 'Waterlogging during rain', departmentId: deptForCategory('DRAINAGE')._id, totalFiled: 4 },
    { code: 'STRAYANIMAL', name: 'Stray Animal Menace', icon: '🐕', description: 'Aggressive stray animals', departmentId: deptForCategory('STRAYANIMAL')._id, totalFiled: 2 },
    { code: 'POLLUTION', name: 'Pollution Complaint', icon: '🏭', description: 'Air/noise/water pollution', departmentId: deptForCategory('POLLUTION')._id, totalFiled: 3 },
    { code: 'TRAFFIC', name: 'Traffic Signal Fault', icon: '🚦', description: 'Broken / mistimed signals', departmentId: deptForCategory('TRAFFIC')._id, totalFiled: 5 }
  ]);

  /* sla_rules -------------------------------------------------------------- */
  const slaRules = [];
  for (const c of categories) for (const [p, d] of [['Low', 30], ['Medium', 15], ['High', 7], ['Critical', 2]]) {
    slaRules.push({ categoryCode: c.code, priority: p, maxDays: d });
  }
  await M.SlaRule.insertMany(slaRules);

  /* users ------------------------------------------------------------------ */
  const mk = (name, email, password, role, phone) => {
    const { salt, hash } = A.hashPassword(password);
    return { name, email, passwordHash: hash, passwordSalt: salt, role, phone, createdAt: daysAgo(300) };
  };
  const [admin, offRoadman, offWaterman, offWasteQueen, offElck] = await M.User.insertMany([
    mk('Municipal Administrator', 'admin@ocms.test', 'Admin@12345', 'admin', '+919990000001'),
    mk('R. Sawant', 'road@ocms.test', 'Officer@123', 'officer', '+919990000002'),
    mk('K. Deshmukh', 'water@ocms.test', 'Officer@123', 'officer', '+919990000003'),
    mk('A. Shaikh', 'waste@ocms.test', 'Officer@123', 'officer', '+919990000004'),
    mk('R. Fernandes', 'power@ocms.test', 'Officer@123', 'officer', '+919990000005')
  ]);
  const citizensData = [
    mk('Ravi Patil', 'ravi@proton.test', 'Citizen@123', 'citizen', '+919512000001'),
    mk('Sneha Rao', 'sneha@proton.test', 'Citizen@123', 'citizen', '+919512000002'),
    mk('Iqbal Khan', 'iqbal@proton.test', 'Citizen@123', 'citizen', '+919512000003'),
    mk('Meera Joshi', 'meera@proton.test', 'Citizen@123', 'citizen', '+919512000004'),
    mk('D. Fernandes', 'deelip@proton.test', 'Citizen@123', 'citizen', '+919512000005')
  ];
  const citizens = await M.User.insertMany(citizensData);

  /* citizens + officers profiles ------------------------------------------- */
  const wardMap = Object.fromEntries(wards.map((w, i) => [citizens[i % wards.length]._id, wards[i]]));
  await M.Citizen.insertMany(citizens.map(u => ({
    userId: u._id,
    address: { street: `${10 + Math.floor(rand() * 300)} ${pick(['Hill Rd', 'MG Rd', 'LBS Marg', 'Marine Drive', 'SV Rd'])}`, city: 'Mumbai', pincode: `4000${50 + Math.floor(rand() * 49)}`, wardId: wardMap[u._id]?._id }
  })));
  const officers = await M.Officer.insertMany([
    { userId: offRoadman._id, departmentId: departments[0]._id, designation: 'Road Maintenance Engineer', openCases: 0 },
    { userId: offWaterman._id, departmentId: departments[1]._id, designation: 'Water Works Supervisor', openCases: 0 },
    { userId: offWasteQueen._id, departmentId: departments[2]._id, designation: 'Sanitation Officer', openCases: 0 },
    { userId: offElck._id, departmentId: departments[4]._id, designation: 'Utilities Inspector', openCases: 0 }
  ]);
  const officerForDept = deptId => officers.find(o => String(o.departmentId) === String(deptId))?.userId || admin._id;

  /* complaints -------------------------------------------------------------- */
  const titles = {
    ROAD: 'Tar has come off near the bus stop',
    POTHOLE: 'Large pothole causing accidents',
    WATER: 'No water supply since Monday',
    SEWAGE: 'Sewage water overflowing on the road',
    STREETLIGHT: 'Street lights not working for a week',
    GARBAGE: 'Garbage not collected for four days',
    DRAINAGE: 'Storm drain blocked, waterlogging risk',
    STRAYANIMAL: 'Stray dog pack threatening pedestrians',
    POLLUTION: 'Construction dust covering the whole street',
    TRAFFIC: 'Traffic signal stuck on red for hours'
  };
  const tagPool = ['monsoon', 'urgent', 'repeat', 'elderly-area', 'school-route', 'nights', 'bump', 'smell'];
  const statuses = ['Submitted', 'In Progress', 'Resolved', 'Closed', 'Rejected'];
  const priorities = [['Low', 0], ['Medium', 1], ['High', 2], ['Critical', 3]];

  const complaintDocs = [];
  for (let i = 0; i < 34; i++) {
    const cat = pick(categories);
    const [priority, rank] = pick(priorities);
    const created = daysAgo(Math.floor(rand() * 170) + 1); // spread over ~6 months
    const rule = await M.SlaRule.findOne({ categoryCode: cat.code, priority }).lean();
    const dueAt = new Date(created.getTime() + (rule ? rule.maxDays : 15) * 86400000);
    const status = i < 8 ? 'Submitted' : pick(statuses);
    const tags = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(tagPool)))];
    const officerOfficer = officers.find(o => o.departmentId.toString() === cat.departmentId.toString());
    complaintDocs.push({
      ticketNo: `OCMS-${created.getFullYear()}-${String(i + 1).padStart(5, '0')}`,
      title: titles[cat.code], description: `${titles[cat.code]}. The issue is at ${pick(['plot 4', 'the corner near the school', 'building no 12', 'the market lane', 'sector 2 playground'])} and has been going worse for days. Kindly depute a team.`,
      citizenId: pick(citizens)._id, categoryCode: cat.code, departmentId: cat.departmentId,
      wardId: pick(wards)._id, status, priority, priorityRank: rank, tags,
      assignedOfficerId: status === 'Submitted' ? undefined : officerForDept(cat.departmentId),
      createdAt: created, dueAt,
      resolvedAt: ['Resolved', 'Closed'].includes(status) ? new Date(created.getTime() + (1 + rand() * 20) * 86400000) : undefined,
      resolution: ['Resolved', 'Closed'].includes(status) ? { note: pick(['Patched the surface and re-tarred the section.', 'Pipeline junction replaced; pressure restored.', 'Dedicated collection van rescheduled to the lane.', 'Light fitting replaced and circuit tested.']), resolvedBy: officerForDept(cat.departmentId) } : undefined
    });
  }
  const complaints = await M.Complaint.insertMany(complaintDocs);

  /* complaint_updates -------------------------------------------------------- */
  const updateDocs = [];
  for (const c of complaints) {
    updateDocs.push({ complaintId: c._id, authorId: c.citizenId, authorName: 'Citizen', kind: 'Comment', text: 'Complaint submitted.', createdAt: c.createdAt });
    if (c.status !== 'Submitted') {
      updateDocs.push({ complaintId: c._id, authorId: officerForDept(c.departmentId), authorName: 'Officer', kind: 'StatusChange', oldStatus: 'Submitted', newStatus: 'In Progress', text: 'Ticket accepted and queued for inspection.', createdAt: new Date(c.createdAt.getTime() + 86400000) });
    }
    if (c.resolution && c.resolution.note) {
      updateDocs.push({ complaintId: c._id, authorId: c.resolution.resolvedBy, authorName: 'Officer', kind: 'StatusChange', oldStatus: 'In Progress', newStatus: pick(['Resolved', 'Closed']), text: c.resolution.note, createdAt: c.resolvedAt });
    }
  }
  const bad = updateDocs.filter(d => !d.authorId || !d.text);
  if (bad.length) {
    console.log('BAD UPDATE DOCS:', JSON.stringify(bad.slice(0, 3), null, 2));
    const bc = complaints.find(c => String(c._id) === bad[0].complaintId.toString());
    console.log('parent complaint:', bc ? JSON.stringify({ status: bc.status, resolution: bc.resolution, resType: bc.resolution && bc.resolution.constructor.name }) : 'not found');
  }
  await M.Update.insertMany(updateDocs);

  /* attachments -------------------------------------------------------------- */
  const pngTiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await M.Attachment.insertMany(complaints.slice(0, 6).map(c => ({
    complaintId: c._id, uploadedBy: c.citizenId, name: 'site-photo.png', mime: 'image/png', size: 95, dataB64: pngTiny, createdAt: c.createdAt
  })));

  /* assignments (history) ----------------------------------------------------- */
  const assignedDocs = [];
  for (const c of complaints.filter(c => c.assignedOfficerId)) {
    assignedDocs.push({ complaintId: c._id, officerId: c.assignedOfficerId, byAdminId: admin._id, note: 'Auto-dispatched by zone duty chart', assignedAt: new Date(c.createdAt.getTime() + 43200000) });
  }
  await M.Assignment.insertMany(assignedDocs);

  /* escalations --------------------------------------------------------------- */
  const escalated = complaints.filter(c => c.priority === 'Critical').slice(0, 3);
  await M.Escalation.insertMany(escalated.map(c => ({
    complaintId: c._id, raisedBy: admin._id, reason: 'SLA deadline close and media attention expected',
    oldPriority: 'High', newPriority: 'Critical', resolved: c.status === 'Closed', createdAt: new Date(c.createdAt.getTime() + 2 * 86400000)
  })));

  /* feedback ------------------------------------------------------------------ */
  const fbDocs = [];
  for (const c of complaints.filter(c => c.resolvedAt)) {
    fbDocs.push({ complaintId: c._id, userId: c.citizenId, rating: 1 + Math.floor(rand() * 5), comment: pick(['Quick fix, thanks.', 'Work done but dust still lying.', 'Satisfactory.', 'Very slow but resolved.', 'Excellent follow-up.']), createdAt: c.resolvedAt });
  }
  await M.Feedback.insertMany(fbDocs);

  /* notifications -------------------------------------------------------------- */
  await M.Notification.insertMany([
    ...citizens.slice(0, 3).map(u => ({ userId: u._id, title: 'Welcome to City Grievance Portal', body: 'File your first complaint in under a minute.', link: '/complaints/new' })),
    ...citizens.filter((_, i) => i % 2).map(u => ({ userId: u._id, title: 'Your ticket was resolved', body: 'Please rate the resolution.', read: rand() > 0.5 }))
  ]);

  /* faqs ------------------------------------------------------------------------ */
  await M.Faq.insertMany([
    { question: 'Who can file a complaint?', answer: 'Any resident of the city above 18 years after a one-time registration with a verified email address.', order: 1 },
    { question: 'How long will my complaint take?', answer: 'Each category has an SLA: Critical issues 2 days, High 7, Medium 15, Low 30. The due date is stamped on your ticket.', order: 2 },
    { question: 'Can I attach photos?', answer: 'Yes — one photo up to 512 KB per ticket. It dramatically speeds up field-level verification.', order: 3 },
    { question: 'How do I know my complaint status?', answer: 'Open Dashboard → the ticket card shows live status, or check notifications for updates.', order: 4 },
    { question: 'Will my identity be shown to officers?', answer: 'Your name is visible only to the concerned department’s officers and administrators.', order: 5 },
    { question: 'What if the complaint is wrongly rejected?', answer: 'Raise an escalation; an administrator re-evaluates and can re-prioritise the ticket.', order: 6 }
  ]);

  /* announcements ----------------------------------------------------------------- */
  await M.Announcement.insertMany([
    { title: 'Portal maintenance — Sunday 2 AM', body: 'The grievance portal will be briefly unavailable during the weekly backup window.', audience: 'all', postedBy: admin._id },
    { title: 'Monsoon desk activated', body: 'Drainage and waterlogging complaints now follow a 7-day SLA during the monsoon.', audience: 'citizen', postedBy: admin._id },
    { title: 'New officers onboarded', body: 'Ward duty rosters for colonies C3 and D4 have been updated.', audience: 'staff', postedBy: admin._id }
  ]);

  /* audit_logs --------------------------------------------------------------------- */
  await M.AuditLog.insertMany([
    { actorId: admin._id, actorName: 'Municipal Administrator', action: 'create', entity: 'Department', meta: { code: 'ROAD' }, createdAt: daysAgo(300) },
    { actorId: admin._id, actorName: 'Municipal Administrator', action: 'create', entity: 'Category', meta: { code: 'POTHOLE' }, createdAt: daysAgo(299) },
    { actorId: offRoadman._id, actorName: 'R. Sawant', action: 'login', entity: 'User', createdAt: daysAgo(2) },
    { actorId: citizens[0]._id, actorName: 'Ravi Patil', action: 'create', entity: 'Complaint', meta: { ticketNo: complaints[0].ticketNo }, createdAt: complaints[0].createdAt }
  ]);

  /* app_settings --------------------------------------------------------------------- */
  await M.Setting.insertMany([
    { key: 'orgName', value: 'Mumbai City Grievance Portal' },
    { key: 'portalOpen', value: true },
    { key: 'welcomeText', value: 'Report city issues — roads, water, waste, power — and track them till they are fixed.' }
  ]);

  /* counters ------------------------------------------------------------------------ */
  await M.Counter.create({ key: 'complaint', value: complaints.length });

  // rebuild every schema-declared index (text index, TTL, compounds) — dropDatabase wiped them
  await Promise.all(Object.values(mongoose.models).map(m => m.createIndexes()));
  console.log('· indexes rebuilt on all collections');

  await mongoose.disconnect();
  console.log('· seeded: %d complaints, %d citizens, %d officers, %d departments, %d categories, %d wards, SLA rules, and 20 collections total',
    complaints.length, citizens.length, officers.length, departments.length, categories.length, wards.length);
}

main().catch(e => { console.error(e); process.exit(1); });
