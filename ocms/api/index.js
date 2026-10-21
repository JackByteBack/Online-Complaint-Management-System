'use strict';
// api/index.js — Vercel serverless entrypoint: cold-start DB connect, then hand off to the Express app.
const { app, ready } = require('../server');

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
