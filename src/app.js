const path = require('path');
const express = require('express');
const session = require('express-session');

const { requireSetup } = require('./middleware');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const publicRoutes = require('./routes/public');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[warn] SESSION_SECRET is not set. Using an insecure default — set SESSION_SECRET in your .env for production.'
  );
}

app.use(
  session({
    name: 'htmldocs.sid',
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production' && process.env.TRUST_SECURE_COOKIE === 'true',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(requireSetup);

app.use(authRoutes);
app.use('/dashboard', dashboardRoutes);

// Public document viewer is a catch-all on /:slug, so it must be mounted last.
app.use(publicRoutes);

app.use((req, res) => {
  res.status(404).render('viewer/notfound', { slug: null });
});

module.exports = app;
