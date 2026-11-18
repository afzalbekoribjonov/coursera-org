const path = require('path');
const express = require('express');
const Certificate = require('./models/Certificate');
const { findCourse, verifyUrl, courses } = require('./services/certificates');
const { brand, publicUrl } = require('./config');

function formatDate(d, style = 'long') {
  return new Date(d).toLocaleDateString('en-US', {
    month: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));

  app.locals.brand = brand;
  app.locals.publicUrl = publicUrl;
  app.locals.formatDate = formatDate;
  app.locals.formatNumber = (n) => Number(n).toLocaleString('en-US');

  app.head('/health', (req, res) => res.status(200).end());
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.get('/', async (req, res, next) => {
    try {
      const total = await Certificate.estimatedDocumentCount();
      res.render('home', { total, courses, error: null });
    } catch (e) {
      next(e);
    }
  });

  // Bosh sahifadagi forma: kod yoki link bo'yicha tekshirish
  app.post('/lookup', express.urlencoded({ extended: false }), async (req, res, next) => {
    try {
      const raw = String(req.body.q || '').trim();
      const token = raw.split('/').filter(Boolean).pop() || '';
      const cert = await Certificate.findOne({
        $or: [{ shareId: token.toLowerCase() }, { verifyCode: token.toUpperCase() }],
      }).lean();
      if (cert) return res.redirect(`/share/${cert.shareId}`);
      const total = await Certificate.estimatedDocumentCount();
      res.status(404).render('home', { total, courses, error: 'Certificate not found. Check the link or code.' });
    } catch (e) {
      next(e);
    }
  });

  app.get('/share/:shareId', async (req, res, next) => {
    try {
      const shareId = String(req.params.shareId).toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(shareId)) return res.status(404).render('notfound');
      const cert = await Certificate.findOne({ shareId }).lean();
      if (!cert) return res.status(404).render('notfound');
      const course = findCourse(cert.courseSlug) || { title: cert.courseTitle, rating: 4.7, ratingsCount: 0, enrolled: 0 };
      res.render('share', { cert, course, verifyLink: verifyUrl(cert) });
    } catch (e) {
      next(e);
    }
  });

  app.get('/verify/:code', async (req, res, next) => {
    try {
      const code = String(req.params.code).toUpperCase();
      const cert = await Certificate.findOne({ verifyCode: code }).lean();
      if (!cert) return res.status(404).render('notfound');
      res.redirect(`/share/${cert.shareId}`);
    } catch (e) {
      next(e);
    }
  });

  // Alohida, chop etish/yuklab olish uchun sertifikat sahifasi
  app.get('/certificate/:shareId', async (req, res, next) => {
    try {
      const cert = await Certificate.findOne({ shareId: String(req.params.shareId).toLowerCase() }).lean();
      if (!cert) return res.status(404).render('notfound');
      res.render('certificate', { cert, verifyLink: verifyUrl(cert) });
    } catch (e) {
      next(e);
    }
  });

  return app;
}

function attachFallbacks(app) {
  app.use((req, res) => res.status(404).render('notfound'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Internal Server Error');
  });
}

module.exports = { createApp, attachFallbacks };
