const path = require('path');
const fs = require('fs');
const express = require('express');

const { db } = require('../db');
const { verifyPassword } = require('../auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function getDocBySlug(slug) {
  return db.prepare('SELECT * FROM documents WHERE slug = ?').get(slug);
}

function isExpired(doc) {
  return !!doc.expires_at && new Date(doc.expires_at).getTime() < Date.now();
}

function isUnlocked(req, doc) {
  return !!(req.session.unlockedDocs && req.session.unlockedDocs.includes(doc.id));
}

function serveDocument(req, res, doc) {
  const filePath = path.join(UPLOAD_DIR, doc.filename);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      return res.status(500).render('viewer/notfound', { slug: doc.slug });
    }
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        // Serve untrusted, user-uploaded HTML with an opaque/unique origin so any
        // embedded script cannot read this app's cookies, localStorage, or make
        // authenticated requests back to the dashboard.
        'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
      })
      .send(html);
  });
}

router.get('/:slug', (req, res, next) => {
  const doc = getDocBySlug(req.params.slug);
  if (!doc) return next();

  if (isExpired(doc)) {
    return res.status(410).render('viewer/expired', { slug: doc.slug });
  }

  if (doc.password_hash && !isUnlocked(req, doc)) {
    return res.render('viewer/password', { slug: doc.slug, title: doc.title, error: null });
  }

  serveDocument(req, res, doc);
});

router.post('/:slug', (req, res, next) => {
  const doc = getDocBySlug(req.params.slug);
  if (!doc) return next();

  if (isExpired(doc)) {
    return res.status(410).render('viewer/expired', { slug: doc.slug });
  }

  if (!doc.password_hash) {
    return res.redirect(`/${doc.slug}`);
  }

  const { password } = req.body;
  if (!verifyPassword(password || '', doc.password_hash)) {
    return res.render('viewer/password', { slug: doc.slug, title: doc.title, error: 'Incorrect password.' });
  }

  if (!req.session.unlockedDocs) req.session.unlockedDocs = [];
  if (!req.session.unlockedDocs.includes(doc.id)) req.session.unlockedDocs.push(doc.id);

  res.redirect(`/${doc.slug}`);
});

module.exports = router;
