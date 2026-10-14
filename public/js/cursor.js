/* Animated cursor: precise dot + elastic ring + comet trail + magnetic buttons + click burst.
   Uses mix-blend-mode:difference so it reads on both white and black surfaces. Desktop pointers only. */
(function () {
  'use strict';
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var root = document.documentElement;
  root.classList.add('has-cursor');

  var dot = document.createElement('div'); dot.className = 'cx-dot';
  var ring = document.createElement('div'); ring.className = 'cx-ring';
  var label = document.createElement('span'); label.className = 'cx-label'; ring.appendChild(label);
  var canvas = document.createElement('canvas'); canvas.className = 'cx-trail';
  document.body.appendChild(canvas); document.body.appendChild(ring); document.body.appendChild(dot);
  var ctx = canvas.getContext('2d');

  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize(); window.addEventListener('resize', resize);

  var mx = -100, my = -100, rx = -100, ry = -100, vx = 0, vy = 0;
  var trail = [], bursts = [], visible = false, magnet = null;
  var INTERACTIVE = 'a, button, .btn, [role="button"], select, summary, label, .chip-btn, .ai-tab, .palette-btn';
  var TEXTY = 'input[type="text"], input[type="search"], input[type="email"], input[type="password"], input[type="url"], textarea, [data-cursor="text"]';

  document.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    if (!visible) { visible = true; rx = mx; ry = my; root.classList.add('cx-on'); }
    trail.push({ x: mx, y: my, t: performance.now() });
    if (trail.length > 26) trail.shift();
    var t = e.target.closest ? e.target : null;
    var txt = t && t.closest(TEXTY);
    var card = t && t.closest('[data-cursor-label], .employee-card, .spotlight-card, .skill-card, .dept-card, .recent-chip');
    var act = t && t.closest(INTERACTIVE);
    ring.classList.toggle('is-text', !!txt);
    ring.classList.toggle('is-card', !!card && !txt);
    ring.classList.toggle('is-link', !!act && !txt && !card);
    label.textContent = card && !txt ? (card.getAttribute('data-cursor-label') || 'View') : '';
    // magnetic pull on buttons
    var m = t && t.closest('.btn, .carousel-btn, .palette-btn, .ai-tab');
    if (magnet && magnet !== m) { magnet.style.transform = ''; }
    magnet = m || null;
    if (m) {
      var b = m.getBoundingClientRect();
      var dx = (mx - (b.left + b.width / 2)) * 0.18, dy = (my - (b.top + b.height / 2)) * 0.28;
      m.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }
  }, { passive: true });

  document.addEventListener('mouseleave', function () { visible = false; root.classList.remove('cx-on'); });
  document.addEventListener('mouseenter', function () { visible = true; root.classList.add('cx-on'); });
  document.addEventListener('mousedown', function () {
    ring.classList.add('is-down');
    for (var i = 0; i < 10; i++) {
      var a = (Math.PI * 2 * i) / 10 + Math.random() * 0.4, sp = 2 + Math.random() * 3.2;
      bursts.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
    }
  });
  document.addEventListener('mouseup', function () { ring.classList.remove('is-down'); });

  (function loop() {
    var px = rx, py = ry;
    rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
    vx = rx - px; vy = ry - py;
    var speed = Math.min(Math.sqrt(vx * vx + vy * vy), 40);
    var ang = Math.atan2(vy, vx);
    var stretch = 1 + speed / 70;
    dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0) translate(-50%,-50%)';
    ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0) translate(-50%,-50%) rotate(' + ang + 'rad) scale(' + stretch.toFixed(3) + ',' + (1 / stretch).toFixed(3) + ')';
    label.style.transform = 'rotate(' + (-ang) + 'rad) scale(' + (1 / stretch).toFixed(3) + ',' + stretch.toFixed(3) + ')';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var now = performance.now();
    trail = trail.filter(function (p) { return now - p.t < 380; });
    if (trail.length > 1) {
      for (var i = 1; i < trail.length; i++) {
        var k = i / trail.length;
        ctx.strokeStyle = 'rgba(255,255,255,' + (k * 0.7).toFixed(3) + ')';
        ctx.lineWidth = k * 4.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
      }
    }
    bursts = bursts.filter(function (b) { return b.life > 0.02; });
    bursts.forEach(function (b) {
      b.x += b.vx; b.y += b.vy; b.vx *= 0.93; b.vy *= 0.93; b.life *= 0.9;
      ctx.fillStyle = 'rgba(255,255,255,' + b.life.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(b.x, b.y, 2.4 * b.life + 0.6, 0, 7); ctx.fill();
    });
    requestAnimationFrame(loop);
  })();
})();
