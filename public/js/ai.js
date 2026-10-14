/* AI Assistant front-end. All dynamic text is inserted with textContent (never innerHTML). */
(function () {
  'use strict';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function avatarUrl(e) { return e.avatar_url && /^(https?:\/\/|\/uploads\/)/.test(e.avatar_url) ? e.avatar_url : '/avatar/' + encodeURIComponent(e.id) + '.svg?f=1'; }
  function person(e, extra) {
    var a = el('a', 'ai-person'); a.href = '/employee/' + encodeURIComponent(e.id); a.setAttribute('data-cursor-label', 'View');
    var img = el('img', 'ai-avatar'); img.src = avatarUrl(e); img.alt = ''; img.loading = 'lazy'; a.appendChild(img);
    var t = el('div', 'ai-person-text');
    t.appendChild(el('strong', null, e.full_name));
    t.appendChild(el('span', 'muted', [e.job_title, e.department_name].filter(Boolean).join(' · ')));
    if (e.role) t.appendChild(el('span', 'ai-role', e.role));
    var why = extra || e.reason; if (why) t.appendChild(el('em', 'ai-reason', why));
    a.appendChild(t); return a;
  }
  function call(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.success === false) throw new Error(j.message || 'Request failed');
        return j;
      });
    });
  }
  function post(url, body) { return call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  function loading(box, msg) { box.textContent = ''; box.appendChild(el('span', 'muted ai-loading', msg)); }
  function err(box, msg) { box.textContent = ''; box.appendChild(el('span', 'ai-error', msg)); }
  function typewrite(node, text, done) {
    var i = 0, step = Math.max(1, Math.ceil(text.length / 140));
    (function tick() { i = Math.min(text.length, i + step); node.textContent = text.slice(0, i); if (i < text.length) setTimeout(tick, 14); else if (done) done(); })();
  }
  function peopleList(arr) { var l = el('div', 'ai-people'); arr.forEach(function (e) { l.appendChild(person(e)); }); return l; }

  /* ---------- tabs ---------- */
  var tabs = document.querySelectorAll('.ai-tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.ai-pane').forEach(function (p) { p.classList.toggle('active', p.dataset.pane === t.dataset.tab); });
    });
  });

  /* ---------- chat ---------- */
  var chatForm = document.getElementById('chatForm');
  if (chatForm) {
    var thread = document.getElementById('chatThread'), input = document.getElementById('chatInput');
    function ask(q) {
      if (!q || q.length < 2) return;
      var ub = el('div', 'bubble user', q); thread.appendChild(ub);
      var bb = el('div', 'bubble bot'); bb.appendChild(el('span', 'typing', '')); for (var i = 0; i < 3; i++) bb.firstChild.appendChild(el('i'));
      thread.appendChild(bb); thread.scrollTop = thread.scrollHeight;
      post('/api/ai/ask', { question: q }).then(function (j) {
        bb.textContent = '';
        var p = el('p', 'ai-answer'); bb.appendChild(p);
        typewrite(p, j.answer || 'No answer.', function () {
          if (j.employees && j.employees.length) bb.appendChild(peopleList(j.employees));
          thread.scrollTop = thread.scrollHeight;
        });
      }).catch(function (e) { bb.textContent = ''; bb.appendChild(el('span', 'ai-error', e.message)); });
    }
    chatForm.addEventListener('submit', function (ev) { ev.preventDefault(); var q = input.value.trim(); input.value = ''; ask(q); });
    document.querySelectorAll('#chatChips .chip-btn').forEach(function (b) { b.addEventListener('click', function () { ask(b.dataset.q); }); });
    var pre = new URLSearchParams(location.search).get('q'); if (pre) ask(pre.slice(0, 300));
  }

  /* ---------- team builder ---------- */
  var teamGo = document.getElementById('teamGo');
  if (teamGo) teamGo.addEventListener('click', function () {
    var out = document.getElementById('teamOut'), brief = document.getElementById('teamBrief').value.trim();
    loading(out, 'Assembling a team...');
    post('/api/ai/team', { brief: brief }).then(function (j) {
      out.textContent = '';
      out.appendChild(el('p', 'ai-answer', j.summary || ''));
      if (j.members && j.members.length) out.appendChild(peopleList(j.members));
    }).catch(function (e) { err(out, e.message); });
  });

  /* ---------- compare ---------- */
  var cmpGo = document.getElementById('cmpGo');
  if (cmpGo) cmpGo.addEventListener('click', function () {
    var out = document.getElementById('cmpOut');
    var ids = Array.prototype.map.call(document.querySelectorAll('.cmp-select'), function (s) { return s.value; }).filter(Boolean);
    loading(out, 'Comparing...');
    post('/api/ai/compare', { ids: ids }).then(function (j) {
      out.textContent = '';
      var grid = el('div', 'cmp-grid'); grid.style.gridTemplateColumns = 'repeat(' + j.people.length + ', minmax(0,1fr))';
      j.people.forEach(function (p) {
        var c = el('div', 'cmp-col'); c.appendChild(person(p));
        var meta = el('ul', 'cmp-meta');
        [['Tenure', p.tenure + ' yrs'], ['Location', p.location || '—'], ['Status', (p.status || '').replace('_', ' ')]].forEach(function (r) {
          var li = el('li'); li.appendChild(el('span', 'muted', r[0])); li.appendChild(el('b', null, r[1])); meta.appendChild(li);
        });
        c.appendChild(meta);
        c.appendChild(el('h4', null, 'Unique skills'));
        var tags = el('div', 'tag-row'); (p.unique.length ? p.unique : ['None']).forEach(function (s) { tags.appendChild(el('span', 'tag', s)); }); c.appendChild(tags);
        grid.appendChild(c);
      });
      out.appendChild(grid);
      if (j.shared && j.shared.length) { var sh = el('div', 'cmp-shared'); sh.appendChild(el('strong', null, 'Shared by all: ')); sh.appendChild(el('span', null, j.shared.join(', '))); out.appendChild(sh); }
      out.appendChild(el('p', 'ai-answer', j.verdict || ''));
    }).catch(function (e) { err(out, e.message); });
  });

  /* ---------- draft ---------- */
  var drGo = document.getElementById('drGo');
  if (drGo) drGo.addEventListener('click', function () {
    var out = document.getElementById('drOut');
    loading(out, 'Drafting...');
    post('/api/ai/draft', { id: document.getElementById('drPerson').value, purpose: document.getElementById('drPurpose').value, note: document.getElementById('drNote').value }).then(function (j) {
      out.textContent = '';
      var subj = el('input'); subj.type = 'text'; subj.value = j.subject || ''; subj.className = 'draft-subject';
      var body = el('textarea', 'draft-body'); body.rows = 9; body.value = j.body || '';
      var row = el('div', 'draft-actions');
      var copy = el('button', 'btn btn-ghost', 'Copy'); copy.type = 'button';
      copy.addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(subj.value + '\n\n' + body.value); copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1500); });
      var mail = el('a', 'btn btn-primary', 'Open in email'); mail.href = '#';
      mail.addEventListener('click', function () { mail.href = 'mailto:?subject=' + encodeURIComponent(subj.value) + '&body=' + encodeURIComponent(body.value); });
      row.appendChild(copy); row.appendChild(mail);
      out.appendChild(subj); out.appendChild(body); out.appendChild(row);
    }).catch(function (e) { err(out, e.message); });
  });

  /* ---------- directory mini panel ---------- */
  var askForm = document.getElementById('aiAskForm');
  if (askForm) {
    var aIn = document.getElementById('aiAskInput'), aOut = document.getElementById('aiAskResult');
    askForm.addEventListener('submit', function (ev) {
      ev.preventDefault(); var q = aIn.value.trim(); if (q.length < 2) return;
      loading(aOut, 'Thinking...');
      post('/api/ai/ask', { question: q }).then(function (j) {
        aOut.textContent = ''; aOut.appendChild(el('p', 'ai-answer', j.answer || ''));
        if (j.employees && j.employees.length) aOut.appendChild(peopleList(j.employees));
      }).catch(function (e) { err(aOut, e.message); });
    });
  }

  /* ---------- profile: similar teammates ---------- */
  var sim = document.getElementById('aiSimilar');
  if (sim) {
    var sOut = document.getElementById('aiSimilarResult');
    call('/api/ai/similar/' + encodeURIComponent(sim.dataset.id)).then(function (j) {
      sOut.textContent = '';
      if (!j.matches.length) { sOut.appendChild(el('span', 'muted', 'No suggestions found.')); return; }
      sOut.appendChild(peopleList(j.matches));
    }).catch(function (e) { err(sOut, e.message); });
  }

  /* ---------- insights summary ---------- */
  var ins = document.getElementById('aiInsightsResult');
  if (ins) call('/api/ai/insights').then(function (j) {
    ins.textContent = ''; ins.appendChild(el('h3', 'ai-headline', j.summary.headline));
    var ul = el('ul', 'ai-points'); j.summary.points.forEach(function (p) { ul.appendChild(el('li', null, p)); }); ins.appendChild(ul);
  }).catch(function (e) { err(ins, e.message); });

  /* ---------- home teaser ---------- */
  var tz = document.getElementById('aiTeaserForm');
  if (tz) tz.addEventListener('submit', function (ev) {
    ev.preventDefault(); var q = document.getElementById('aiTeaserInput').value.trim();
    window.location.href = '/ai' + (q ? '?q=' + encodeURIComponent(q) : '');
  });

  /* ---------- admin: generate bio + skills ---------- */
  var bioBtn = document.getElementById('aiBioBtn');
  if (bioBtn) {
    var msg = document.getElementById('aiBioMsg');
    bioBtn.addEventListener('click', function () {
      var f = bioBtn.closest('form'), dept = f.elements.department_id;
      bioBtn.disabled = true; msg.textContent = 'Generating...';
      post('/admin/ai/bio', {
        full_name: f.elements.full_name.value, job_title: f.elements.job_title.value,
        department: dept && dept.selectedIndex > 0 ? dept.options[dept.selectedIndex].text : '', skills: f.elements.skills.value
      }).then(function (j) {
        f.elements.bio.value = j.bio;
        if (!f.elements.skills.value.trim() && j.skills.length) f.elements.skills.value = j.skills.join(', ');
        msg.textContent = 'Done. Review and edit before saving.';
      }).catch(function (e) { msg.textContent = e.message; }).then(function () { bioBtn.disabled = false; });
    });
  }
})();
