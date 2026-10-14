const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { csvUpload } = upload;
const { parseCSV } = require('../middleware/csvParser');
const gemini = require('../services/gemini');

router.use(requireAuth);

async function logActivity(req, action, targetType, targetId, details) {
  try {
    await pool.query(
      'INSERT INTO activity_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.session.admin.id, action, targetType, targetId || null, details || '']
    );
  } catch (err) {
    console.error('Activity log failed:', err.message);
  }
}

// ---------------------------------------------------------
// Dashboard
// ---------------------------------------------------------
router.get('/dashboard', async (req, res) => {
  const empty = {
    title: 'Admin Dashboard', stats: { total: 0, active: 0, onLeave: 0, deptCount: 0, newThisMonth: 0, avgTenure: 0 },
    byDept: [], recent: [], activity: [], hires: [], quality: { total: 0, items: [] }, incomplete: [], gemini: gemini.isConfigured(),
  };
  try {
    const one = async (sql) => (await pool.query(sql))[0][0];
    const t = await one('SELECT COUNT(*) AS total FROM employees');
    const a = await one("SELECT COUNT(*) AS n FROM employees WHERE status = 'active'");
    const l = await one("SELECT COUNT(*) AS n FROM employees WHERE status = 'on_leave'");
    const d = await one('SELECT COUNT(*) AS n FROM departments');
    const nm = await one("SELECT COUNT(*) AS n FROM employees WHERE hire_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");
    const tn = await one('SELECT ROUND(AVG(DATEDIFF(CURDATE(), hire_date) / 365), 1) AS n FROM employees WHERE hire_date IS NOT NULL');
    const [byDept] = await pool.query(
      `SELECT d.name, d.color, COUNT(e.id) AS count
       FROM departments d LEFT JOIN employees e ON e.department_id = d.id
       GROUP BY d.id ORDER BY count DESC`
    );
    const [recent] = await pool.query(
      `SELECT e.*, d.name AS department_name FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       ORDER BY e.created_at DESC LIMIT 5`
    );
    const [activity] = await pool.query(
      `SELECT a.*, ad.name AS admin_name FROM activity_log a
       LEFT JOIN admins ad ON ad.id = a.admin_id
       ORDER BY a.created_at DESC LIMIT 8`
    );
    // hires per year, last 8 years
    const [hireRows] = await pool.query(
      `SELECT YEAR(hire_date) AS y, COUNT(*) AS c FROM employees WHERE hire_date IS NOT NULL GROUP BY y`);
    const hmap = new Map(hireRows.map((r) => [Number(r.y), Number(r.c)]));
    const hires = [];
    const thisYear = new Date().getFullYear();
    for (let y = thisYear - 7; y <= thisYear; y++) hires.push({ label: String(y), count: hmap.get(y) || 0 });
    // profile completeness
    const q = await one(
      `SELECT COUNT(*) AS total,
        SUM(avatar_url IS NOT NULL AND avatar_url != '') AS photo, SUM(bio IS NOT NULL AND bio != '') AS bio,
        SUM(skills IS NOT NULL AND skills != '') AS skills, SUM(phone IS NOT NULL AND phone != '') AS phone,
        SUM(location IS NOT NULL AND location != '') AS location, SUM(hire_date IS NOT NULL) AS hire FROM employees`);
    const quality = { total: Number(q.total) || 0, items: [
      ['Bio', q.bio], ['Skills', q.skills], ['Phone', q.phone], ['Location', q.location], ['Hire date', q.hire], ['Uploaded photo', q.photo],
    ].map(([name, n]) => ({ name, n: Number(n) || 0, pct: q.total ? Math.round((Number(n) || 0) / q.total * 100) : 0 })) };
    const [incomplete] = await pool.query(
      `SELECT id, full_name, bio, skills, phone FROM employees
       WHERE bio IS NULL OR bio = '' OR skills IS NULL OR skills = '' OR phone IS NULL OR phone = '' ORDER BY updated_at ASC LIMIT 6`);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { total: t.total, active: a.n, onLeave: l.n, deptCount: d.n, newThisMonth: nm.n, avgTenure: tn.n || 0 },
      byDept, recent, activity, hires, quality, incomplete, gemini: gemini.isConfigured(),
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load dashboard.');
    res.render('admin/dashboard', empty);
  }
});

