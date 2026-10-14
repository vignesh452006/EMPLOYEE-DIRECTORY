require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const { testConnection } = require('./config/db');
const { initDatabase } = require('./database/init');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const gemini = require('./services/gemini');
const { avatarSVG } = require('./services/avatar');
const { pool: dbPool } = require('./config/db');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------
// View engine
// ---------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------
// Middleware
// ---------------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
    secure: process.env.NODE_ENV === 'production',
  },
}));
app.use(flash());

// Make flash messages & current admin available in every view
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentAdmin = req.session.admin || null;
  res.locals.currentPath = req.path;
  res.locals.aiEnabled = gemini.isConfigured();
  next();
});

// Generated professional portrait (used when an employee has no uploaded photo)
app.get('/avatar/:id.svg', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  let name = '';
  try { const [r] = await dbPool.query('SELECT full_name FROM employees WHERE id = ?', [id]); name = r[0] ? r[0].full_name : ''; } catch (e) { /* ignore */ }
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
  let svg = avatarSVG(id + ':' + name, name);
  if (req.query.f) svg = svg.replace('viewBox="0 0 300 360"', 'viewBox="62 78 176 176"'); // tight face crop for small avatars
  res.send(svg);
});

// ---------------------------------------------------------
// Routes
// ---------------------------------------------------------
app.use('/', aiRoutes);
app.use('/admin', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

// Health check endpoint (useful for Railway)
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// ---------------------------------------------------------
// Boot
// ---------------------------------------------------------
async function start() {
  await testConnection();
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`🚀  Employee Directory running on port ${PORT}`);
  });
}

start();
