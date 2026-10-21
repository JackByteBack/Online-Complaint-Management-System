'use strict';
// server.js — app bootstrap, cookie parsing, view setup. All routes live in routes.js.

require('./env');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { loadUser } = require('./auth');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ocms';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('query parser', 'extended');   // qs: repeated form fields parse to arrays (multi-select filters)

// static assets + body parsing (built into express)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// minimal cookie parser (avoid cookie-parser dependency)
app.use((req, res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  next();
});

app.use(loadUser);
require('./routes')(app);

// 404 / error handling
app.use((req, res) => res.status(404).render('error', { user: req.user, code: 404, msg: 'Page not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { user: req.user, code: 500, msg: 'Something went wrong' });
});

mongoose.connect(MONGO_URI)
  .then(async () => {
    // keep schema-declared indexes (text/TTL/compound) aligned with models on every boot
    await mongoose.syncIndexes();
    // log the URI without credentials
    console.log(`MongoDB connected → ${MONGO_URI.replace(/\/\/.*@/, '//<credentials>@')}`);
    app.listen(PORT, () => console.log(`OCMS running → http://localhost:${PORT}`));
  })
  .catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
