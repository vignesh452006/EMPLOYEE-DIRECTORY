const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

const PAGE_SIZE = 9;

const skillList = (str) => String(str || '').split(',').map((x) => x.trim()).filter(Boolean);

// Home page extras: upcoming work anniversaries, new joiners, who's out, announcements, top skills
async function fetchHomeExtras() {
  const [all] = await pool.query(
    `SELECT e.id, e.full_name, e.job_title, e.avatar_url, e.hire_date, e.status, e.skills, e.location, d.name AS department_name
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const anniversaries = all.filter((e) => e.hire_date && e.status !== 'inactive').map((e) => {
    const h = new Date(e.hire_date + 'T00:00:00');
    let next = new Date(today.getFullYear(), h.getMonth(), h.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, h.getMonth(), h.getDate());
    return { ...e, years: next.getFullYear() - h.getFullYear(), days: Math.round((next - today) / 86400000), when: next };
  }).filter((e) => e.years >= 1).sort((a, b) => a.days - b.days).slice(0, 5);
  const newJoiners = all.filter((e) => e.hire_date && (today - new Date(e.hire_date + 'T00:00:00')) / 86400000 <= 120 && e.status !== 'inactive')
    .sort((a, b) => (a.hire_date < b.hire_date ? 1 : -1)).slice(0, 5);
  const onLeave = all.filter((e) => e.status === 'on_leave').slice(0, 6);
  const skillMap = {};
  all.forEach((e) => skillList(e.skills).forEach((s) => { const k = s.toLowerCase(); skillMap[k] = skillMap[k] || { name: s, count: 0 }; skillMap[k].count++; }));
  const topSkills = Object.values(skillMap).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 14);
  let announcements = [];
  try {
    [announcements] = await pool.query('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 4');
  } catch (e) { /* table may not exist yet */ }
  return { anniversaries, newJoiners, onLeave, topSkills, announcements };
}

async function fetchDirectoryData(query) {
  const search = (query.q || '').trim();
  const department = query.department || '';
  const status = query.status || '';
  const sort = query.sort || 'name_asc';
  const page = Math.max(parseInt(query.page, 10) || 1, 1);

  const where = [];
  const params = [];

  if (search) {
    where.push('(e.full_name LIKE ? OR e.job_title LIKE ? OR e.skills LIKE ? OR e.email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (department) {
    where.push('e.department_id = ?');
    params.push(department);
  }
  if (status) {
    where.push('e.status = ?');
    params.push(status);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sortMap = {
    name_asc: 'e.full_name ASC',
    name_desc: 'e.full_name DESC',
    newest: 'e.hire_date DESC',
    oldest: 'e.hire_date ASC',
  };
  const orderBy = sortMap[sort] || sortMap.name_asc;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM employees e ${whereClause}`,
    params
  );
  const total = countRows[0].total;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const [employees] = await pool.query(
    `SELECT e.*, d.name AS department_name, d.color AS department_color
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     ${whereClause}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  const [departments] = await pool.query('SELECT * FROM departments ORDER BY name ASC');

  return { employees, departments, total, totalPages, safePage, search, department, status, sort };
}

async function fetchInsightsData() {
  const [[{ totalActive }]] = await pool.query(
    "SELECT COUNT(*) AS totalActive FROM employees WHERE status = 'active'"
  );
  const [[{ deptCount }]] = await pool.query('SELECT COUNT(*) AS deptCount FROM departments');
  const [[{ locationCount }]] = await pool.query(
    "SELECT COUNT(DISTINCT location) AS locationCount FROM employees WHERE location IS NOT NULL AND location != ''"
  );
  const [[{ avgTenure }]] = await pool.query(
    `SELECT ROUND(AVG(DATEDIFF(CURDATE(), hire_date) / 365), 1) AS avgTenure
     FROM employees WHERE hire_date IS NOT NULL`
  );
  const [featured] = await pool.query(
    `SELECT e.*, d.name AS department_name, d.color AS department_color
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.is_featured = 1 ORDER BY e.created_at DESC LIMIT 8`
  );
  const [deptCounts] = await pool.query(
    `SELECT d.id, d.name, d.color, COUNT(e.id) AS count
     FROM departments d LEFT JOIN employees e ON e.department_id = d.id
     GROUP BY d.id ORDER BY count DESC`
  );
  const [statusCounts] = await pool.query(
    `SELECT status, COUNT(*) AS count FROM employees GROUP BY status`
  );
  const [locationCounts] = await pool.query(
    `SELECT location, COUNT(*) AS count FROM employees
     WHERE location IS NOT NULL AND location != '' GROUP BY location ORDER BY count DESC LIMIT 8`
  );
  return {
    heroStats: {
      total: totalActive,
      departments: deptCount,
      locations: locationCount,
      avgTenure: avgTenure || 0,
    },
    featured,
    deptCounts,
    statusCounts,
    locationCounts,
  };
}

// ---------------------------------------------------------
// HOME — landing page: hero, live stats, spotlight carousel
// ---------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const extras = await fetchInsightsData();
    const home = await fetchHomeExtras();
    res.render('home', { title: 'Employee Directory', ...extras, ...home });
  } catch (err) {
    console.error(err);
    res.status(500).render('home', {
      title: 'Employee Directory',
      heroStats: { total: 0, departments: 0, locations: 0, avgTenure: 0 },
      featured: [], deptCounts: [], statusCounts: [], locationCounts: [],
      anniversaries: [], newJoiners: [], onLeave: [], topSkills: [], announcements: [],
      error: 'Could not load the homepage right now.',
    });
  }
});

// ---------------------------------------------------------
// DIRECTORY — searchable, filterable employee grid
// ---------------------------------------------------------
router.get('/directory', async (req, res) => {
  try {
    const data = await fetchDirectoryData(req.query);
    res.render('directory', {
      title: 'Directory',
      ...data,
      view: req.query.view === 'list' ? 'list' : 'grid',
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('directory', {
      title: 'Directory',
      employees: [], departments: [], total: 0, totalPages: 1, safePage: 1,
      search: '', department: '', status: '', sort: 'name_asc', view: 'grid',
      error: 'Could not load the directory right now.',
    });
  }
});

// ---------------------------------------------------------
// INSIGHTS — team analytics: headcount, status mix, locations
// ---------------------------------------------------------
router.get('/insights', async (req, res) => {
  try {
    const extras = await fetchInsightsData();
    res.render('insights', { title: 'Team Insights', ...extras });
  } catch (err) {
    console.error(err);
    res.status(500).render('insights', {
      title: 'Team Insights',
      heroStats: { total: 0, departments: 0, locations: 0, avgTenure: 0 },
      featured: [], deptCounts: [], statusCounts: [], locationCounts: [],
      error: 'Could not load insights right now.',
    });
  }
});

// ---------------------------------------------------------
// SKILLS — explorer of every skill in the company
// ---------------------------------------------------------
router.get('/skills', async (req, res) => {
  try {
    const [all] = await pool.query(
      `SELECT e.id, e.full_name, e.avatar_url, e.skills FROM employees e WHERE e.status != 'inactive' ORDER BY e.full_name`);
    const map = {};
    all.forEach((e) => skillList(e.skills).forEach((s) => {
      const k = s.toLowerCase(); map[k] = map[k] || { name: s, people: [] }; map[k].people.push(e);
    }));
    const skills = Object.values(map).sort((a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name));
    res.render('skills', { title: 'Skills', skills });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error' }); }
});

// ---------------------------------------------------------
// DEPARTMENTS — headcount, tenure and people per department
// ---------------------------------------------------------
router.get('/departments', async (req, res) => {
  try {
    const [depts] = await pool.query(
      `SELECT d.id, d.name, d.color, COUNT(e.id) AS total,
              SUM(e.status = 'active') AS active, SUM(e.status = 'on_leave') AS on_leave,
              ROUND(AVG(DATEDIFF(CURDATE(), e.hire_date) / 365), 1) AS avg_tenure,
              COUNT(DISTINCT e.location) AS locations
       FROM departments d LEFT JOIN employees e ON e.department_id = d.id
       GROUP BY d.id ORDER BY total DESC, d.name`);
    const [people] = await pool.query(
      `SELECT id, full_name, avatar_url, department_id, job_title, is_featured FROM employees
       WHERE department_id IS NOT NULL ORDER BY is_featured DESC, hire_date ASC`);
    const byDept = {};
    people.forEach((p) => { (byDept[p.department_id] = byDept[p.department_id] || []).push(p); });
    depts.forEach((d) => { d.members = (byDept[d.id] || []).slice(0, 6); d.lead = (byDept[d.id] || [])[0] || null; });
    res.render('departments', { title: 'Departments', depts });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error' }); }
});

// ---------------------------------------------------------
// AI ASSISTANT page — always available (offline smart mode without an API key)
// ---------------------------------------------------------
router.get('/ai', async (req, res) => {
  try {
    const [people] = await pool.query("SELECT id, full_name, job_title FROM employees WHERE status != 'inactive' ORDER BY full_name");
    res.render('ai', { title: 'AI Assistant', people });
  } catch (err) { console.error(err); res.status(500).render('404', { title: 'Error' }); }
});

// Command palette search (Ctrl+K)
router.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 1) return res.json({ employees: [], departments: [] });
  try {
    const like = `%${q}%`;
    const [employees] = await pool.query(
      `SELECT id, full_name, job_title, avatar_url FROM employees
       WHERE full_name LIKE ? OR job_title LIKE ? OR skills LIKE ? OR email LIKE ?
       ORDER BY (full_name LIKE ?) DESC, full_name LIMIT 6`, [like, like, like, like, `${q}%`]);
    const [departments] = await pool.query('SELECT id, name FROM departments WHERE name LIKE ? LIMIT 3', [like]);
    res.json({ employees, departments });
  } catch (err) { console.error(err); res.json({ employees: [], departments: [] }); }
});

// AJAX endpoint for smooth, no-reload live search/filtering
router.get('/api/employees', async (req, res) => {
  try {
    const data = await fetchDirectoryData(req.query);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch employees' });
  }
});

// Recently viewed: ids come from the visitor's localStorage; order is preserved
router.get('/api/employees/by-ids', async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((n) => parseInt(n, 10)).filter(Boolean).slice(0, 8);
    if (!ids.length) return res.json({ success: true, employees: [] });
    const [rows] = await pool.query(
      `SELECT e.id, e.full_name, e.job_title, e.avatar_url FROM employees e WHERE e.id IN (?)`, [ids]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    res.json({ success: true, employees: ids.map((i) => byId.get(i)).filter(Boolean) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, employees: [] });
  }
});

router.get('/employee/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, d.name AS department_name, d.color AS department_color
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.id = ?`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).render('404', { title: 'Not Found' });
    }
    const [related] = await pool.query(
      `SELECT e.* FROM employees e WHERE e.department_id = ? AND e.id != ? LIMIT 4`,
      [rows[0].department_id, req.params.id]
    );
    res.render('employee', { title: rows[0].full_name, employee: rows[0], related });
  } catch (err) {
    console.error(err);
    res.status(500).render('404', { title: 'Error' });
  }
});

