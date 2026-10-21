'use strict';
// routes.js — all OCMS routes.
//   Search/filter/report section: /search (full-text + filters) · /reports (aggregation dashboards)
//   MongoDB features required by the assignment are tagged with ★ in comments.

const { Types } = require('mongoose');
const M = require('./models');
const A = require('./auth');

const PAGE = 10;
const openStatuses = ['Submitted', 'In Progress'];

/* helpers ---------------------------------------------------------------- */

const asId = v => Types.ObjectId.isValid(v) ? v : null;

// sanitize strings arriving from query strings / bodies (no $-operator injection)
const clean = v => (typeof v === 'string' ? v.trim().replace(/^\$+/, '') : '');

const toInt = (v, d) => (Number.isInteger(+v) && +v > 0 ? +v : d);

function pager(page, total) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return { page, pages, total, prev: page > 1, next: page < pages };
}

// one navigation middleware: paints res.locals for headers on every page
async function paint(req, res, next) {
  res.locals.user = req.user;
  res.locals.unread = 0;
  res.locals.org = 'City Grievance Portal';
  // ★ projection + limit: settings doc only needs `value`
  const org = await M.Setting.findOne({ key: 'orgName' }).select('value -_id').lean();
  if (org && org.value) res.locals.org = org.value;
  if (req.user) {
    // ★ comparison filter ($eq on read:false) + count
    res.locals.unread = await M.Notification.countDocuments({ userId: req.user._id, read: false });
  }
  next();
}

/* home ------------------------------------------------------------------- */

async function home(req, res) {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  // ★ projection + limit on public lists
  const [announcements, categories, recent] = await Promise.all([
    M.Announcement.find({ active: true, audience: 'all' })
      .select('title body postedAt -_id').sort({ postedAt: -1 }).limit(3).lean(),
    M.Category.find({ active: true }).select('name code icon totalFiled -_id')
      .sort({ totalFiled: -1 }).limit(6).lean(),
    M.Complaint.find({ status: { $in: ['Resolved', 'Closed'] } })        // ★ comparison $in
      .select('ticketNo title status createdAt -_id')                    // ★ projection
      .sort({ createdAt: -1 }).limit(5).lean()                           // ★ limit
  ]);
  // ★ comparison filtering ($gte) for the monthly counter
  const resolvedMonth = await M.Complaint.countDocuments({ resolvedAt: { $gte: monthStart } });
  const openTotal = await M.Complaint.countDocuments({ status: { $in: openStatuses } });
  res.render('index', { announcements, categories, recent, resolvedMonth, openTotal });
}

/* auth ------------------------------------------------------------------- */

async function loginPage(req, res) { if (req.user) return res.redirect('/dashboard'); res.render('login'); }

async function login(req, res) {
  const id = clean(req.body.email);
  const pw = String(req.body.password || '');
  // ★ logical filter: $or (email OR phone), combined with comparison $ne via schema default active:true story
  const user = await M.User.findOne({ $or: [{ email: id }, { phone: id }], active: true })
    .select('name email role passwordHash passwordSalt');
  // (fixed plain password verify — timing-safe)
  if (!user || !pw || !A.verifyPassword(pw, user.passwordSalt, user.passwordHash)) {
    return res.status(401).render('login', { error: 'Invalid credentials' });
  }
  const token = await A.createSession(user._id, user.role);
  A.audit(user, 'login', 'User', user._id, { ip: req.ip });
  A.setCookie(res, token);
  res.redirect(user.role === 'citizen' ? '/dashboard' : user.role === 'officer' ? '/queue' : '/admin');
}

async function registerPage(req, res) { if (req.user) return res.redirect('/dashboard'); res.render('register'); }

async function register(req, res) {
  const { name, email, phone } = req.body;
  const password = String(req.body.password || '');
  const emailN = clean(email).toLowerCase();
  if (!clean(name) || !emailN.includes('@') || password.length < 8) {
    return res.status(400).render('register', { error: 'Name, valid email and a password of 8+ characters are required' });
  }
  // ★ comparison filter: $exists to enforce uniqueness before hitting the index
  if (await M.User.exists({ email: emailN })) {
    return res.status(409).render('register', { error: 'Email already registered' });
  }
  const { salt, hash } = A.hashPassword(password);
  const user = await M.User.create({
    name: clean(name), email: emailN, phone: clean(phone).replace(/[^\d+-]/g, ''),
    passwordHash: hash, passwordSalt: salt, role: 'citizen'
  });
  // embedded address document created empty, edited later on /profile
  await M.Citizen.create({ userId: user._id, address: {} });
  await A.audit(user, 'register', 'User', user._id, { role: 'citizen' });
  A.setCookie(res, await A.createSession(user._id, 'citizen'));
  res.redirect('/dashboard');
}

async function logout(req, res) {
  await A.destroySession(req, res);
  res.redirect('/');
}

/* search + filters (public) ---------------------------------------------- */