// ---------------------------------------------------------
// Employees - List (with search + pagination)
// ---------------------------------------------------------
const LIST_SORTS = {
  newest: 'e.created_at DESC', name_asc: 'e.full_name ASC', name_desc: 'e.full_name DESC',
  hire_new: 'e.hire_date DESC', hire_old: 'e.hire_date ASC',
};
function buildEmployeeFilter(query) {
  const search = (query.q || '').trim();
  const department = query.department || '';
  const status = ['active', 'on_leave', 'inactive'].includes(query.status) ? query.status : '';
  const where = []; const params = [];
  if (search) {
    where.push('(e.full_name LIKE ? OR e.email LIKE ? OR e.job_title LIKE ? OR e.skills LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (department) { where.push('e.department_id = ?'); params.push(department); }
  if (status) { where.push('e.status = ?'); params.push(status); }
  return { search, department, status, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/employees', async (req, res) => {
  const f = buildEmployeeFilter(req.query);
  const sort = LIST_SORTS[req.query.sort] ? req.query.sort : 'newest';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = 10;

  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM employees e ${f.whereSql}`, f.params);
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const [employees] = await pool.query(
      `SELECT e.*, d.name AS department_name, d.color AS department_color
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       ${f.whereSql} ORDER BY ${LIST_SORTS[sort]} LIMIT ? OFFSET ?`,
      [...f.params, pageSize, offset]
    );
    const [departments] = await pool.query('SELECT id, name FROM departments ORDER BY name');
    const qs = new URLSearchParams({ q: f.search, department: f.department, status: f.status, sort }).toString();

    res.render('admin/employees', {
      title: 'Manage Employees', employees, departments, search: f.search, department: f.department,
      status: f.status, sort, qs, safePage, totalPages, total,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load employees.');
    res.redirect('/admin/dashboard');
  }
});

// Export the (filtered) list as CSV
router.get('/employees/export', async (req, res) => {
  try {
    const f = buildEmployeeFilter(req.query);
    const [rows] = await pool.query(
      `SELECT e.full_name, e.email, e.phone, e.job_title, d.name AS department_name, e.location, e.status,
              e.employee_code, e.hire_date, e.skills
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id ${f.whereSql} ORDER BY e.full_name`, f.params);
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      let str = String(v);
      if (/^[=+\-@]/.test(str)) str = "'" + str; // neutralise spreadsheet formula injection
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = ['Full Name', 'Email', 'Phone', 'Job Title', 'Department', 'Location', 'Status', 'Employee Code', 'Hire Date', 'Skills'];
    const lines = [header.join(',')].concat(rows.map((r) => [r.full_name, r.email, r.phone, r.job_title, r.department_name, r.location, r.status, r.employee_code, r.hire_date, r.skills].map(esc).join(',')));
    await logActivity(req, 'export', 'employee', null, `Exported ${rows.length} employees to CSV`);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="employees.csv"' });
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not export.');
    res.redirect('/admin/employees');
  }
});

// Bulk actions on selected rows
router.post('/employees/bulk', async (req, res) => {
  let ids = req.body.ids || [];
  if (!Array.isArray(ids)) ids = [ids];
  ids = ids.map((n) => parseInt(n, 10)).filter(Boolean).slice(0, 200);
  const action = String(req.body.action || '');
  if (!ids.length) { req.flash('error', 'Select at least one employee.'); return res.redirect('back'); }
  try {
    let msg;
    if (['active', 'on_leave', 'inactive'].includes(action)) {
      await pool.query('UPDATE employees SET status = ? WHERE id IN (?)', [action, ids]);
      msg = `Set ${ids.length} employee(s) to ${action.replace('_', ' ')}.`;
    } else if (action.startsWith('dept:')) {
      const did = parseInt(action.slice(5), 10) || null;
      await pool.query('UPDATE employees SET department_id = ? WHERE id IN (?)', [did, ids]);
      msg = `Moved ${ids.length} employee(s) to the selected department.`;
    } else if (action === 'feature' || action === 'unfeature') {
      await pool.query('UPDATE employees SET is_featured = ? WHERE id IN (?)', [action === 'feature' ? 1 : 0, ids]);
      msg = `Updated spotlight for ${ids.length} employee(s).`;
    } else if (action === 'delete') {
      await pool.query('DELETE FROM employees WHERE id IN (?)', [ids]);
      msg = `Deleted ${ids.length} employee(s).`;
    } else { req.flash('error', 'Choose a bulk action.'); return res.redirect('back'); }
    await logActivity(req, action === 'delete' ? 'delete' : 'update', 'employee', null, `Bulk: ${msg}`);
    req.flash('success', msg);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Bulk action failed.');
  }
  res.redirect('back');
});

// ---------------------------------------------------------
// Employees - Bulk import from CSV
// Columns: full name, email, phone, job title, department, location, status, employee code, hire date, skills
// ---------------------------------------------------------
router.post('/employees/import', (req, res, next) => {
  csvUpload.single('csv_file')(req, res, (err) => {
    if (err) { req.flash('error', err.message); return res.redirect('/admin/employees'); }
    next();
  });
}, async (req, res) => {
  if (!req.file) { req.flash('error', 'Choose a .csv file to import.'); return res.redirect('/admin/employees'); }
  try {
    const rows = parseCSV(req.file.buffer.toString('utf8')).slice(0, 1000);
    const [depts] = await pool.query('SELECT id, name FROM departments');
    const deptMap = new Map(depts.map((d) => [d.name.toLowerCase(), d.id]));
    const statuses = ['active', 'on_leave', 'inactive'];
    const pick = (r, ...keys) => { for (const k of keys) if (r[k]) return r[k]; return ''; };
    let imported = 0, skipped = 0;
    for (const r of rows) {
      const name = pick(r, 'full name', 'full_name', 'name');
      const email = pick(r, 'email');
      if (!name || !email) { skipped++; continue; }
      let status = pick(r, 'status').toLowerCase().replace(' ', '_');
      if (!statuses.includes(status)) status = 'active';
      const hire = pick(r, 'hire date', 'hire_date');
      const [result] = await pool.query(
        `INSERT IGNORE INTO employees
          (full_name, email, phone, job_title, department_id, location, status, employee_code, hire_date, skills)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, email, pick(r, 'phone') || null, pick(r, 'job title', 'job_title') || null,
          deptMap.get(pick(r, 'department').toLowerCase()) || null, pick(r, 'location') || null, status,
          pick(r, 'employee code', 'employee_code') || null, /^\d{4}-\d{2}-\d{2}$/.test(hire) ? hire : null,
          pick(r, 'skills') || null]
      );
      if (result.affectedRows) imported++; else skipped++;
    }
    await logActivity(req, 'create', 'employee', null, `CSV import: ${imported} added, ${skipped} skipped`);
    req.flash('success', `Imported ${imported} employees. ${skipped} row(s) skipped.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not import that CSV.');
  }
  res.redirect('/admin/employees');
});

// ---------------------------------------------------------
// Employees - New (form)
// ---------------------------------------------------------
router.get('/employees/new', async (req, res) => {
  const [departments] = await pool.query('SELECT * FROM departments ORDER BY name ASC');
  res.render('admin/form', {
    title: 'Add Employee', departments, employee: {}, formAction: '/admin/employees', method: 'POST',
  });
});

// ---------------------------------------------------------
// Employees - Create
// ---------------------------------------------------------
router.post('/employees', upload.single('avatar_file'), async (req, res) => {
  const {
    full_name, email, phone, job_title, department_id, bio, location,
    employee_code, status, hire_date, skills, linkedin_url, github_url,
    twitter_url, is_featured, avatar_url_manual,
  } = req.body;

  try {
    const avatarUrl = req.file
      ? `/uploads/${req.file.filename}`
      : (avatar_url_manual || null);

    const [result] = await pool.query(
      `INSERT INTO employees
        (full_name, email, phone, job_title, department_id, avatar_url, bio, location,
         employee_code, status, hire_date, skills, linkedin_url, github_url, twitter_url, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [full_name, email, phone || null, job_title || null, department_id || null, avatarUrl,
        bio || null, location || null, employee_code || null, status || 'active',
        hire_date || null, skills || null, linkedin_url || null, github_url || null,
        twitter_url || null, is_featured ? 1 : 0]
    );

    await logActivity(req, 'create', 'employee', result.insertId, `Created ${full_name}`);
    req.flash('success', `${full_name} was added successfully.`);
    res.redirect('/admin/employees');
  } catch (err) {
    console.error(err);
    req.flash('error', err.code === 'ER_DUP_ENTRY' ? 'An employee with that email or code already exists.' : 'Could not create employee.');
    res.redirect('/admin/employees/new');
  }
});

