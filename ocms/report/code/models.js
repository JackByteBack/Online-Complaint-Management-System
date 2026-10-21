'use strict';
// models.js — all MongoDB collections (20) for the Online Complaint Management System.
// Requirement mapping (collections, indexes, text index) lives at the bottom of this file.

const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

/* ------------------------------------------------------------------ users */
const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true }, // unique index (auto)
  phone: { type: String, trim: true, maxlength: 15 },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  role: { type: String, enum: ['citizen', 'officer', 'admin'], required: true, index: true },
  active: { type: Boolean, default: true },
  stats: { complaintsFiled: { type: Number, default: 0 }, resolvedReceived: { type: Number, default: 0 } },
  createdAt: { type: Date, default: Date.now }
});

/* --------------------------------------------------------------- sessions */
const sessionSchema = new Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index — Mongo auto-deletes expired sessions

/* --------------------------------------------------------------- citizens */
const citizenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  address: {                         // embedded document (document handling)
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: { type: String, default: '' },
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward' }
  }
});

/* --------------------------------------------------------------- officers */
const officerSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
  designation: { type: String, default: 'Ward Officer' },
  openCases: { type: Number, default: 0 }   // maintained with $inc
}, { timestamps: true });

/* ------------------------------------------------------------ departments */
const departmentSchema = new Schema({
  name: { type: String, required: true, index: true },
  code: { type: String, required: true, unique: true },      // e.g. SMP, WTR
  head: { type: String, default: '' },                        // officer-in-charge name
  email: { type: String, default: '' },
  categories: [String]                                        // category codes handled
}, { timestamps: true });

/* ------------------------------------------------------------------ wards */
const wardSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  city: { type: String, default: 'Mumbai' },
  population: { type: Number, default: 0 }
});

/* ------------------------------------------------------------- categories */
const categorySchema = new Schema({
  name: { type: String, required: true, index: true },
  code: { type: String, required: true, unique: true },       // e.g. ROAD
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '📋' },
  active: { type: Boolean, default: true },
  totalFiled: { type: Number, default: 0 }                     // $inc counter on new complaint
}, { timestamps: true });

/* -------------------------------------------------------------- sla_rules */
// Expected resolution window per category + priority. dueAt on complaints derives from here.
const slaRuleSchema = new Schema({
  categoryCode: { type: String, required: true },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], required: true },
  maxDays: { type: Number, required: true, min: 1, max: 90 }
}, {
  timestamps: true
});
slaRuleSchema.index({ categoryCode: 1, priority: 1 }, { unique: true }); // compound unique index