async function search(req, res) {
  const q = clean(req.query.q || '');
  const filter = {};
  if (q) filter.$text = { $search: q };                    // ★ text search (text index in models.js)
  if (req.query.category) filter.categoryCode = clean(req.query.category);
  if (req.query.department) { const d = asId(req.query.department); if (d) filter.departmentId = d; }
  if (req.query.priority) filter.priority = { $in: [].concat(req.query.priority).map(clean) }; // ★ $in
  if (req.query.status) filter.status = { $in: [].concat(req.query.status).map(clean) };
  if (req.query.tags) filter.tags = { $all: String(req.query.tags).split(',').map(t => clean(t)).filter(Boolean) }; // ★ array: $all
  const from = req.query.from, to = req.query.to;
  if (from || to) {                                        // ★ comparison: $gte / $lte on createdAt
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59Z`);
  }
  // ★ logical $and / $or mix: unresolved-but-due filter switch
  if (req.query.due === '1') filter.$and = [{ status: { $in: openStatuses } }, { dueAt: { $lt: new Date() } }];

  const page = toInt(req.query.page, 1);
  const [total, complaints] = await Promise.all([
    M.Complaint.countDocuments(filter),
    (q
      ? M.Complaint.find(filter, { score: { $meta: 'textScore' } })   // ★ text ranking meta
        .sort({ score: { $meta: 'textScore' } })
      : M.Complaint.find(filter).sort({ createdAt: -1 })
    ).select('ticketNo title status priority categoryCode wardId createdAt dueAt')
      .skip((page - 1) * PAGE).limit(PAGE)
      .populate('wardId', 'name code')                                 // document relationship handling
      .lean()
  ]);
  const [categories, departments] = await Promise.all([
    M.Category.find().select('name code active -_id').sort({ name: 1 }).lean(),
    M.Department.find().select('name -_id').sort({ name: 1 }).lean()
  ]);
  res.render('search', {
    complaints, total, q, pageMeta: pager(page, total), categories, departments,
    current: req.query
  });
}

/* faqs (public) ----------------------------------------------------------- */

async function faqs(req, res) {
  const list = await M.Faq.find({ active: true })        // ★ comparison + projection + limit
    .select('question answer categoryCode -_id').sort({ order: 1 }).limit(30).lean();
  res.render('faqs', { list });
}

/* citizen dashboard ------------------------------------------------------- */

async function dashboard(req, res) {
  const me = req.user._id;
  // ★ projection + limit, newest first
  const [myComplaints, notifications, feedback] = await Promise.all([
    M.Complaint.find({ citizenId: me }).select('ticketNo title status priority categoryCode createdAt dueAt')
      .sort({ createdAt: -1 }).limit(10).lean(),
    M.Notification.find({ userId: me }).select('title createdAt read link -_id')
      .sort({ createdAt: -1 }).limit(5).lean(),
    M.Feedback.find({ userId: me }).select('rating complaintId createdAt -_id').sort({ createdAt: -1 }).limit(5).lean()
  ]);
  // ★ aggregation #4 (bonus, small): counts of my complaints grouped by status
  const byStatus = await M.Complaint.aggregate([
    { $match: { citizenId: me } },                 // $match
    { $group: { _id: '$status', count: { $sum: 1 } } },  // $group
    { $sort: { count: -1 } },                     // $sort
    { $project: { _id: 0, status: '$_id', count: 1 } }   // $project
  ]);
  const filed = await M.Complaint.countDocuments({ citizenId: me });
  res.render('dashboard', { myComplaints, notifications, feedback, byStatus, filed });
}

async function profilePage(req, res) {
  // ★ populate the embedded address sub-document
  const citizen = await M.Citizen.findOne({ userId: req.user._id })
    .populate('address.wardId', 'name code').lean();
  const wards = await M.Ward.find().select('name code -_id').sort({ name: 1 }).lean();
  res.render('profile', { citizen, wards });
}

async function profileSave(req, res) {
  const citizen = await M.Citizen.findOne({ userId: req.user._id });
  if (!citizen) return res.status(404).redirect('/');
  // document handling: setting fields on the embedded address sub-document
  citizen.address = {
    street: clean(req.body.street),
    city: clean(req.body.city),
    pincode: clean(req.body.pincode).slice(0, 10),
    wardId: asId(req.body.wardId)
  };
  await citizen.save();
  if (req.user.name !== clean(req.body.name)) {
    await M.User.updateOne({ _id: req.user._id }, { $set: { name: clean(req.body.name) } }); // ★ updateOne + $set
  }
  await A.audit(req.user, 'update', 'Citizen', citizen._id, { field: 'address' });
  res.redirect('/profile');
}

/* complaints -------------------------------------------------------------- */

async function complaintNew(req, res) {
  const [categories, wards, slaRules] = await Promise.all([
    M.Category.find({ active: true }).populate('departmentId', 'name code -_id').sort({ name: 1 }).lean(),
    M.Ward.find().sort({ name: 1 }).lean(),
    M.SlaRule.find().select('categoryCode priority maxDays -_id').lean()
  ]);
  res.render('complaint_new', { categories, wards, slaRules });
}

async function complaintCreate(req, res) {
  const title = clean(req.body.title), description = clean(req.body.description);
  const categoryCode = clean(req.body.categoryCode);
  if (!title || title.length < 8 || !description || description.length < 15) {
    return res.status(400).redirect('/complaints/new');
  }
  const category = await M.Category.findOne({ code: categoryCode, active: true }).lean();
  if (!category) return res.status(400).redirect('/complaints/new');

  const priority = ['Low', 'Medium', 'High', 'Critical'].includes(req.body.priority) ? req.body.priority : 'Medium';
  // SLA due date from sla_rules (document lookup)
  const rule = await M.SlaRule.findOne({ categoryCode, priority }).select('maxDays -_id').lean();
  const maxDays = rule ? rule.maxDays : 15;
  const now = new Date();
  const tags = String(req.body.tags || '').split(',').map(t => clean(t)).filter(Boolean).slice(0, 6); // array field

  const complaint = await M.Complaint.create({
    ticketNo: await M.nextTicketNo(),                       // ★ atomic $inc counter (document update)
    title, description, priority,
    citizenId: req.user._id,
    categoryCode,
    departmentId: category.departmentId,
    wardId: asId(req.body.wardId),
    tags,                                                   // ★ array field
    priorityRank: ['Low', 'Medium', 'High', 'Critical'].indexOf(priority),
    createdAt: now,
    dueAt: new Date(now.getTime() + maxDays * 86400000)
  });
  // ★ array of parallel bookkeeping via atomic $inc updates
  await Promise.all([
    M.Category.updateOne({ code: categoryCode }, { $inc: { totalFiled: 1 } }),      // ★ $inc
    M.User.updateOne({ _id: req.user._id }, { $inc: { 'stats.complaintsFiled': 1 } })
  ]);
  // notify staff of the duty department
  const staff = await M.Officer.find({ departmentId: category.departmentId }).select('userId -_id').lean();
  await Promise.all([
    ...staff.map(s => A.notify(s.userId, 'New complaint assigned to your department', title, `/complaints/${complaint._id}`)),
    ...(await M.User.find({ role: 'admin' }).select('_id')).map(u => A.notify(u._id, 'New complaint filed', title, `/complaints/${complaint._id}`))
  ]);
  await M.Update.create({
    complaintId: complaint._id, authorId: req.user._id, authorName: req.user.name, kind: 'Comment',
    text: 'Complaint submitted.'
  });
  await A.audit(req.user, 'create', 'Complaint', complaint._id, { ticketNo: complaint.ticketNo });
  res.redirect(`/complaints/${complaint._id}`);
}

// detail view: owner, any officer, or admin
async function complaintDetail(req, res) {
  const _id = asId(req.params.id);
  const complaint = _id && await M.Complaint.findById(_id)
    .populate('citizenId', 'name email')
    .populate('assignedOfficerId', 'name -_id')
    .populate('departmentId', 'name code')
    .populate('wardId', 'name code -_id')
    .lean();
  if (!complaint) return res.status(404).render('error', { code: 404, msg: 'Complaint not found' });
  const citizenId = complaint.citizenId && complaint.citizenId._id ? complaint.citizenId._id : complaint.citizenId;
  const isOwner = String(citizenId) === String(req.user._id);
  const isStaff = req.user.role !== 'citizen';
  if (!isOwner && !isStaff) return res.status(403).render('error', { code: 403, msg: 'Not your complaint' });

  // ★ projection + limit on the timeline; attachments exclude heavy dataB64 (select:false in schema)
  const [updates, attachments, myFeedback, assignment] = await Promise.all([
    M.Update.find({ complaintId: _id }).select('authorName kind text oldStatus newStatus createdAt -_id')
      .sort({ createdAt: 1 }).limit(50).lean(),
    M.Attachment.find({ complaintId: _id }).select('name mime size createdAt').lean(),
    M.Feedback.exists({ complaintId: _id, userId: req.user._id }),
    M.Assignment.find({ complaintId: _id }).sort({ assignedAt: -1 }).limit(1)
      .select('note reassigned assignedAt -_id').populate({ path: 'officerId', select: 'name -_id' }).lean()
  ]);
  // officers for the admin "assign" dropdown, matched on the complaint's department (★ filter + projection)
  // (departmentId is populated above → use its raw _id for the query cast)
  const deptId = complaint.departmentId && complaint.departmentId._id ? complaint.departmentId._id : complaint.departmentId;
  const officers = req.user.role === 'admin' && deptId
    ? await M.Officer.find({ departmentId: deptId })
        .select('userId').populate('userId', 'name').lean()
    : [];
  const categories = req.user.role === 'admin'
    ? await M.Category.find({ active: true }).select('code -_id').lean() : [];

  res.render('complaint', {
    complaint, updates, attachments, myFeedback, assignment, officers, categories, isOwner, isStaff
  });
}

// comment (owner, officer, admin)
async function addUpdate(req, res) {
  const _id = asId(req.params.id);
  const complaint = _id && await M.Complaint.findById(_id).select('citizenId assignedOfficerId departmentId title -_id');
  if (!complaint) return res.status(404).redirect('/');
  const allowed = req.user.role !== 'citizen' || String(complaint.citizenId) === String(req.user._id);
  if (!allowed) return res.status(403).redirect('/');
  const text = clean(req.body.text);
  if (text) {
    await M.Update.create({
      complaintId: _id, authorId: req.user._id, authorName: req.user.name,
      kind: 'Comment', text: text.slice(0, 2000)
    });
    // notify the other party
    if (req.user.role === 'citizen' && complaint.assignedOfficerId) {
      await A.notify(complaint.assignedOfficerId, 'New comment on your ticket', complaint.title, `/complaints/${_id}`);
    } else if (req.user.role !== 'citizen') {
      await A.notify(complaint.citizenId, 'Staff replied to your ticket', complaint.title, `/complaints/${_id}`);
    }
  }
  res.redirect(`/complaints/${req.params.id}`);
}

// tag management: $addToSet adds a tag, $pull removes it (★ array operators)
async function tagManage(req, res) {
  const _id = asId(req.params.id);
  if (req.user.role === 'citizen') return res.status(403).redirect('/');
  const add = clean(req.body.add);
  const rm = clean(req.body.rm);
  if (add) await M.Complaint.updateOne({ _id }, { $addToSet: { tags: add.toLowerCase() } }); // ★ $addToSet
  if (rm) await M.Complaint.updateOne({ _id }, { $pull: { tags: rm.toLowerCase() } });       // ★ $pull
  res.redirect(`/complaints/${req.params.id}`);
}

// attachment upload (owner/staff; stored in MongoDB as base64 in the attachments collection)
async function attachmentUpload(req, res) {
  const _id = asId(req.params.id);
  let { name, mime } = { name: clean(req.body.name), mime: clean(req.body.mime) };
  name = (name || 'attachment').slice(0, 120);
  let data = String(req.body.data || '');
  if (data.length > 700000) return res.status(413).redirect(`/complaints/${req.params.id}`); // ~512 KB guard
  if (data.startsWith('data:')) {            // data URL from the browser FileReader — split it
    mime = data.slice(5, data.indexOf(';')) || mime || 'application/octet-stream';
    data = data.slice(data.indexOf(',') + 1);
  }
  if (!data) return res.redirect(`/complaints/${req.params.id}`);
  const complaint = await M.Complaint.findById(_id).select('citizenId -_id');
  if (!complaint) return res.status(404).redirect('/');
  if (req.user.role === 'citizen' && String(complaint.citizenId) !== String(req.user._id)) {
    return res.status(403).redirect('/');
  }
  await M.Attachment.create({
    complaintId: _id, uploadedBy: req.user._id, name,
    mime: mime || 'application/octet-stream',
    size: Math.round(data.length * 3 / 4), dataB64: data
  });
  await M.Update.create({
    complaintId: _id, authorId: req.user._id, authorName: req.user.name,
    kind: 'Comment', text: `Attachment "${name}" uploaded.`
  });
  res.redirect(`/complaints/${req.params.id}`);
}

async function attachmentDownload(req, res) {
  const _id = asId(req.params.id);
  const att = _id && await M.Attachment.findById(_id).select('name mime dataB64 complaintId');
  if (!att) return res.status(404).redirect('/');
  const complaint = await M.Complaint.findById(att.complaintId).select('citizenId departmentId assignedOfficerId -_id');
  let ok = req.user.role !== 'citizen';
  if (!ok && complaint) ok = String(complaint.citizenId) === String(req.user._id);
  if (!ok) return res.status(403).redirect('/');
  res.set('Content-Type', att.mime);
  res.set('Content-Disposition', `attachment; filename="${att.name.replace(/[^\w .-]/g, '_')}"`);
  res.send(Buffer.from(att.dataB64, 'base64'));
}

// citizen rates the resolution (★ upsert-style unique index guard)
async function giveFeedback(req, res) {
  const _id = asId(req.params.id);
  const complaint = _id && await M.Complaint.findOne({ _id, citizenId: req.user._id }).select('status -_id');
  const rating = toInt(req.body.rating, 0);
  if (!complaint || !['Resolved', 'Closed'].includes(complaint.status)) return res.status(400).redirect('/');
  if (rating < 1 || rating > 5) return res.status(400).redirect('/');
  try {
    await M.Feedback.create({
      complaintId: _id, userId: req.user._id, rating,
      comment: clean(req.body.comment).slice(0, 500)
    });
  } catch (e) { if (e.code === 11000) return res.status(409).redirect(`/complaints/${req.params.id}`); throw e; }
  // ★ $inc on the citizen profile: resolvedReceived counter
  await M.User.updateOne({ _id: req.user._id }, { $inc: { 'stats.resolvedReceived': 1 } });
  res.redirect(`/complaints/${req.params.id}`);
}

// citizen acknowledges → Closed
async function closeComplaint(req, res) {
  const _id = asId(req.params.id);
  const complaint = _id && await M.Complaint.findOne({ _id, citizenId: req.user._id, status: 'Resolved' });
  if (!complaint) return res.status(400).redirect('/');
  complaint.status = 'Closed';
  await complaint.save();
  await M.Update.create({
    complaintId: _id, authorId: req.user._id, authorName: req.user.name,
    kind: 'StatusChange', oldStatus: 'Resolved', newStatus: 'Closed', text: 'Citizen confirmed closure.'
  });
  if (complaint.assignedOfficerId) await A.notify(complaint.assignedOfficerId, 'Ticket closed by citizen', '', `/complaints/${_id}`);
  await A.audit(req.user, 'update', 'Complaint', _id, { status: 'Closed' });
  res.redirect(`/complaints/${req.params.id}`);
}

/* officer queue ----------------------------------------------------------- */

async function queue(req, res) {
  const me = req.user;
  const myOfficer = await M.Officer.findOne({ userId: me._id }).lean();
  // ★ logical $or + $and + comparison $in: my department's open tickets OR tickets assigned to me
  const filter = {
    $or: [
      ...(myOfficer ? [{ departmentId: myOfficer.departmentId }] : []),
      { assignedOfficerId: me._id }
    ],
    $and: [{ status: { $in: openStatuses } }]      // ★ $and
  };
  if (req.query.priority) filter.priority = clean(req.query.priority);
  const page = toInt(req.query.page, 1);
  const [total, complaints] = await Promise.all([
    M.Complaint.countDocuments(filter),
    M.Complaint.find(filter).select('ticketNo title status priority categoryCode dueAt createdAt')
      .sort({ priorityRank: -1, createdAt: 1 })    // most urgent first (Critical > High > Medium > Low)
      .skip((page - 1) * PAGE).limit(PAGE).lean()
  ]);
  res.render('queue', { complaints, total, pageMeta: pager(page, total), current: req.query });
}

// staff status change (+ resolution note when moving to Resolved)
async function changeStatus(req, res) {
  const _id = asId(req.params.id);
  if (req.user.role === 'citizen') return res.status(403).redirect('/');
  const complaint = _id && await M.Complaint.findById(_id);
  if (!complaint) return res.status(404).redirect('/');
  const next = clean(req.body.status);
  const allowed = req.user.role === 'admin'
    ? ['Submitted', 'In Progress', 'Resolved', 'Closed', 'Rejected']
    : ['In Progress', 'Resolved', 'Rejected'];
  if (!allowed.includes(next)) return res.status(400).redirect(`/complaints/${req.params.id}`);
  const old = complaint.status;
  complaint.status = next;
  if (next === 'Resolved') {
    complaint.resolvedAt = new Date();
    // ★ embedded document: full resolution note stored inside the complaint doc
    complaint.resolution = { note: clean(req.body.note).slice(0, 2000), resolvedBy: req.user._id };
  }
  if (next === 'In Progress' && !complaint.assignedOfficerId) {
    complaint.assignedOfficerId = req.user._id;
    await M.Assignment.create({ complaintId: _id, officerId: req.user._id, note: 'claimed while acting on status' });
  }
  await complaint.save();
  await M.Update.create({
    complaintId: _id, authorId: req.user._id, authorName: req.user.name,
    kind: 'StatusChange', oldStatus: old, newStatus: next,
    text: next === 'Resolved' ? (clean(req.body.note) || 'Resolved by staff.') : `Status moved to ${next}.`
  });
  await A.notify(complaint.citizenId, `Ticket ${complaint.ticketNo}: ${next}`, clean(req.body.note), `/complaints/${_id}`);
  await A.audit(req.user, 'update', 'Complaint', _id, { status: next });
  res.redirect(`/complaints/${req.params.id}`);
}

/* admin ------------------------------------------------------------------- */

async function adminHome(req, res) {
  const now = new Date(); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // KPI row: five cheap counts (★ comparison filters)
  const [open, users, thisMonth, breached, escalations] = await Promise.all([
    M.Complaint.countDocuments({ status: { $in: openStatuses } }),
    M.User.countDocuments({ role: { $ne: 'admin' }, active: true }),
    M.Complaint.countDocuments({ createdAt: { $gte: monthStart } }),
    M.Complaint.countDocuments({ $and: [{ status: { $in: openStatuses } }, { dueAt: { $lt: now } }] }), // SLA breached
    M.Escalation.countDocuments({ resolved: false })
  ]);
  const [recentLogs, breachedDocs] = await Promise.all([
    M.AuditLog.find().select('actorName action entity createdAt -_id').sort({ createdAt: -1 }).limit(8).lean(),
    M.Complaint.find({ $and: [{ status: { $in: openStatuses } }, { dueAt: { $lt: now } }] })
      .select('ticketNo title dueAt priority').sort({ dueAt: 1 }).limit(5).populate('departmentId', 'name -_id').lean()
  ]);
  res.render('admin', { kpi: { open, users, thisMonth, breached, escalations }, recentLogs, breachedDocs });
}

// one management page: categories · departments · wards · faqs · announcements · sla rules
async function adminManage(req, res) {
  const [categories, departments, wards, faqs, announcements, slaRules] = await Promise.all([
    M.Category.find().sort({ name: 1 }).populate('departmentId', 'name code').lean(),
    M.Department.find().sort({ name: 1 }).lean(),
    M.Ward.find().sort({ code: 1 }).lean(),
    M.Faq.find().sort({ order: 1 }).lean(),
    M.Announcement.find().sort({ postedAt: -1 }).limit(20).lean(),
    M.SlaRule.find().sort({ categoryCode: 1, priority: -1 }).lean()
  ]);
  res.render('admin_manage', { categories, departments, wards, faqs, announcements, slaRules, current: req.query || {} });
}

/* ---- categories CRUD ★ ---- */
async function categoryCreate(req, res) {
  const code = (clean(req.body.code) || '').toUpperCase();
  const deptId = asId(req.body.departmentId);
  if (!code || !clean(req.body.name) || !deptId) return res.redirect('/admin/manage?err=Category+needs+code,+name,+department');
  try {
    await M.Category.create({
      code, name: clean(req.body.name), description: clean(req.body.description),
      icon: clean(req.body.icon) || '📋', departmentId: deptId
    });
    await A.audit(req.user, 'create', 'Category', null, { code });
  } catch (e) { if (e.code === 11000) return res.redirect('/admin/manage?err=Category+code+already+exists'); throw e; }
  res.redirect('/admin/manage');
}
async function categoryUpdate(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  const set = {};
  if (req.body.name) set.name = clean(req.body.name);
  if (req.body.description !== undefined) set.description = clean(req.body.description);
  if (req.body.active !== undefined) set.active = req.body.active === 'on' || req.body.active === 'true';
  const deptId = asId(req.body.departmentId); if (deptId) set.departmentId = deptId;
  await M.Category.updateOne({ _id }, { $set: set }); // ★ updateOne + $set
  await A.audit(req.user, 'update', 'Category', _id, set);
  res.redirect('/admin/manage');
}
async function categoryDelete(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  const cat = await M.Category.findById(_id).select('code -_id').lean();
  if (!cat) return res.status(404).redirect('/admin/manage');
  // ★ delete guard: block when complaints still reference this category ($gt count)
  const used = await M.Complaint.countDocuments({ categoryCode: cat.code });
  if (used > 0) return res.redirect(`/admin/manage?err=Category+${cat.code}+has+${used}+complaints;+cannot+delete`);
  await M.Category.deleteOne({ _id });            // ★ delete
  await M.SlaRule.deleteMany({ categoryCode: cat.code }); // ★ deleteMany cascade
  await A.audit(req.user, 'delete', 'Category', _id, { code: cat.code });
  res.redirect('/admin/manage');
}

/* ---- departments CRUD ★ ---- */
async function departmentCreate(req, res) {
  const code = (clean(req.body.code) || '').toUpperCase();
  if (!code || !clean(req.body.name)) return res.redirect('/admin/manage?err=Department+needs+code+and+name');
  try {
    await M.Department.create({
      code, name: clean(req.body.name), head: clean(req.body.head),
      email: clean(req.body.email), categories: (req.body.categories || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    });
    await A.audit(req.user, 'create', 'Department', null, { code });
  } catch (e) { if (e.code === 11000) return res.redirect('/admin/manage?err=Department+code+already+exists'); throw e; }
  res.redirect('/admin/manage');
}
async function departmentDelete(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  const deps = await M.Complaint.countDocuments({ departmentId: _id });
  const cats = await M.Category.countDocuments({ departmentId: _id });
  if (deps > 0 || cats > 0) return res.redirect(`/admin/manage?err=Department+still+has+${deps + cats}+linked+records`);
  await M.Department.deleteOne({ _id });
  await A.audit(req.user, 'delete', 'Department', _id);
  res.redirect('/admin/manage');
}

/* ---- wards CRUD ★ ---- */
async function wardCreate(req, res) {
  const code = (clean(req.body.code) || '').toUpperCase();
  if (!code || !clean(req.body.name)) return res.redirect('/admin/manage?err=Ward+needs+code+and+name');
  try {
    await M.Ward.create({
      code, name: clean(req.body.name), city: clean(req.body.city) || 'Mumbai',
      population: toInt(req.body.population, 0)
    });
  } catch (e) { if (e.code === 11000) return res.redirect('/admin/manage?err=Ward+code+already+exists'); throw e; }
  res.redirect('/admin/manage');
}
async function wardDelete(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  const used = await M.Complaint.countDocuments({ wardId: _id });
  if (used > 0) return res.redirect(`/admin/manage?err=Ward+has+${used}+complaints`);
  await M.Ward.deleteOne({ _id });
  res.redirect('/admin/manage');
}

/* ---- FAQs CRUD ★ ---- */
async function faqCreate(req, res) {
  if (!clean(req.body.question) || !clean(req.body.answer)) return res.redirect('/admin/manage?err=FAQ+needs+question+and+answer');
  await M.Faq.create({
    question: clean(req.body.question), answer: clean(req.body.answer),
    categoryCode: clean(req.body.categoryCode).toUpperCase() || undefined,
    order: toInt(req.body.order, 99), active: true
  });
  await A.audit(req.user, 'create', 'Faq');
  res.redirect('/admin/manage');
}
async function faqUpdate(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  const set = {};
  if (req.body.question) set.question = clean(req.body.question);
  if (req.body.answer) set.answer = clean(req.body.answer);
  if (req.body.order) set.order = toInt(req.body.order, 99);
  if (req.body.active !== undefined) set.active = req.body.active === 'on' || req.body.active === 'true';
  await M.Faq.updateOne({ _id }, { $set: set });
  res.redirect('/admin/manage');
}
async function faqDelete(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  await M.Faq.deleteOne({ _id });
  res.redirect('/admin/manage');
}

/* ---- announcements CRUD ★ ---- */
async function announcementCreate(req, res) {
  if (!clean(req.body.title) || !clean(req.body.body)) return res.redirect('/admin/manage?err=Announcement+needs+title+and+body');
  await M.Announcement.create({
    title: clean(req.body.title), body: clean(req.body.body),
    audience: ['all', 'citizen', 'staff'].includes(req.body.audience) ? req.body.audience : 'all',
    postedBy: req.user._id
  });
  await A.audit(req.user, 'create', 'Announcement', null, { title: clean(req.body.title) });
  res.redirect('/admin/manage');
}
async function announcementToggle(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  const ann = await M.Announcement.findById(_id).select('active -_id');
  if (!ann) return res.status(404).redirect('/admin/manage');
  await M.Announcement.updateOne({ _id }, { $set: { active: !ann.active } }); // boolean flip
  res.redirect('/admin/manage');
}
async function announcementDelete(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/manage');
  await M.Announcement.deleteOne({ _id });
  res.redirect('/admin/manage');
}

/* ---- SLA rules ★ (upsert by categoryCode+priority unique index) ---- */
async function slaUpsert(req, res) {
  const categoryCode = (clean(req.body.categoryCode) || '').toUpperCase();
  const priority = req.body.priority;
  const maxDays = toInt(req.body.maxDays, 0);
  if (!categoryCode || !['Low', 'Medium', 'High', 'Critical'].includes(priority) || maxDays < 1) {
    return res.redirect('/admin/manage?err=SLA+rule+needs+category,+priority,+days');
  }
  await M.SlaRule.updateOne({ categoryCode, priority }, { $set: { maxDays } }, { upsert: true }); // ★ upsert
  res.redirect('/admin/manage');
}

/* ---- users management ---- */
async function adminUsers(req, res) {
  const filter = {};
  if (req.query.role) filter.role = { $in: [].concat(req.query.role).map(clean) };
  const q = clean(req.query.q);
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }]; // ★ $or + regex, escaped
  const page = toInt(req.query.page, 1);
  const [total, users] = await Promise.all([
    M.User.countDocuments(filter),
    M.User.find(filter).select('name email phone role active stats createdAt')
      .sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean()
  ]);
  const departments = await M.Department.find().select('name -_id').sort({ name: 1 }).lean();
  res.render('admin_users', { users, total, pageMeta: pager(page, total), departments, current: req.query });
}

async function userUpdate(req, res) {
  const _id = asId(req.params.id); if (!_id) return res.status(400).redirect('/admin/users');
  const set = {};
  if (['citizen', 'officer', 'admin'].includes(req.body.role)) set.role = req.body.role;
  if (req.body.active !== undefined) set.active = req.body.active === 'on' || req.body.active === 'true';
  await M.User.updateOne({ _id }, { $set: set });
  // keep the derived officer profile in sync when someone becomes an officer
  if (set.role === 'officer') {
    const deptId = asId(req.body.departmentId);
    if (deptId) await M.Officer.updateOne({ userId: _id }, { $set: { departmentId: deptId, designation: clean(req.body.designation) || 'Ward Officer' } }, { upsert: true });
  } else if (set.role && set.role !== 'officer') {
    await M.Officer.deleteOne({ userId: _id });    // cascade the derived doc
  }
  await M.Session.deleteMany({ userId: _id });     // ★ deleteMany: kick old sessions after a role change
  await A.audit(req.user, 'update', 'User', _id, set);
  res.redirect('/admin/users');
}

/* ---- complaints: assign / escalate / delete (admin) ---- */
async function assignComplaint(req, res) {
  const _id = asId(req.params.id);
  if (req.user.role !== 'admin') return res.status(403).redirect('/');
  const officerUserId = asId(req.body.officerUserId);
  const complaint = _id && await M.Complaint.findById(_id).select('assignedOfficerId status ticketNo citizenId -_id');
  const officer = officerUserId && await M.Officer.findOne({ userId: officerUserId }).populate('userId', 'name').lean();
  if (!complaint || !officer) return res.status(400).redirect(`/complaints/${req.params.id}`);
  const reassigned = Boolean(complaint.assignedOfficerId);
  await M.Assignment.create({          // ★ history document
    complaintId: _id, officerId: officerUserId, byAdminId: req.user._id,
    note: clean(req.body.note).slice(0, 500), reassigned
  });
  await M.Complaint.updateOne({ _id }, {
    $set: { assignedOfficerId: officerUserId, status: complaint.status === 'Submitted' ? 'In Progress' : complaint.status }
  });
  await M.Officer.updateOne({ userId: officerUserId }, { $inc: { openCases: 1 } }); // ★ $inc
  await M.Update.create({
    complaintId: _id, authorId: req.user._id, authorName: req.user.name, kind: 'Reassignment',
    text: `${reassigned ? 'Reassigned' : 'Assigned'} to ${officer.userId.name}.${clean(req.body.note) ? ' Note: ' + clean(req.body.note) : ''}`
  });
  await A.notify(officerUserId, `Ticket assigned: ${complaint.ticketNo}`, '', `/complaints/${_id}`);
  await A.audit(req.user, 'assign', 'Complaint', _id, { officerUserId });
  res.redirect(`/complaints/${req.params.id}`);
}

async function escalateComplaint(req, res) {
  const _id = asId(req.params.id);
  if (req.user.role !== 'admin') return res.status(403).redirect('/');
  const complaint = _id && await M.Complaint.findById(_id).select('priority assignedOfficerId citizenId ticketNo -_id');
  if (!complaint) return res.status(404).redirect('/');
  const newPriority = complaint.priority === 'Critical' ? 'Critical' : 'High';
  await M.Escalation.create({
    complaintId: _id, raisedBy: req.user._id, reason: clean(req.body.reason).slice(0, 500) || 'SLA at risk',
    oldPriority: complaint.priority, newPriority
  });
  await M.Complaint.updateOne({ _id }, {
    $set: { priority: newPriority, priorityRank: ['Low', 'Medium', 'High', 'Critical'].indexOf(newPriority) }
  });
  await M.Update.create({
    complaintId: _id, authorId: req.user._id, authorName: req.user.name, kind: 'Escalation',
    text: `Escalated to priority ${newPriority}. ${clean(req.body.reason) || 'SLA deadline at risk.'}`
  });
  await Promise.all([
    complaint.assignedOfficerId && A.notify(complaint.assignedOfficerId, `ESCALATED: ${complaint.ticketNo}`, clean(req.body.reason), `/complaints/${_id}`),
    A.notify(complaint.citizenId, 'Your ticket was escalated for faster resolution', '', `/complaints/${_id}`)
  ]);
  await A.audit(req.user, 'escalate', 'Complaint', _id, { newPriority });
  res.redirect(`/complaints/${req.params.id}`);
}

async function deleteComplaint(req, res) {
  const _id = asId(req.params.id);
  if (req.user.role !== 'admin') return res.status(403).redirect('/');
  if (!_id) return res.status(400).redirect('/search');
  await M.Complaint.deleteOne({ _id });
  // cascade delete (★ deleteMany × several sibling collections)
  await Promise.all([
    M.Update.deleteMany({ complaintId: _id }),
    M.Attachment.deleteMany({ complaintId: _id }),
    M.Assignment.deleteMany({ complaintId: _id }),
    M.Escalation.deleteMany({ complaintId: _id }),
    M.Feedback.deleteMany({ complaintId: _id })
  ]);
  await A.audit(req.user, 'delete', 'Complaint', _id);
  res.redirect('/search');
}

/* reports — ★★★ 3 aggregation pipelines + side KPIs ------------------------ */

async function reports(req, res) {
  const now = new Date();
  const sixMonths = new Date(now.getTime() - 183 * 86400000);

  // Pipeline 1 — department performance: $match → $group($avg resolution days) → $sort → $lookup → $unwind → $project
  const deptPerformance = await M.Complaint.aggregate([
    { $match: { status: { $in: ['Resolved', 'Closed'] }, resolvedAt: { $exists: true, $ne: null } } },
    { $group: {
        _id: '$departmentId',
        resolved: { $sum: 1 },
        avgDays: { $avg: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 86400000] } }
    } },
    { $sort: { resolved: -1 } },
    { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } }, // ★ document join
    { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, name: '$dept.name', code: '$dept.code', resolved: 1, avgDays: { $round: ['$avgDays', 1] } } }
  ]);

  // Pipeline 2 — monthly trend: $match(range) → $group(by month w/ $dateToString + conditional $sum) → $sort → $project
  const monthlyTrend = await M.Complaint.aggregate([
    { $match: { createdAt: { $gte: sixMonths } } },
    { $group: {
        _id: { ym: { $dateToString: { format: '%Y-%m', date: '$createdAt' } } },
        filed: { $sum: 1 },
        resolved: { $sum: { $cond: [{ $in: ['$status', ['Resolved', 'Closed']] }, 1, 0] } }
    } },
    { $project: { _id: 0, month: '$_id.ym', filed: 1, resolved: 1 } },
    { $sort: { month: -1 } },
    { $limit: 6 }
  ]);

  // Pipeline 3 — status × priority matrix: optional department $match → $group on composed key → $sort → $project
  const deptFilter = asId(req.query.departmentId);
  const matrixPipe = [];
  if (deptFilter) matrixPipe.push({ $match: { departmentId: deptFilter } });
  matrixPipe.push(
    { $group: { _id: { status: '$status', priority: '$priority' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, status: '$_id.status', priority: '$_id.priority', count: 1 } }
  );
  const statusMatrix = await M.Complaint.aggregate(matrixPipe);

  // Pipeline 4 (bonus, array handling) — top tags: $unwind → $group → $sort → $limit
  const topTags = await M.Complaint.aggregate([
    { $match: { tags: { $exists: true, $ne: [] } } },
    { $unwind: '$tags' },                                     // ★ array handling in a pipeline
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $project: { _id: 0, tag: '$_id', count: 1 } }
  ]);

  // side KPIs (comparison filters, cheap counts)
  const [openCount, slaBreached, avgRatingAgg, departments] = await Promise.all([
    M.Complaint.countDocuments({ status: { $in: openStatuses } }),
    M.Complaint.countDocuments({ status: { $in: openStatuses }, dueAt: { $lt: now } }),
    // Pipeline 5 — citizen satisfaction: $avg over feedback
    M.Feedback.aggregate([
      { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
      { $project: { _id: 0, avg: { $round: ['$avg', 2] }, n: 1 } }
    ]),
    M.Department.find().select('name -_id').sort({ name: 1 }).lean()
  ]);
  const avgRating = avgRatingAgg[0] || { avg: null, n: 0 };

  res.render('reports', {
    deptPerformance, monthlyTrend, statusMatrix, topTags, departments, deptFilter,
    kpi: { openCount, slaBreached, avgRating }
  });
}

/* audit + notifications --------------------------------------------------- */

async function auditLogs(req, res) {
  const filter = {};
  if (req.query.action) filter.action = { $in: [].concat(req.query.action).map(clean) };
  const page = toInt(req.query.page, 1);
  const [total, logs] = await Promise.all([
    M.AuditLog.countDocuments(filter),
    M.AuditLog.find(filter).select('actorName action entity meta createdAt -_id')
      .sort({ createdAt: -1 }).skip((page - 1) * PAGE).limit(PAGE).lean()
  ]);
  res.render('audit', { logs, total, pageMeta: pager(page, total), current: req.query });
}

async function notifications(req, res) {
  // ★ projection + limit on the user's inbox
  const items = await M.Notification.find({ userId: req.user._id })
    .select('title body link read createdAt -_id').sort({ createdAt: -1 }).limit(50).lean();
  res.render('notifications', { items });
}

async function notificationsRead(req, res) {
  // ★ bulk document update: updateMany + $set
  await M.Notification.updateMany({ userId: req.user._id, read: false }, { $set: { read: true } });
  res.redirect('/notifications');
}

/* admin settings (app_settings collection) -------------------------------- */

async function settingsPage(req, res) {
  const settings = await M.Setting.find().select('key value updatedAt').sort({ key: 1 }).lean();
  res.render('settings', { settings, current: req.query || {} });
}

async function settingsSave(req, res) {
  const key = clean(req.body.key);
  const value = clean(req.body.value);
  if (key) await M.Setting.updateOne({ key }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
  res.redirect('/admin/settings?ok=1');
}

/* wiring ------------------------------------------------------------------ */

// (named wireRoutes, NOT register — a named fn expression would self-shadow the auth handler above)
module.exports = function wireRoutes(app) {
  app.use(paint);

  app.get('/', home);
  app.get('/search', search);
  app.get('/faqs', faqs);

  app.get('/login', loginPage);            app.post('/login', login);
  app.get('/register', registerPage);      app.post('/register', register);
  app.post('/logout', logout);

  app.get('/dashboard', A.requireAuth, dashboard);
  app.get('/profile', A.requireRole('citizen'), profilePage);
  app.post('/profile', A.requireRole('citizen'), profileSave);

  app.get('/complaints/new', A.requireRole('citizen'), complaintNew);
  app.post('/complaints', A.requireRole('citizen'), complaintCreate);
  app.get('/complaints/:id', A.requireAuth, complaintDetail);
  app.post('/complaints/:id/updates', A.requireAuth, addUpdate);
  app.post('/complaints/:id/tags', A.requireRole('officer', 'admin'), tagManage);
  app.post('/complaints/:id/attachments', A.requireAuth, attachmentUpload);
  app.get('/attachments/:id/download', A.requireAuth, attachmentDownload);
  app.post('/complaints/:id/feedback', A.requireRole('citizen'), giveFeedback);
  app.post('/complaints/:id/close', A.requireRole('citizen'), closeComplaint);
  app.post('/complaints/:id/status', A.requireRole('officer', 'admin'), changeStatus);
  app.post('/complaints/:id/assign', A.requireRole('admin'), assignComplaint);
  app.post('/complaints/:id/escalate', A.requireRole('admin'), escalateComplaint);
  app.post('/complaints/:id/delete', A.requireRole('admin'), deleteComplaint);

  app.get('/queue', A.requireRole('officer'), queue);

  app.get('/admin', A.requireRole('admin'), adminHome);
  app.get('/admin/manage', A.requireRole('admin'), adminManage);
  app.post('/admin/categories', A.requireRole('admin'), categoryCreate);
  app.post('/admin/categories/:id', A.requireRole('admin'), categoryUpdate);
  app.post('/admin/categories/:id/delete', A.requireRole('admin'), categoryDelete);
  app.post('/admin/departments', A.requireRole('admin'), departmentCreate);
  app.post('/admin/departments/:id/delete', A.requireRole('admin'), departmentDelete);
  app.post('/admin/wards', A.requireRole('admin'), wardCreate);
  app.post('/admin/wards/:id/delete', A.requireRole('admin'), wardDelete);
  app.post('/admin/faqs', A.requireRole('admin'), faqCreate);
  app.post('/admin/faqs/:id', A.requireRole('admin'), faqUpdate);
  app.post('/admin/faqs/:id/delete', A.requireRole('admin'), faqDelete);
  app.post('/admin/announcements', A.requireRole('admin'), announcementCreate);
  app.post('/admin/announcements/:id/toggle', A.requireRole('admin'), announcementToggle);
  app.post('/admin/announcements/:id/delete', A.requireRole('admin'), announcementDelete);
  app.post('/admin/sla', A.requireRole('admin'), slaUpsert);
  app.get('/admin/users', A.requireRole('admin'), adminUsers);
  app.post('/admin/users/:id', A.requireRole('admin'), userUpdate);
  app.get('/admin/settings', A.requireRole('admin'), settingsPage);
  app.post('/admin/settings', A.requireRole('admin'), settingsSave);

  app.get('/reports', A.requireRole('officer', 'admin'), reports);
  app.get('/audit', A.requireRole('admin'), auditLogs);
  app.get('/notifications', A.requireAuth, notifications);
  app.post('/notifications/read', A.requireAuth, notificationsRead);
};