// ---------------------------------------------------------
// Employees - Edit (form)
// ---------------------------------------------------------
router.get('/employees/:id/edit', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/admin/employees');
    }
    const [departments] = await pool.query('SELECT * FROM departments ORDER BY name ASC');
    res.render('admin/form', {
      title: 'Edit Employee', departments, employee: rows[0],
      formAction: `/admin/employees/${req.params.id}?_method=PUT`, method: 'POST',
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load employee.');
    res.redirect('/admin/employees');
  }
});

// ---------------------------------------------------------
// Employees - Update
// ---------------------------------------------------------
router.put('/employees/:id', upload.single('avatar_file'), async (req, res) => {
  const {
    full_name, email, phone, job_title, department_id, bio, location,
    employee_code, status, hire_date, skills, linkedin_url, github_url,
    twitter_url, is_featured, avatar_url_manual,
  } = req.body;

  try {
    let avatarClause = '';
    const params = [
      full_name, email, phone || null, job_title || null, department_id || null,
      bio || null, location || null, employee_code || null, status || 'active',
      hire_date || null, skills || null, linkedin_url || null, github_url || null,
      twitter_url || null, is_featured ? 1 : 0,
    ];

    let avatarUrl = avatar_url_manual || null;
    if (req.file) avatarUrl = `/uploads/${req.file.filename}`;

    await pool.query(
      `UPDATE employees SET
        full_name=?, email=?, phone=?, job_title=?, department_id=?, bio=?, location=?,
        employee_code=?, status=?, hire_date=?, skills=?, linkedin_url=?, github_url=?,
        twitter_url=?, is_featured=?, avatar_url = COALESCE(?, avatar_url)
       WHERE id=?`,
      [...params, avatarUrl, req.params.id]
    );

    await logActivity(req, 'update', 'employee', req.params.id, `Updated ${full_name}`);
    req.flash('success', `${full_name} was updated successfully.`);
    res.redirect('/admin/employees');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update employee.');
    res.redirect(`/admin/employees/${req.params.id}/edit`);
  }
});