/* ------------------------------------------------------------- complaints */
const complaintSchema = new Schema({
  ticketNo: { type: String, required: true, unique: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true },
  citizenId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  categoryCode: { type: String, required: true, index: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', index: true },
 wardId: { type: Schema.Types.ObjectId, ref: 'Ward', index: true },
  status: { type: String, enum: ['Submitted', 'In Progress', 'Resolved', 'Closed', 'Rejected'],
            default: 'Submitted', index: true },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium', index: true },
  priorityRank: { type: Number, default: 1 },                 // numeric rank for priority-first sorting
  tags: [String],                                              // array field ($addToSet/$pull/$unwind)
  assignedOfficerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  createdAt: { type: Date, default: Date.now },
  dueAt: { type: Date },
  resolvedAt: { type: Date, index: true },
  resolution: {                                               // embedded resolution doc
    note: String,
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  duplicateOf: { type: Schema.Types.ObjectId, ref: 'Complaint' } // null unless merged
}, { timestamps: true });

// ★ TEXT INDEX — powers /search ($text $search)
complaintSchema.index({ title: 'text', description: 'text', tags: 'text' });
// ★ COMPOUND INDEX — status dashboard listing (status: X, newest first)
complaintSchema.index({ status: 1, createdAt: -1 });
// compound for project text search by category
complaintSchema.index({ categoryCode: 1, status: 1 });

/* -------------------------------------------------------- complaint_updates */
const updateSchema = new Schema({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: String,
  kind: { type: String, enum: ['Comment', 'StatusChange', 'Reassignment', 'Escalation'], default: 'Comment' },
  text: { type: String, required: true },
  oldStatus: String,
  newStatus: String,
  createdAt: { type: Date, default: Date.now }
}, { capped: false });

/* ----------------------------------------------------------- attachments */
const attachmentSchema = new Schema({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  mime: { type: String, default: 'application/octet-stream' },
  size: { type: Number, default: 0 },
  dataB64: { type: String, select: false },   // heavy field hidden from projections by default
  createdAt: { type: Date, default: Date.now }
});

/* ------------------------------------------------------------ assignments */
const assignmentSchema = new Schema({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true, index: true },
  officerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  byAdminId: { type: Schema.Types.ObjectId, ref: 'User' },
  note: { type: String, default: '' },
  reassigned: { type: Boolean, default: false },
  assignedAt: { type: Date, default: Date.now }
});

/* ------------------------------------------------------------ escalations */
const escalationSchema = new Schema({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
  raisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String, required: true },
  oldPriority: String,
  newPriority: String,
  resolved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

/* --------------------------------------------------------------- feedback */
const feedbackSchema = new Schema({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
feedbackSchema.index({ complaintId: 1, userId: 1 }, { unique: true }); // one rating per citizen per ticket

/* ----------------------------------------------------------- notifications */
const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  link: String,
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

/* ------------------------------------------------------------------- faqs */
const faqSchema = new Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  categoryCode: String,
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

/* ---------------------------------------------------------- announcements */
const announcementSchema = new Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  audience: { type: String, enum: ['all', 'citizen', 'staff'], default: 'all' },
  postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  active: { type: Boolean, default: true },
  postedAt: { type: Date, default: Date.now }
}, { timestamps: true });

/* ------------------------------------------------------------- audit_logs */
const auditLogSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  actorName: String,
  action: String,        // create | update | delete | assign | escalate | login …
  entity: String,        // Complaint | Category | Department | …
  entityId: { type: Schema.Types.ObjectId },
  meta: Schema.Types.Mixed,   // embedded arbitrary doc
  createdAt: { type: Date, default: Date.now }
});
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

/* ----------------------------------------------------------- app_settings */
const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now }
});

/* --------------------------------------------------------------- counters */
const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 }
});

const Complaint = mongoose.models.Complaint || mongoose.model('Complaint', complaintSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
const Citizen = mongoose.models.Citizen || mongoose.model('Citizen', citizenSchema);
const Officer = mongoose.models.Officer || mongoose.model('Officer', officerSchema);
const Department = mongoose.models.Department || mongoose.model('Department', departmentSchema);
const Ward = mongoose.models.Ward || mongoose.model('Ward', wardSchema);
const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
const SlaRule = mongoose.models.SlaRule || mongoose.model('SlaRule', slaRuleSchema);
const Update = mongoose.models.Update || mongoose.model('Update', updateSchema);
const Attachment = mongoose.models.Attachment || mongoose.model('Attachment', attachmentSchema);
const Assignment = mongoose.models.Assignment || mongoose.model('Assignment', assignmentSchema);
const Escalation = mongoose.models.Escalation || mongoose.model('Escalation', escalationSchema);
const Feedback = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
const Faq = mongoose.models.Faq || mongoose.model('Faq', faqSchema);
const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

module.exports = {
  // 20 collections
  User, Session, Citizen, Officer, Department, Ward, Category, SlaRule, Complaint,
  Update, Attachment, Assignment, Escalation, Feedback, Notification, Faq,
  Announcement, AuditLog, Setting, Counter,
  nextTicketNo
};

// atomic ticket generation: findOneAndUpdate + $inc (atomic document update)
async function nextTicketNo() {
  const c = await Counter.findOneAndUpdate(
    { key: 'complaint' },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );
  const year = new Date().getFullYear();
  return `OCMS-${year}-${String(c.value).padStart(5, '0')}`;
}
