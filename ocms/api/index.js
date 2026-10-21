'use strict';
// api/index.js — Vercel serverless entrypoint: cold-start DB connect, then hand off to the Express app.
const { app, ready } = require('../server');

module.exports = async (req, res) => {
  if (req.path === '/api/health') {
    res.status(200).json({ ok: true });
    return;
  }
  try {
    await ready;
  } catch (e) {
    res.status(500).type('html').send(
      `<h1>500 — Database connection failed</h1>`
      + `<pre>${String(e.message)}</pre>`
      + `<p><b>Fix on Vercel:</b> ① Project → Settings → Environment Variables → <code>MONGO_URI</code> = your Atlas URI, then Redeploy.`
      + ` ② MongoDB Atlas → Network Access → add IP <code>0.0.0.0/0</code>.`
      + ` ③ Seed the cloud DB (npm run seed with MONGO_URI pointed at Atlas).</p>`
    );
    return;
  }
  return app(req, res);
};
