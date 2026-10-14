/* Command palette (Ctrl/Cmd+K or "/"): jump to pages, departments and people. Safe DOM building only. */
(function () {
  'use strict';
  var PAGES = [
    ['Home', '/', 'Landing page'], ['Directory', '/directory', 'Search every employee'],
    ['Departments', '/departments', 'Headcount by team'], ['Skills explorer', '/skills', 'Who knows what'],
    ['Team insights', '/insights', 'Analytics'], ['AI Assistant', '/ai', 'Ask, build teams, compare, draft'],
    ['Admin panel', '/admin/dashboard', 'Manage the directory']
  ];
  var overlay = document.createElement('div'); overlay.className = 'pal-overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="pal" role="dialog" aria-modal="true" aria-label="Search"><input class="pal-input" type="text" placeholder="Search people, departments, pages..." autocomplete="off" data-cursor="text"><div class="pal-list" role="listbox"></div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
  document.body.appendChild(overlay);
  var input = overlay.querySelector('.pal-input'), list = overlay.querySelector('.pal-list');
  var items = [], idx = 0, timer = null, seq = 0;

  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function render() {
    list.textContent = '';
    if (!items.length) { list.appendChild(el('div', 'pal-empty', 'No results')); return; }
    var last = '';
    items.forEach(function (it, i) {
      if (it.group !== last) { list.appendChild(el('div', 'pal-group', it.group)); last = it.group; }
      var a = el('a', 'pal-item' + (i === idx ? ' active' : '')); a.href = it.href; a.setAttribute('role', 'option');
      if (it.img) { var im = el('img'); im.src = it.img; im.alt = ''; a.appendChild(im); }
      var t = el('span', 'pal-text'); t.appendChild(el('strong', null, it.title)); if (it.sub) t.appendChild(el('small', null, it.sub));
      a.appendChild(t);
      a.addEventListener('mousemove', function () { idx = i; mark(); });
      list.appendChild(a);
    });
  }
  function mark() {
    var els = list.querySelectorAll('.pal-item');
    els.forEach(function (n, i) { n.classList.toggle('active', i === idx); });
    if (els[idx]) els[idx].scrollIntoView({ block: 'nearest' });
  }
  function pages(q) {
    q = q.toLowerCase();
    return PAGES.filter(function (p) { return !q || p[0].toLowerCase().indexOf(q) > -1 || p[2].toLowerCase().indexOf(q) > -1; })
      .map(function (p) { return { group: 'Pages', title: p[0], sub: p[2], href: p[1] }; });
  }
  function search() {
    var q = input.value.trim(), my = ++seq;
    items = pages(q); idx = 0; render();
    if (!q) return;
    fetch('/api/search?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
      if (my !== seq) return;
      var extra = [];
      (j.employees || []).forEach(function (e) { extra.push({ group: 'People', title: e.full_name, sub: e.job_title || '', href: '/employee/' + e.id, img: e.avatar_url || '/avatar/' + e.id + '.svg?f=1' }); });
      (j.departments || []).forEach(function (d) { extra.push({ group: 'Departments', title: d.name, sub: 'Browse team', href: '/directory?department=' + d.id }); });
      items = extra.concat(items); idx = 0; render();
    }).catch(function () {});
  }
  function open() { overlay.hidden = false; document.body.classList.add('pal-open'); input.value = ''; search(); setTimeout(function () { input.focus(); }, 10); }
  function close() { overlay.hidden = true; document.body.classList.remove('pal-open'); }

  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(search, 120); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); mark(); }
    else if (e.key === 'Enter' && items[idx]) { window.location.href = items[idx].href; }
  });
  overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay.hidden ? open() : close(); }
    else if (e.key === 'Escape' && !overlay.hidden) close();
    else if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && overlay.hidden && !document.getElementById('searchInput')) { e.preventDefault(); open(); }
  });
  var btn = document.getElementById('paletteBtn');
  if (btn) btn.addEventListener('click', open);
})();