// ---------------------------------------------------------
// Employees - Delete
// ---------------------------------------------------------
router.delete('/employees/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT full_name FROM employees WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
    await logActivity(req, 'delete', 'employee', req.params.id, `Deleted ${rows[0]?.full_name || 'employee'}`);
    req.flash('success', 'Employee deleted.');
    res.redirect('/admin/employees');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not delete employee.');
    res.redirect('/admin/employees');
  }
});

// ---------------------------------------------------------
// Departments - manage (list + create + delete)
// ---------------------------------------------------------
router.get('/departments', async (req, res) => {
  const [departments] = await pool.query(
    `SELECT d.*, COUNT(e.id) AS employee_count
     FROM departments d LEFT JOIN employees e ON e.department_id = d.id
     GROUP BY d.id ORDER BY d.name ASC`
  );
  res.render('admin/departments', { title: 'Manage Departments', departments });
});

router.post('/departments', async (req, res) => {
  const { name, color } = req.body;
  try {
    await pool.query('INSERT INTO departments (name, color) VALUES (?, ?)', [name, color || '#6366f1']);
    await logActivity(req, 'create', 'department', null, `Created department ${name}`);
    req.flash('success', `Department "${name}" created.`);
  } catch (err) {
    req.flash('error', err.code === 'ER_DUP_ENTRY' ? 'That department already exists.' : 'Could not create department.');
  }
  res.redirect('/admin/departments');
});

router.delete('/departments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
    await logActivity(req, 'delete', 'department', req.params.id, 'Deleted department');
    req.flash('success', 'Department deleted.');
  } catch (err) {
    req.flash('error', 'Could not delete department.');
  }
  res.redirect('/admin/departments');
});

