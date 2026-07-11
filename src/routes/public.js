const express = require('express');

const { pool } = require('../db');
const { verifyPassword } = require('../auth');

const router = express.Router();

async function getDocBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE slug = $1', [slug]);
  return rows[0];
}

function isExpired(doc) {
  return !!doc.expires_at && new Date(doc.expires_at).getTime() < Date.now();
}

function isUnlocked(req, doc) {
  return !!(req.session.unlockedDocs && req.session.unlockedDocs.includes(doc.id));
}

function serveDocument(res, doc) {
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
    .send(doc.content);
}

router.get('/:slug', async (req, res, next) => {
  try {
    const doc = await getDocBySlug(req.params.slug);
    if (!doc) return next();

    if (isExpired(doc)) {
      return res.status(410).render('viewer/expired', { slug: doc.slug });
    }

    if (doc.password_hash && !isUnlocked(req, doc)) {
      return res.render('viewer/password', { slug: doc.slug, title: doc.title, error: null });
    }

    serveDocument(res, doc);
  } catch (err) {
    next(err);
  }
});

router.post('/:slug', async (req, res, next) => {
  try {
    const doc = await getDocBySlug(req.params.slug);
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
  } catch (err) {
    next(err);
  }
});

module.exports = router;
