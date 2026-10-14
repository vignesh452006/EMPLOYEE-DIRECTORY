(function () {
  'use strict';

  /* Sidebar toggle for mobile */
  const sidebar = document.getElementById('adminSidebar');
  const toggle = document.getElementById('sidebarToggle');
  if (sidebar && toggle) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 780 && sidebar.classList.contains('open')
          && !sidebar.contains(e.target) && e.target !== toggle) {
        sidebar.classList.remove('open');
      }
    });
  }

  /* Confirm before destructive form submissions (delete buttons) */
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      const message = form.getAttribute('data-confirm') || 'Are you sure?';
      if (!window.confirm(message)) {
        e.preventDefault();
      }
    });
  });

  /* Animate stat bar widths in on dashboard load */
  window.addEventListener('load', () => {
    document.querySelectorAll('.bar-fill').forEach((bar) => {
      const targetWidth = bar.style.width;
      bar.style.width = '0%';
      requestAnimationFrame(() => {
        setTimeout(() => { bar.style.width = targetWidth; }, 60);
      });
    });
  });

  /* Bulk selection */
  var all = document.getElementById('selectAll');
  var checks = document.querySelectorAll('.row-check');
  var bar = document.getElementById('bulkBar');
  function syncBulk() {
    var n = document.querySelectorAll('.row-check:checked').length;
    if (bar) { bar.hidden = n === 0; document.getElementById('bulkCount').textContent = n; }
    if (all) all.checked = n > 0 && n === checks.length;
  }
  if (all) all.addEventListener('change', function () { checks.forEach(function (c) { c.checked = all.checked; }); syncBulk(); });
  checks.forEach(function (c) { c.addEventListener('change', syncBulk); });
  var bulk = document.getElementById('bulkForm');
  if (bulk) bulk.addEventListener('submit', function (e) {
    var act = document.getElementById('bulkAction');
    if (e.submitter && e.submitter.hasAttribute('data-confirm-btn')) {
      if (!window.confirm(e.submitter.getAttribute('data-confirm-btn'))) { e.preventDefault(); document.querySelectorAll('.row-check').forEach(function (c) { c.disabled = false; }); }
      return;
    }
    if (!act.value) { e.preventDefault(); alert('Choose a bulk action.'); return; }
    if (act.value === 'delete' && !window.confirm('Delete the selected employees? This cannot be undone.')) e.preventDefault();
  });
})();
