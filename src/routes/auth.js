const express = require('express');
const { getSetting, setSetting } = require('../db');
const { hashPassword, verifyPassword } = require('../auth');

const router = express.Router();

router.get('/setup', (req, res) => {
  if (getSetting('admin_password_hash')) return res.redirect('/login');
  res.render('setup', { title: 'First-time setup', hideNav: true, error: null });
});

router.post('/setup', (req, res) => {
  if (getSetting('admin_password_hash')) return res.redirect('/login');

  const { password, confirmPassword } = req.body;
  if (!password || password.length < 8) {
    return res.render('setup', {
      title: 'First-time setup',
      hideNav: true,
      error: 'Password must be at least 8 characters.',
    });
  }
  if (password !== confirmPassword) {
    return res.render('setup', {
      title: 'First-time setup',
      hideNav: true,
      error: 'Passwords do not match.',
    });
  }

  setSetting('admin_password_hash', hashPassword(password));
  req.session.isAdmin = true;
  res.redirect('/dashboard');
});

router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/dashboard');
  res.render('login', { title: 'Log in', hideNav: true, error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const stored = getSetting('admin_password_hash');

  if (!stored || !verifyPassword(password || '', stored)) {
    return res.render('login', {
      title: 'Log in',
      hideNav: true,
      error: 'Incorrect password.',
    });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.render('login', { title: 'Log in', hideNav: true, error: 'Something went wrong, try again.' });
    }
    req.session.isAdmin = true;
    res.redirect('/dashboard');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