// ---------------------------------------------------------
// Admin profile / change password
// ---------------------------------------------------------
router.get('/profile', (req, res) => {
  res.render('admin/profile', { title: 'My Profile' });
});

router.post('/profile/password', async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE id = ?', [req.session.admin.id]);
    const admin = rows[0];
    const match = await bcrypt.compare(current_password, admin.password_hash);
    if (!match) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/admin/profile');
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/admin/profile');
    }
    if (new_password.length < 8) {
      req.flash('error', 'New password must be at least 8 characters.');
      return res.redirect('/admin/profile');
    }
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, admin.id]);
    await logActivity(req, 'update', 'admin', admin.id, 'Changed password');
    req.flash('success', 'Password updated successfully.');
    res.redirect('/admin/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update password.');
    res.redirect('/admin/profile');
  }
});

// ---------------------------------------------------------
// Activity log (full view)
// ---------------------------------------------------------
router.get('/activity', async (req, res) => {
  const action = ['create', 'update', 'delete', 'export'].includes(req.query.action) ? req.query.action : '';
  const [activity] = await pool.query(
    `SELECT a.*, ad.name AS admin_name FROM activity_log a
     LEFT JOIN admins ad ON ad.id = a.admin_id
     ${action ? 'WHERE a.action = ?' : ''}
     ORDER BY a.created_at DESC LIMIT 200`, action ? [action] : []
  );
  res.render('admin/activity', { title: 'Activity Log', activity, action });
});

// ---------------------------------------------------------
// Announcements (shown on the public home page)
// ---------------------------------------------------------
router.get('/announcements', async (req, res) => {
  const [items] = await pool.query('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC');
  res.render('admin/announcements', { title: 'Announcements', items });
});
router.post('/announcements', async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 200);
  const body = String(req.body.body || '').trim().slice(0, 2000);
  const category = ['news', 'event', 'policy', 'milestone'].includes(req.body.category) ? req.body.category : 'news';
  if (!title) { req.flash('error', 'A title is required.'); return res.redirect('/admin/announcements'); }
  await pool.query('INSERT INTO announcements (title, body, category, pinned, created_by) VALUES (?, ?, ?, ?, ?)',
    [title, body, category, req.body.pinned ? 1 : 0, req.session.admin.id]);
  await logActivity(req, 'create', 'announcement', null, `Posted "${title}"`);
  req.flash('success', 'Announcement published.');
  res.redirect('/admin/announcements');
});
router.post('/announcements/:id/pin', async (req, res) => {
  await pool.query('UPDATE announcements SET pinned = 1 - pinned WHERE id = ?', [req.params.id]);
  res.redirect('/admin/announcements');
});
router.delete('/announcements/:id', async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  await logActivity(req, 'delete', 'announcement', req.params.id, 'Deleted announcement');
  req.flash('success', 'Announcement deleted.');
  res.redirect('/admin/announcements');
});

// ---------------------------------------------------------
// Settings / system status
// ---------------------------------------------------------
router.get('/settings', async (req, res) => {
  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM employees) AS employees, (SELECT COUNT(*) FROM departments) AS departments,
            (SELECT COUNT(*) FROM announcements) AS announcements, (SELECT COUNT(*) FROM admins) AS admins,
            (SELECT COUNT(*) FROM activity_log) AS activity`);
  res.render('admin/settings', {
    title: 'Settings', counts, node: process.version, env: process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime() / 60), model: gemini.MODEL, gemini: gemini.isConfigured(),
  });
});
router.post('/settings/test-ai', async (req, res) => {
  if (!gemini.isConfigured()) return res.json({ success: false, message: 'GEMINI_API_KEY is not set on the server.' });
  try {
    const t0 = Date.now();
    await gemini.generate({ prompt: 'Reply with the single word: ok', maxTokens: 16, temperature: 0 });
    res.json({ success: true, message: `Gemini responded in ${Date.now() - t0} ms.` });
  } catch (err) {
    res.json({ success: false, message: `Gemini check failed (${err.code || 'error'}). Verify the key, model and endpoint.` });
  }
});

module.exports = router;
