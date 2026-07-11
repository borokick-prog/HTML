const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { db, getSetting, setSetting } = require('../db');
const { hashPassword, verifyPassword } = require('../auth');
const { validateSlug, slugify } = require('../slug');
const { requireAdmin } = require('../middleware');

const router = express.Router();
router.use(requireAdmin);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.html`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') {
      return cb(new Error('Only .html or .htm files are allowed.'));
    }
    cb(null, true);
  },
});

function toEndOfDayIso(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function docStatus(doc) {
  if (doc.expires_at && new Date(doc.expires_at).getTime() < Date.now()) return 'expired';
  if (doc.password_hash) return 'protected';
  return 'active';
}

function getFolders() {
  return db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all();
}

function getDocument(id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

function deleteDocFile(doc) {
  const filePath = path.join(UPLOAD_DIR, doc.filename);
  fs.promises.unlink(filePath).catch(() => {});
}

// ---- Dashboard home / document list ----

router.get('/', (req, res) => {
  const folderId = req.query.folder ? Number(req.query.folder) : null;
  const folders = getFolders();

  let docs;
  if (folderId) {
    docs = db.prepare('SELECT * FROM documents WHERE folder_id = ? ORDER BY updated_at DESC').all(folderId);
  } else if (req.query.folder === 'none') {
    docs = db.prepare('SELECT * FROM documents WHERE folder_id IS NULL ORDER BY updated_at DESC').all();
  } else {
    docs = db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all();
  }

  const docsWithStatus = docs.map((d) => ({ ...d, status: docStatus(d) }));

  res.render('dashboard/index', {
    title: 'Documents',
    docs: docsWithStatus,
    folders,
    activeFolder: req.query.folder || null,
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

// ---- New document ----

router.get('/documents/new', (req, res) => {
  res.render('dashboard/new', {
    title: 'Upload document',
    folders: getFolders(),
    error: null,
    form: {},
  });
});

router.post('/documents', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.render('dashboard/new', {
        title: 'Upload document',
        folders: getFolders(),
        error: err.message,
        form: req.body,
      });
    }

    const { title, folderId, password, expiresAt } = req.body;
    let slug = slugify(req.body.slug || '');

    const renderError = (message) => {
      if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
      return res.render('dashboard/new', {
        title: 'Upload document',
        folders: getFolders(),
        error: message,
        form: req.body,
      });
    };

    if (!req.file) return renderError('Please choose an HTML file to upload.');
    if (!title || !title.trim()) return renderError('Title is required.');

    const slugError = validateSlug(slug);
    if (slugError) return renderError(slugError);

    const existing = db.prepare('SELECT id FROM documents WHERE slug = ?').get(slug);
    if (existing) return renderError(`Slug "${slug}" is already in use.`);

    const now = new Date().toISOString();
    const passwordHash = password && password.trim() ? hashPassword(password.trim()) : null;
    const expiresIso = toEndOfDayIso(expiresAt);

    db.prepare(
      `INSERT INTO documents (slug, title, filename, original_filename, folder_id, password_hash, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      slug,
      title.trim(),
      req.file.filename,
      req.file.originalname,
      folderId ? Number(folderId) : null,
      passwordHash,
      expiresIso,
      now,
      now
    );

    res.redirect('/dashboard?success=' + encodeURIComponent(`"${title.trim()}" uploaded to /${slug}`));
  });
});

// ---- Edit document ----

router.get('/documents/:id/edit', (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) return res.redirect('/dashboard?error=Document+not+found');
  res.render('dashboard/edit', {
    title: `Edit ${doc.title}`,
    doc,
    folders: getFolders(),
    error: null,
  });
});

router.post('/documents/:id', (req, res) => {
  upload.single('file')(req, res, (err) => {
    const doc = getDocument(req.params.id);
    if (!doc) return res.redirect('/dashboard?error=Document+not+found');

    if (err) {
      return res.render('dashboard/edit', { title: `Edit ${doc.title}`, doc, folders: getFolders(), error: err.message });
    }

    const { title, folderId, password, clearPassword, expiresAt } = req.body;
    let slug = slugify(req.body.slug || '');

    const renderError = (message) => {
      if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
      return res.render('dashboard/edit', { title: `Edit ${doc.title}`, doc: { ...doc, ...req.body }, folders: getFolders(), error: message });
    };

    if (!title || !title.trim()) return renderError('Title is required.');

    const slugError = validateSlug(slug);
    if (slugError) return renderError(slugError);

    const existing = db.prepare('SELECT id FROM documents WHERE slug = ? AND id != ?').get(slug, doc.id);
    if (existing) return renderError(`Slug "${slug}" is already in use.`);

    let passwordHash = doc.password_hash;
    if (clearPassword === 'on') {
      passwordHash = null;
    } else if (password && password.trim()) {
      passwordHash = hashPassword(password.trim());
    }

    const expiresIso = expiresAt ? toEndOfDayIso(expiresAt) : null;

    let filename = doc.filename;
    let originalFilename = doc.original_filename;
    if (req.file) {
      deleteDocFile(doc);
      filename = req.file.filename;
      originalFilename = req.file.originalname;
    }

    db.prepare(
      `UPDATE documents SET title = ?, slug = ?, folder_id = ?, password_hash = ?, expires_at = ?, filename = ?, original_filename = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      title.trim(),
      slug,
      folderId ? Number(folderId) : null,
      passwordHash,
      expiresIso,
      filename,
      originalFilename,
      new Date().toISOString(),
      doc.id
    );

    res.redirect('/dashboard?success=' + encodeURIComponent(`"${title.trim()}" updated`));
  });
});

router.post('/documents/:id/delete', (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) return res.redirect('/dashboard?error=Document+not+found');

  deleteDocFile(doc);
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  res.redirect('/dashboard?success=' + encodeURIComponent(`"${doc.title}" deleted`));
});

// ---- Folders ----

router.post('/folders', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/dashboard?error=Folder+name+is+required');

  db.prepare('INSERT INTO folders (name, created_at) VALUES (?, ?)').run(name, new Date().toISOString());
  res.redirect('/dashboard?success=' + encodeURIComponent(`Folder "${name}" created`));
});

router.post('/folders/:id/rename', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/dashboard?error=Folder+name+is+required');

  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, req.params.id);
  res.redirect('/dashboard?success=' + encodeURIComponent('Folder renamed'));
});

router.post('/folders/:id/delete', (req, res) => {
  db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id);
  res.redirect('/dashboard?success=' + encodeURIComponent('Folder deleted (documents moved to Uncategorized)'));
});

// ---- Settings ----

router.get('/settings', (req, res) => {
  res.render('dashboard/settings', { title: 'Settings', error: null, success: null });
});

router.post('/settings/password', (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const stored = getSetting('admin_password_hash');

  if (!verifyPassword(currentPassword || '', stored)) {
    return res.render('dashboard/settings', { title: 'Settings', error: 'Current password is incorrect.', success: null });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.render('dashboard/settings', { title: 'Settings', error: 'New password must be at least 8 characters.', success: null });
  }
  if (newPassword !== confirmPassword) {
    return res.render('dashboard/settings', { title: 'Settings', error: 'New passwords do not match.', success: null });
  }

  setSetting('admin_password_hash', hashPassword(newPassword));
  res.render('dashboard/settings', { title: 'Settings', error: null, success: 'Password updated.' });
});

module.exports = router;
