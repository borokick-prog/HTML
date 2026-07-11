const express = require('express');
const multer = require('multer');

const { pool, getSetting, setSetting } = require('../db');
const { hashPassword, verifyPassword } = require('../auth');
const { validateSlug, slugify } = require('../slug');
const { requireAdmin } = require('../middleware');

const router = express.Router();
router.use(requireAdmin);

// Vercel's Hobby plan caps serverless request bodies at ~4.5MB, so the
// uploaded file (held in memory, never touching disk) is kept under that.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase();
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

async function getFolders() {
  const { rows } = await pool.query('SELECT * FROM folders ORDER BY lower(name)');
  return rows;
}

async function getDocument(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return undefined;
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [numericId]);
  return rows[0];
}

// ---- Dashboard home / document list ----

router.get('/', async (req, res, next) => {
  try {
    const folders = await getFolders();

    let docs;
    if (req.query.folder === 'none') {
      docs = (await pool.query('SELECT * FROM documents WHERE folder_id IS NULL ORDER BY updated_at DESC')).rows;
    } else if (req.query.folder) {
      docs = (
        await pool.query('SELECT * FROM documents WHERE folder_id = $1 ORDER BY updated_at DESC', [Number(req.query.folder)])
      ).rows;
    } else {
      docs = (await pool.query('SELECT * FROM documents ORDER BY updated_at DESC')).rows;
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
  } catch (err) {
    next(err);
  }
});

// ---- New document ----

router.get('/documents/new', async (req, res, next) => {
  try {
    res.render('dashboard/new', {
      title: 'Upload document',
      folders: await getFolders(),
      error: null,
      form: {},
    });
  } catch (err) {
    next(err);
  }
});

router.post('/documents', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      const folders = await getFolders();

      if (err) {
        return res.render('dashboard/new', { title: 'Upload document', folders, error: err.message, form: req.body });
      }

      const { title, folderId, password, expiresAt } = req.body;
      const slug = slugify(req.body.slug || '');

      const renderError = (message) =>
        res.render('dashboard/new', { title: 'Upload document', folders, error: message, form: req.body });

      if (!req.file) return renderError('Please choose an HTML file to upload.');
      if (!title || !title.trim()) return renderError('Title is required.');

      const slugError = validateSlug(slug);
      if (slugError) return renderError(slugError);

      const { rows: existingRows } = await pool.query('SELECT id FROM documents WHERE slug = $1', [slug]);
      if (existingRows[0]) return renderError(`Slug "${slug}" is already in use.`);

      const now = new Date().toISOString();
      const passwordHash = password && password.trim() ? hashPassword(password.trim()) : null;
      const expiresIso = toEndOfDayIso(expiresAt);
      const content = req.file.buffer.toString('utf8');

      await pool.query(
        `INSERT INTO documents (slug, title, content, original_filename, folder_id, password_hash, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [slug, title.trim(), content, req.file.originalname, folderId ? Number(folderId) : null, passwordHash, expiresIso, now, now]
      );

      res.redirect('/dashboard?success=' + encodeURIComponent(`"${title.trim()}" uploaded to /${slug}`));
    } catch (queryErr) {
      next(queryErr);
    }
  });
});

// ---- Edit document ----

router.get('/documents/:id/edit', async (req, res, next) => {
  try {
    const doc = await getDocument(req.params.id);
    if (!doc) return res.redirect('/dashboard?error=Document+not+found');
    res.render('dashboard/edit', {
      title: `Edit ${doc.title}`,
      doc,
      folders: await getFolders(),
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/documents/:id', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      const doc = await getDocument(req.params.id);
      if (!doc) return res.redirect('/dashboard?error=Document+not+found');

      const folders = await getFolders();

      if (err) {
        return res.render('dashboard/edit', { title: `Edit ${doc.title}`, doc, folders, error: err.message });
      }

      const { title, folderId, password, clearPassword, expiresAt } = req.body;
      const slug = slugify(req.body.slug || '');

      const renderError = (message) =>
        res.render('dashboard/edit', { title: `Edit ${doc.title}`, doc: { ...doc, ...req.body }, folders, error: message });

      if (!title || !title.trim()) return renderError('Title is required.');

      const slugError = validateSlug(slug);
      if (slugError) return renderError(slugError);

      const { rows: existingRows } = await pool.query('SELECT id FROM documents WHERE slug = $1 AND id != $2', [slug, doc.id]);
      if (existingRows[0]) return renderError(`Slug "${slug}" is already in use.`);

      let passwordHash = doc.password_hash;
      if (clearPassword === 'on') {
        passwordHash = null;
      } else if (password && password.trim()) {
        passwordHash = hashPassword(password.trim());
      }

      const expiresIso = expiresAt ? toEndOfDayIso(expiresAt) : null;

      let content = doc.content;
      let originalFilename = doc.original_filename;
      if (req.file) {
        content = req.file.buffer.toString('utf8');
        originalFilename = req.file.originalname;
      }

      await pool.query(
        `UPDATE documents SET title = $1, slug = $2, folder_id = $3, password_hash = $4, expires_at = $5, content = $6, original_filename = $7, updated_at = $8
         WHERE id = $9`,
        [title.trim(), slug, folderId ? Number(folderId) : null, passwordHash, expiresIso, content, originalFilename, new Date().toISOString(), doc.id]
      );

      res.redirect('/dashboard?success=' + encodeURIComponent(`"${title.trim()}" updated`));
    } catch (queryErr) {
      next(queryErr);
    }
  });
});

router.post('/documents/:id/delete', async (req, res, next) => {
  try {
    const doc = await getDocument(req.params.id);
    if (!doc) return res.redirect('/dashboard?error=Document+not+found');

    await pool.query('DELETE FROM documents WHERE id = $1', [doc.id]);
    res.redirect('/dashboard?success=' + encodeURIComponent(`"${doc.title}" deleted`));
  } catch (err) {
    next(err);
  }
});

// ---- Folders ----

router.post('/folders', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.redirect('/dashboard?error=Folder+name+is+required');

    await pool.query('INSERT INTO folders (name, created_at) VALUES ($1, $2)', [name, new Date().toISOString()]);
    res.redirect('/dashboard?success=' + encodeURIComponent(`Folder "${name}" created`));
  } catch (err) {
    next(err);
  }
});

router.post('/folders/:id/rename', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.redirect('/dashboard?error=Folder+name+is+required');

    await pool.query('UPDATE folders SET name = $1 WHERE id = $2', [name, Number(req.params.id)]);
    res.redirect('/dashboard?success=' + encodeURIComponent('Folder renamed'));
  } catch (err) {
    next(err);
  }
});

router.post('/folders/:id/delete', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM folders WHERE id = $1', [Number(req.params.id)]);
    res.redirect('/dashboard?success=' + encodeURIComponent('Folder deleted (documents moved to Uncategorized)'));
  } catch (err) {
    next(err);
  }
});

// ---- Settings ----

router.get('/settings', (req, res) => {
  res.render('dashboard/settings', { title: 'Settings', error: null, success: null });
});

router.post('/settings/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const stored = await getSetting('admin_password_hash');

    if (!verifyPassword(currentPassword || '', stored)) {
      return res.render('dashboard/settings', { title: 'Settings', error: 'Current password is incorrect.', success: null });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.render('dashboard/settings', { title: 'Settings', error: 'New password must be at least 8 characters.', success: null });
    }
    if (newPassword !== confirmPassword) {
      return res.render('dashboard/settings', { title: 'Settings', error: 'New passwords do not match.', success: null });
    }

    await setSetting('admin_password_hash', hashPassword(newPassword));
    res.render('dashboard/settings', { title: 'Settings', error: null, success: 'Password updated.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