// ---------------------------------------------------------
// vCard download (.vcf) — lets visitors save a contact card
// ---------------------------------------------------------
router.get('/employee/:id/vcard', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).send('Employee not found');
    const e = rows[0];

    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${e.full_name}`,
      `TITLE:${e.job_title || ''}`,
      `EMAIL:${e.email}`,
      e.phone ? `TEL:${e.phone}` : '',
      e.location ? `ADR:;;${e.location}` : '',
      'END:VCARD',
    ].filter(Boolean).join('\r\n');

    res.set('Content-Type', 'text/vcard');
    res.set('Content-Disposition', `attachment; filename="${e.full_name.replace(/\s+/g, '_')}.vcf"`);
    res.send(vcard);
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not generate vCard.');
  }
});

// ---------------------------------------------------------
// CSV export — exports the currently filtered employee list
// ---------------------------------------------------------
router.get('/export/csv', async (req, res) => {
  try {
    const search = (req.query.q || '').trim();
    const department = req.query.department || '';
    const status = req.query.status || '';
    const where = [];
    const params = [];
    if (search) {
      where.push('(e.full_name LIKE ? OR e.job_title LIKE ? OR e.skills LIKE ? OR e.email LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (department) { where.push('e.department_id = ?'); params.push(department); }
    if (status) { where.push('e.status = ?'); params.push(status); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT e.full_name, e.email, e.phone, e.job_title, d.name AS department_name,
              e.location, e.status, e.employee_code, e.hire_date
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       ${whereClause} ORDER BY e.full_name ASC`,
      params
    );

    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = ['Full Name', 'Email', 'Phone', 'Job Title', 'Department', 'Location', 'Status', 'Employee Code', 'Hire Date'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([
        r.full_name, r.email, r.phone, r.job_title, r.department_name,
        r.location, r.status, r.employee_code, r.hire_date,
      ].map(escape).join(','));
    });

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="employee-directory.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not export CSV.');
  }
});

module.exports = router;
