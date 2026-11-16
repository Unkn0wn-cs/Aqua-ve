/* ==========================================================================
   AQUA — site behaviour
   Vanilla, no dependencies, no build step. Everything here is progressive
   enhancement: the page is fully readable and the form fully submittable
   with this file blocked.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- CONFIGURATION -----------------------------------------------------
     Formspree endpoint for the consultation form. The same value is set on the
     <form action="..."> in index.html so submission still works when
     JavaScript is unavailable — change both together.
     ---------------------------------------------------------------------- */
  var FORM_ENDPOINT = 'https://formspree.io/f/mnqkanye';

  var doc = document;
  var root = doc.documentElement;

  var reduced = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  var coarse = window.matchMedia
    ? window.matchMedia('(pointer: coarse)').matches
    : false;

  /* Device budget. Phones and low-core machines get a fraction of the
     particles and a lower backing-store resolution — the visual reads the
     same at a third of the fill cost.

     The bottleneck on a phone is fill rate, not particle maths: the draw path
     uses additive blending (globalCompositeOperation = 'lighter') in nine
     places, so every backing-store pixel is touched several times per frame.
     That is why the harshest cut is to the DPR, not the particle count — a
     device that is both small and low-core renders at 1.25× instead of 2×,
     which is roughly two-fifths of the pixels. */
  var smallScreen = Math.min(window.innerWidth, window.innerHeight) < 760;
  var lowCore = (navigator.hardwareConcurrency || 4) <= 4;
  var weakDevice = smallScreen && lowCore;
  var budget = weakDevice ? 0.32 : (smallScreen || lowCore ? 0.42 : 1);
  var maxDpr = weakDevice ? 1.25 : (smallScreen ? 1.5 : 2);

  function dpr() {
    return Math.min(maxDpr, window.devicePixelRatio || 1);
  }

  /* ========================================================================
     1. Viewport height fallback
     Modern engines get `svh` straight from CSS. This only fills in for those
     that do not, and deliberately ignores the small height changes caused by
     mobile browser chrome hiding on scroll — re-measuring on those would make
     every full-height section resize mid-scroll.
     ====================================================================== */
  (function viewportUnit() {
    if (window.CSS && CSS.supports && CSS.supports('height', '100svh')) return;

    var lastW = 0;
    function apply() {
      var vv = window.visualViewport;
      var h = vv ? vv.height : window.innerHeight;
      root.style.setProperty('--app-vh', h + 'px');
      lastW = window.innerWidth;
    }
    apply();
    window.addEventListener('resize', function () {
      // Width change or rotation is a real layout change; height-only changes
      // are the browser toolbar and must be ignored.
      if (window.innerWidth !== lastW) apply();
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(apply, 120);
    });
  })();

  /* ========================================================================
     2. Scroll snapping support

     The CSS declares the snap targets; this section decides WHEN the page is
     allowed to snap at all. Two independent conditions switch it off:

       a) A programmatic scroll is in flight. `scroll-snap-stop: always` on the
          six technology stages means a user gesture cannot fly past a stage —
          which is the point — but in some engines it applies to programmatic
          scrolls too, so a nav link to "Market" would be caught at the first
          stage instead of clearing the section. Every in-page navigation
          therefore suspends snapping until its scroll settles.

       b) The reader is past the technology section. Snapping is for the
          walkthrough; the reading sections after it must be restable anywhere.
          Note that dropping `scroll-snap-align` from those sections is NOT
          enough — under `mandatory` a scrollport with no target in range still
          resolves to the nearest one and drags the reader backwards. The snap
          TYPE has to come off, which is what inSnapZone does.

     Both conditions write the same inline property, so they go through one
     function rather than fighting over it.

     Every snap target is sized from --screen (svh), so snap positions never
     move when a phone's URL bar hides. That is what the CSS notes depend on,
     and it is the whole reason this works on touch.
     ====================================================================== */
  var snapWatch = 0;
  var snapHeld = false;    // (a) a programmatic scroll is running
  var inSnapZone = true;   // (b) we are at or above the technology section

  /* Re-derives (b) from live geometry. Assigned by snapZone() below; callable
     from anywhere that has reason to believe the cached answer is stale. */
  var refreshSnapZone = function () {};

  function applySnap() {
    root.style.scrollSnapType = (snapHeld || !inSnapZone) ? 'none' : '';
  }

  /* Suspends snapping, runs a programmatic scroll, and restores snapping only
     once the page has actually come to rest.

     A fixed timeout is not good enough here: this page is ~15,000px tall and a
     smooth scroll from the hero to the footer takes well over a second, so a
     short timer would re-enable snapping mid-flight and `scroll-snap-stop:
     always` would grab the scroll at the next technology stage. Watching for
     the scroll position to hold still is accurate regardless of distance, and
     the elapsed ceiling stops the watcher if the user interrupts. */
  function withSnapSuspended(scrollFn) {
    if (reduced) { scrollFn(); return; }

    snapHeld = true;
    applySnap();
    // Only one programmatic scroll can be in flight; a new one replaces the
    // old watcher rather than stacking, which is why this is a flag and not a
    // counter — a counter would leak a hold every time it was cancelled.
    if (snapWatch) cancelAnimationFrame(snapWatch);

    scrollFn();

    var lastY = null, atRest = 0, startedAt = Date.now();
    (function watch() {
      var y = Math.round(window.scrollY);
      if (y === lastY) atRest++; else { atRest = 0; lastY = y; }

      // ~10 frames still (about 160ms), or a 5s ceiling as a hard stop.
      if (atRest > 9 || Date.now() - startedAt > 5000) {
        snapWatch = 0;
        snapHeld = false;
        applySnap();
        return;
      }
      snapWatch = requestAnimationFrame(watch);
    })();
  }

  /* Condition (b) — where the snap zone ends.

     Above the boundary snapping is armed; at or below it the page scrolls
     freely. The boundary is the top of the System section, which is the last
     snap position on the page (see the note beside `scroll-snap-align` in
     site.css for why System carries one). So snapping stays armed for the whole
     walkthrough including the step out of it, and is released as that step
     lands. Releasing any earlier would strand the reader: the scroller's final
     screen, where the sticky stage scrolls away, holds no snap point, so
     `mandatory` would keep resolving back onto stage six.

     This compares positions against scrollY rather than observing an element,
     because an IntersectionObserver misses the crossing entirely on an instant
     jump — a nav link from the hero to Contact takes the boundary from below
     the viewport to above it in a single frame, the intersection ratio is 0
     both times, no callback fires, and snapping stays armed over the whole
     free-scroll region. */
  (function snapZone() {
    if (reduced) return;
    var exit = doc.getElementById('product');
    if (!exit) return;

    /* The boundary is the LAST snap point on the page — the top of the System
       section — less a small tolerance.

       Tying it to that element, rather than to a marker a few pixels further
       down, is the whole trick. The release must never sit BELOW the last snap
       position: if it does, arriving at System leaves `mandatory` armed with no
       target beneath it, every attempt to read on resolves back to System, and
       the reader is wedged at the bottom of the deck. Erring a few pixels EARLY
       is harmless by comparison — the browser is landing on that snap point
       anyway. */
    var TOLERANCE = 4;
    var boundaryY = Infinity;   // until measured, assume we are in the zone

    function boundary() {
      return Math.round(exit.getBoundingClientRect().top + window.scrollY) - TOLERANCE;
    }
    function measure() {
      boundaryY = boundary();
      check();
    }
    function check() {
      var y = window.scrollY;

      /* Re-measure only in the band within one screen of the boundary. The
         cached value is fine far away, but it drifts by tens of pixels as
         content above settles (webfonts alone are enough), and near the
         boundary a stale value is exactly what wedges the page. Confining the
         layout read to the crossing keeps it off the hot path everywhere else,
         and a gesture cannot cross the band without firing an event inside it.
         An instant jump that skips the band lands far enough past the boundary
         that a stale value still resolves correctly. */
      if (Math.abs(y - boundaryY) < window.innerHeight) boundaryY = boundary();

      var next = y < boundaryY;
      if (next === inSnapZone) return;
      inSnapZone = next;
      applySnap();
    }

    /* Deferred a frame on purpose: this module runs near the top of the file,
       but the technology walkthrough further down is what adds `.is-live` to
       the section — and until it does, the CSS no-JS fallback is in force,
       collapsing the sticky stage and setting the six stage anchors to
       `display: none`. Measuring before that switch reports a position
       thousands of pixels too high. */
    requestAnimationFrame(measure);

    /* Getting this state wrong is not symmetrical. A stale "below the
       boundary" merely costs some snapping; a stale "still in the zone" past
       the last snap point leaves `mandatory` armed with nothing beneath it to
       resolve to, and the reader cannot scroll down at all. So besides the
       live check on every scroll, the answer is re-derived whenever scrolling
       comes to rest — scroll events coalesce, and the end of a fling is
       exactly where one can be dropped. */
    var restTimer = 0;
    window.addEventListener('scroll', function () {
      check();
      clearTimeout(restTimer);
      restTimer = setTimeout(measure, 160);
    }, { passive: true });

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', measure, { passive: true });
    }

    // settleTech() re-checks through this before it acts on the zone state.
    refreshSnapZone = measure;

    /* Last-resort release, on a mechanism that does not depend on scroll events
       at all. If any part of the closing section is on screen, the reader is
       unambiguously past the last snap point, and snapping must be off — so if
       every scroll-driven path above somehow failed, this still frees the page
       rather than leaving it wedged. It can only ever release, never arm, so it
       cannot fight the normal logic. */
    if ('IntersectionObserver' in window) {
      var tail = doc.getElementById('contact');
      if (tail) {
        new IntersectionObserver(function (entries) {
          if (!entries[entries.length - 1].isIntersecting) return;
          if (!inSnapZone) return;
          inSnapZone = false;
          applySnap();
        }, { threshold: 0 }).observe(tail);
      }
    }

    onResize(measure);
    window.addEventListener('load', measure);
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
      doc.fonts.ready.then(measure).catch(function () {});
    }
  })();

  /* Settle corrector — what makes the walkthrough feel locked.

     `mandatory` + `scroll-snap-stop: always` is honoured loosely after a hard
     fling: engines routinely come to rest tens of pixels off a boundary, which
     leaves a caption half-faded and reads as mushy. This waits until scrolling
     has genuinely stopped and, if the rest position is off a stage boundary by
     more than a couple of pixels, corrects it instantly.

     It only ever runs at rest, never during a gesture and never while a
     programmatic scroll is in flight, so it cannot take the scroll away from
     the reader — it is a correction, not a hijack. */
  (function settleTech() {
    if (reduced) return;
    var scroller = doc.querySelector('[data-tech-scroller]');
    var stage = scroller && scroller.querySelector('.tech__stage');
    if (!scroller || !stage) return;

    // Must match the .tech__anchor count in index.html.
    var STAGES = 6;

    function settle() {
      // Scrolling has stopped, so this is the cheapest moment to confirm which
      // side of the boundary we came to rest on before acting on it.
      refreshSnapZone();
      if (snapHeld || !inSnapZone) return;

      var screenH = stage.getBoundingClientRect().height;
      if (screenH < 200) return;

      // How far into the pinned sequence we are. Boundaries sit at exact
      // multiples of one screen.
      var into = -scroller.getBoundingClientRect().top;
      var n = Math.round(into / screenH);
      if (n < 0 || n > STAGES) return;

      var off = into - n * screenH;
      if (Math.abs(off) < 2) return;

      window.scrollTo({ top: window.scrollY - off, behavior: 'auto' });
    }

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', settle, { passive: true });
    } else {
      var timer = 0;
      window.addEventListener('scroll', function () {
        clearTimeout(timer);
        timer = setTimeout(settle, 140);
      }, { passive: true });
    }
  })();

  (function anchorNavigation() {
    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var link = e.target && e.target.closest && e.target.closest('a[href^="#"]');
      if (!link) return;

      var id = link.getAttribute('href').slice(1);
      if (!id) return;
      var target = doc.getElementById(id);
      if (!target) return;

      e.preventDefault();
      withSnapSuspended(function () {
        target.scrollIntoView({
          behavior: reduced ? 'auto' : 'smooth',
          block: 'start'
        });
      });

      // Keep the address bar honest without triggering a second jump.
      if (history.pushState) history.pushState(null, '', '#' + id);

      // Move keyboard focus with the view, or the next Tab starts from the top.
      if (target.tabIndex < 0) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  })();

  /* Fills the gaps between snap points so `mandatory` is safe.

     Mandatory snapping means the reader can only come to rest ON a snap point.
     If two consecutive points are further apart than one screen, whatever sits
     between them cannot be brought fully into view at any resting position —
     on a phone the Problem section is exactly this case once its three cards
     stack into a column. Rather than soften the snapping, this measures the
     real gaps and drops a 1px target into each one at even intervals.

     It covers the whole page, not just the snap zone, for the same reason the
     CSS keeps an alignment on every section: past the walkthrough these points
     are inert, because the snap type is switched off there. They exist for the
     case where it is not — JavaScript blocked, or the zone toggle missing its
     cue — so that the fallback is a readable snappy page rather than sections
     the reader can never bring fully into view. A handful of empty 1px divs is
     a cheap insurance premium. */
  (function snapFill() {
    if (reduced) return;

    var layer = doc.createElement('div');
    layer.className = 'snap-fill-layer';
    layer.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(layer);

    function build() {
      layer.textContent = '';

      var hero = doc.querySelector('.hero');
      if (!hero) return;
      // The hero is exactly one --screen tall, so it measures svh directly.
      // window.innerHeight would report the large viewport once the URL bar
      // hides and would under-fill the gaps.
      var screenH = Math.round(hero.getBoundingClientRect().height);
      if (screenH < 200) return;

      var y = window.scrollY;
      var points = [];

      // Exactly the elements that carry `scroll-snap-align` in the CSS.
      toArray(doc.querySelectorAll('.hero, main > section[id], .tech__anchor'))
        .forEach(function (el) {
          points.push(Math.round(el.getBoundingClientRect().top + y));
        });

      // The footer is end-aligned: its snap position is its bottom, one screen up.
      var footer = doc.querySelector('footer');
      if (footer) {
        var r = footer.getBoundingClientRect();
        points.push(Math.round(r.top + y + r.height - screenH));
      }

      points.sort(function (a, b) { return a - b; });

      var frag = doc.createDocumentFragment();
      var made = 0;
      for (var i = 0; i < points.length - 1; i++) {
        var gap = points[i + 1] - points[i];
        if (gap <= screenH + 8) continue;

        // Evenly spaced so no sub-gap exceeds one screen.
        var steps = Math.ceil(gap / screenH);
        for (var k = 1; k < steps; k++) {
          var fill = doc.createElement('div');
          fill.className = 'snap-fill';
          fill.style.top = Math.round(points[i] + (gap / steps) * k) + 'px';
          frag.appendChild(fill);
          made++;
        }
      }
      layer.appendChild(frag);
      layer.dataset.count = made;
    }

    /* Deferred a frame for the same reason as snapZone(): the technology
       walkthrough has not added `.is-live` yet, so the six stage anchors are
       still `display: none` under the no-JS fallback and would all measure at
       zero. */
    requestAnimationFrame(build);
    onResize(build);
    // Webfonts and the product image both change section heights after load.
    window.addEventListener('load', build);
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
      doc.fonts.ready.then(build).catch(function () {});
    }
  })();

  /* ========================================================================
     3. Reveal on scroll
     ====================================================================== */
  (function reveal() {
    var els = toArray(doc.querySelectorAll('.reveal'));
    if (!els.length || reduced || !('IntersectionObserver' in window)) return;

    var pending = els.slice();

    function show(el) {
      el.classList.add('is-visible');
      var i = pending.indexOf(el);
      if (i !== -1) pending.splice(i, 1);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        show(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });

    els.forEach(function (el) {
      // Arm (hide) and observe in the same pass, so an element already on
      // screen at load is never hidden without something watching it.
      el.classList.add('reveal--armed');
      io.observe(el);
    });

    /* Backstop. This animation is decoration; the text underneath is the
       product. A geometry check on scroll costs almost nothing, unhides
       anything the observer misses, and detaches itself once everything is
       shown — so a hidden section can never survive a scroll past it. */
    var ticking = false;
    function sweep() {
      ticking = false;
      var limit = window.innerHeight * 0.95;
      pending.slice().forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < limit && r.bottom > 0) { show(el); io.unobserve(el); }
      });
      if (!pending.length) {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      }
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sweep);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  })();

  /* ========================================================================
     4. Navigation drawer
     ====================================================================== */
  (function nav() {
    var toggle = doc.querySelector('[data-nav-toggle]');
    var drawer = doc.querySelector('[data-nav-drawer]');
    if (!toggle || !drawer) return;

    var open = false;

    function setOpen(next) {
      open = next;
      toggle.setAttribute('aria-expanded', String(next));
      drawer.hidden = !next;
      doc.body.style.overflow = next ? 'hidden' : '';
      if (next) {
        var first = drawer.querySelector('a');
        if (first) first.focus();
      }
    }

    toggle.addEventListener('click', function () { setOpen(!open); });

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { setOpen(false); toggle.focus(); }
    });

    doc.addEventListener('click', function (e) {
      if (!open) return;
      if (!drawer.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
    });

    // Returning to the desktop breakpoint must not leave the body locked.
    var mq = window.matchMedia('(min-width: 921px)');
    var onChange = function (e) { if (e.matches && open) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  })();

  /* ========================================================================
     5. Scroll spy
     ====================================================================== */
  (function scrollSpy() {
    if (!('IntersectionObserver' in window)) return;
    var links = doc.querySelectorAll('[data-nav-links] a[href^="#"]');
    if (!links.length) return;

    var map = {};
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute('href').slice(1);
      var section = doc.getElementById(id);
      if (section) map[id] = { link: links[i], el: section };
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var rec = map[e.target.id];
        if (!rec) return;
        if (e.isIntersecting) {
          for (var k in map) map[k].link.removeAttribute('aria-current');
          rec.link.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    for (var key in map) io.observe(map[key].el);
  })();

  /* ========================================================================
     6. Contact form
     ====================================================================== */
  (function contactForm() {
    var form = doc.querySelector('[data-form]');
    var sent = doc.querySelector('[data-form-sent]');
    var status = doc.querySelector('[data-form-status]');
    if (!form || !sent) return;

    var button = form.querySelector('button[type="submit"]');
    var defaultLabel = button ? button.textContent : '';

    form.addEventListener('submit', function (e) {
      if (!form.checkValidity()) return; // let the browser show its messages

      // Endpoint not configured yet — fall through to a normal POST rather
      // than silently swallowing a real lead.
      if (FORM_ENDPOINT.indexOf('YOUR_FORM_ID') !== -1) {
        console.warn('[aqua] Formspree endpoint is not configured; see FORM_ENDPOINT in assets/site.js');
        return;
      }

      e.preventDefault();
      if (status) status.textContent = '';
      if (button) { button.disabled = true; button.textContent = 'Sending…'; }

      fetch(FORM_ENDPOINT, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          form.hidden = true;
          sent.hidden = false;
          sent.setAttribute('tabindex', '-1');
          sent.focus();
        })
        .catch(function () {
          if (status) {
            status.textContent =
              'Could not send just now. Please email sam@aqua-ve.com directly, or try again.';
          }
        })
        .finally(function () {
          if (button) { button.disabled = false; button.textContent = defaultLabel; }
        });
    });
  })();

  /* ========================================================================
     7. Hero canvas — drifting microdroplets over a field
     ====================================================================== */
  (function hero() {
    var canvas = doc.querySelector('[data-hero-canvas]');
    if (!canvas) return;

    /* Purely decorative, and the hero is where first-input responsiveness
       matters most — a device that is both small and low-core keeps the CSS
       gradient underneath and never starts the loop at all. */
    if (weakDevice) { canvas.remove(); return; }

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var host = canvas.parentElement;
    var W = 0, H = 0, ratio = dpr();
    var particles = [];
    var mouse = null;
    var raf = 0, running = true;

    function fit() {
      var r = host.getBoundingClientRect();
      W = r.width; H = r.height;
      ratio = dpr();
      canvas.width = Math.round(W * ratio);
      canvas.height = Math.round(H * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed();
    }

    function seed() {
      particles.length = 0;
      var n = Math.round(70 * budget);
      for (var i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.6 + Math.random() * 1.6,
          vx: 0.05 + Math.random() * 0.18,
          vy: -0.06 - Math.random() * 0.16,
          a: 0.1 + Math.random() * 0.3
        });
      }
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);

      // Field lines are the most expensive stroke on the canvas; skip them on
      // phones, where they are barely visible anyway.
      if (!smallScreen) {
        ctx.strokeStyle = 'rgba(86,200,223,0.06)';
        ctx.lineWidth = 1;
        var step = Math.max(70, W / 16);
        for (var x = step * 0.5; x < W; x += step) {
          ctx.beginPath();
          for (var y = 0; y <= H; y += 14) {
            var xx = x + Math.sin(y * 0.006 + t * 0.00035 + x * 0.02) * 16;
            if (y === 0) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
          }
          ctx.stroke();
        }
      }

      var m = mouse;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (m) {
          var dx = m.x - p.x, dy = m.y - p.y;
          var d2 = dx * dx + dy * dy;
          if (d2 > 16 && d2 < 25600) {
            var d = Math.sqrt(d2);
            var f = (1 - d / 160) * 0.5;
            p.x += (dx / d) * f; p.y += (dy / d) * f;
          }
        }
        if (p.x > W + 4) p.x = -4;
        if (p.x < -4) p.x = W + 4;
        if (p.y < -4) p.y = H + 4;
        if (p.y > H + 4) p.y = -4;
        ctx.fillStyle = 'rgba(180,225,240,' + p.a + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }

      if (m) {
        ctx.strokeStyle = 'rgba(86,200,223,0.14)';
        ctx.beginPath(); ctx.arc(m.x, m.y, 60, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = 'rgba(86,200,223,0.3)';
        ctx.beginPath();
        ctx.moveTo(m.x - 6, m.y); ctx.lineTo(m.x + 6, m.y);
        ctx.moveTo(m.x, m.y - 6); ctx.lineTo(m.x, m.y + 6);
        ctx.stroke();
      }
    }

    fit();

    // Pointer tracking is meaningless on touch and costs a listener on every
    // scroll-adjacent gesture.
    if (!coarse) {
      host.addEventListener('pointermove', function (e) {
        var r = canvas.getBoundingClientRect();
        mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      }, { passive: true });
      host.addEventListener('pointerleave', function () { mouse = null; });
    }

    onResize(function () { fit(); if (reduced) draw(0); });

    if (reduced) { draw(0); return; }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { running = es[0].isIntersecting; })
        .observe(canvas);
    }

    (function loop(t) {
      if (running) draw(t);
      raf = requestAnimationFrame(loop);
    })(0);

    window.addEventListener('pagehide', function () { cancelAnimationFrame(raf); });
  })();

  /* ========================================================================
     8. Technology — scroll-driven physics walkthrough
     ====================================================================== */
  (function technology() {
    var canvas = doc.querySelector('[data-tech-canvas]');
    if (!canvas) return;

    /* Opaque. The canvas fills the stage edge to edge and the stage's own
       background is never meant to show through, so there is nothing to gain
       from an alpha channel — and plenty to lose: a transparent full-viewport
       canvas has to be blended against the page on every composite. The frame
       opens with a fillRect of the stage colour instead of clearRect.

       The two cross-fade layers in getLayers() stay transparent; they are drawn
       onto this one with globalAlpha and genuinely need the channel. */
    var BG = '#0A1118';   /* --bg-deep */
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    var stage = canvas.parentElement;
    var scroller = stage.parentElement;
    var section = doc.getElementById('technology');
    var ratio = dpr();

    // Hands the stage over to JS: the CSS overlay/fallback layout keys off this.
    if (section) section.classList.add('is-live');
    var W = 0, H = 0, tick = 0, vignette = null, scrollSpan = 0;
    var lastStage = -1, lastHud = {};

    var ANNOTATE = true;
    var captions = toArray(stage.querySelectorAll('[data-caption]'));
    var rails = toArray(doc.querySelectorAll('[data-rail]'));
    var railWrap = doc.querySelector('[data-rail-wrap]');
    var hudPanel = doc.querySelector('[data-hud-panel]');
    var returnPanel = doc.querySelector('[data-return-panel]');
    var recEl = doc.querySelector('[data-ret-rec]');
    var barA = doc.querySelector('[data-ret-bar]');
    var intro = stage.querySelector('[data-tech-intro]');
    var fadeEls = toArray(stage.querySelectorAll('[data-fade-in]'));
    var skipFloat = stage.querySelector('[data-skip-float]');

    /* How far the intro overlay zooms as it dissolves into the simulation.
       2.8× a full-viewport layer is a lot of overdraw for a phone to composite
       while it is also drawing the canvas and running a snap; 1.9× reads the
       same and costs roughly a third less. */
    var INTRO_ZOOM = smallScreen ? 0.9 : 1.8;
    var introAnimating = false;

    var hud = {};
    ['phase', 'v', 'i', 'g', 'r'].forEach(function (k) {
      hud[k] = doc.querySelector('[data-hud="' + k + '"]');
    });
    var PHASES = ['LOSS', 'AERODYNAMICS', 'IONIZATION', 'ACCELERATION', 'COLLECTION', 'RETURN'];

    // Skip control jumps past the whole pinned sequence.
    /* Skip clears the whole pinned sequence in one move. Snapping is suspended
       for the trip, otherwise `scroll-snap-stop: always` on each stage would
       halt it at the very next one and the button would appear broken. */
    toArray(doc.querySelectorAll('[data-skip]')).forEach(function (b) {
      b.addEventListener('click', function () {
        withSnapSuspended(function () {
          var r = scroller.getBoundingClientRect();
          window.scrollTo({
            top: window.scrollY + r.bottom,
            behavior: reduced ? 'auto' : 'smooth'
          });
        });
      });
    });

    /* ---- sprites ---- */
    function sprite(r, g, b) {
      var s = doc.createElement('canvas');
      s.width = s.height = 64;
      var x = s.getContext('2d');
      var gr = x.createRadialGradient(32, 32, 0, 32, 32, 30);
      gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
      gr.addColorStop(0.3, 'rgba(' + r + ',' + g + ',' + b + ',0.5)');
      gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      return s;
    }
    var spW = sprite(210, 236, 246), spC = sprite(86, 200, 223);

    /* Cross-fade layers are allocated on demand — two extra full-resolution
       canvases are a real memory cost on a phone and are only needed during
       the two scene transitions. */
    var layers = null;
    function getLayers() {
      if (!layers) {
        layers = [0, 1].map(function () {
          var cv = doc.createElement('canvas');
          return { cv: cv, cx: cv.getContext('2d') };
        });
        sizeLayers();
      }
      return layers;
    }
    function sizeLayers() {
      if (!layers) return;
      layers.forEach(function (l) {
        l.cv.width = Math.round(W * ratio);
        l.cv.height = Math.round(H * ratio);
        l.cx.setTransform(ratio, 0, 0, ratio, 0, 0);
      });
    }

    var MP = [], IONS = [], SPL = [], DRIPS = [], PLM = [];
    var micro = null, macro = null;

    function buildGeometry() {
      /* ---- micro scene: one collector wire in cross-section ---- */
      var R = Math.min(W, H) * 0.088;
      var cx = W * 0.605, cy = H * 0.5;
      var ex = W * 0.16, ey = cy;
      var U0 = Math.max(1.0, W / 950);

      var air = function (x, y) {
        var dx = x - cx, dy = y - cy, r2 = dx * dx + dy * dy, R2 = R * R;
        if (r2 < R2 * 1.02) return { u: 0, v: 0 };
        var r4 = r2 * r2;
        return {
          u: U0 * (1 - R2 * (dx * dx - dy * dy) / r4),
          v: -U0 * (2 * R2 * dx * dy / r4)
        };
      };

      var d = Math.hypot(cx - ex, cy - ey);
      var ix = cx + (ex - cx) * (R * R) / (d * d);
      var iy = cy + (ey - cy) * (R * R) / (d * d);
      var ef = function (x, y) {
        var dx = x - ex, dy = y - ey, r2 = dx * dx + dy * dy + 60;
        var Ex = dx / r2, Ey = dy / r2;
        dx = x - ix; dy = y - iy; r2 = dx * dx + dy * dy + 60;
        return { x: Ex - dx / r2, y: Ey - dy / r2 };
      };

      // Streamline and field-line counts drive a lot of per-frame stroking.
      var nS = smallScreen ? 9 : 15;
      var streams = [];
      for (var i = 0; i < nS; i++) {
        var y0 = cy + ((i + 0.5 - nS / 2) / (nS / 2)) * H * 0.42;
        var px = -12, py = y0, pts = [px, py];
        for (var k = 0; k < 460; k++) {
          var a = air(px, py);
          var sp = Math.hypot(a.u, a.v);
          if (sp < 0.02) break;
          px += a.u / sp * 7; py += a.v / sp * 7;
          pts.push(px, py);
          if (px > W + 12) break;
        }
        streams.push(pts);
      }

      var nF = smallScreen ? 16 : 28;
      var flines = [];
      for (var f = 0; f < nF; f++) {
        var a0 = (f / nF) * Math.PI * 2;
        var fx = ex + Math.cos(a0) * 5, fy = ey + Math.sin(a0) * 5;
        var fpts = [fx, fy];
        for (var kk = 0; kk < 460; kk++) {
          var e = ef(fx, fy);
          var m = Math.hypot(e.x, e.y) || 1e-9;
          fx += e.x / m * 6; fy += e.y / m * 6;
          fpts.push(fx, fy);
          if (Math.hypot(fx - cx, fy - cy) < R + 2) break;
          if (fx < -30 || fx > W + 30 || fy < -30 || fy > H + 30) break;
        }
        flines.push(fpts);
      }

      micro = { R: R, cx: cx, cy: cy, ex: ex, ey: ey, U0: U0, air: air, ef: ef, streams: streams, flines: flines };

      /* ---- macro scene: isometric mechanical-draft cooling tower ---- */
      var c30 = Math.cos(Math.PI / 6), s30 = 0.5;
      var Wx = 6.4, Wy = 3.2, Hz = 2.8;
      var fanR = 0.8, fanH = 0.55, fanTopZ = Hz + fanH;
      var fans = [];
      for (var fi = 0; fi < 3; fi++) fans.push({ x: Wx * (0.2 + 0.3 * fi), y: Wy * 0.5 });
      var basinH = 0.62, basinFwd = Wy * 0.62;
      var u = 0.6 * W / ((Wx + Wy) * c30);

      function measure() {
        var b = [];
        [[0,0,0],[Wx,0,0],[Wx,Wy,0],[0,Wy,0],[0,0,Hz],[Wx,0,Hz],[Wx,Wy,Hz],[0,Wy,Hz]]
          .forEach(function (p) { b.push([(p[0]-p[1])*c30*u, ((p[0]+p[1])*s30-p[2])*u]); });
        fans.forEach(function (fn) { b.push([(fn.x-fn.y)*c30*u, ((fn.x+fn.y)*s30-fanTopZ)*u]); });
        [[-0.28,-0.28,-basinH],[Wx+0.28,-0.28,-basinH],[Wx+0.28,Wy+0.5,-basinH],[-0.28,Wy+0.5,-basinH]]
          .forEach(function (p) { b.push([(p[0]-p[1])*c30*u, ((p[0]+p[1])*s30-p[2])*u]); });
        var a = { miX: 1e9, maX: -1e9, miY: 1e9, maY: -1e9 };
        b.forEach(function (p) {
          a.miX = Math.min(a.miX, p[0]); a.maX = Math.max(a.maX, p[0]);
          a.miY = Math.min(a.miY, p[1]); a.maY = Math.max(a.maY, p[1]);
        });
        return a;
      }

      var mm = measure();
      if ((mm.maY - mm.miY) > 0.52 * H) { u *= 0.52 * H / (mm.maY - mm.miY); mm = measure(); }
      if ((mm.maX - mm.miX) > 0.54 * W) { u *= 0.54 * W / (mm.maX - mm.miX); mm = measure(); }

      var ox = W / 2 - (mm.miX + mm.maX) / 2;
      var oy = H * 0.5 - (mm.miY + mm.maY) / 2;
      var proj = function (x, y, z) {
        return [ox + (x - y) * c30 * u, oy + ((x + y) * s30 - z) * u];
      };
      var pipe = [
        [Wx * 0.9, Wy * 0.5, fanTopZ * 0.86],
        [Wx + 0.5, Wy * 0.5, Hz * 0.55],
        [Wx + 0.5, Wy + basinFwd * 0.45, -basinH * 0.15],
        [Wx * 0.72, Wy + basinFwd * 0.55, -basinH * 0.35]
      ];

      macro = {
        c30: c30, s30: s30, Wx: Wx, Wy: Wy, Hz: Hz,
        fanR: fanR, fanH: fanH, fanTopZ: fanTopZ, u: u, ox: ox, oy: oy,
        proj: proj, fans: fans,
        fanS: fans.map(function (fn) { return { c: proj(fn.x, fn.y, fanTopZ), base: proj(fn.x, fn.y, Hz) }; }),
        pipe: pipe,
        pipeS: pipe.map(function (p) { return proj(p[0], p[1], p[2]); }),
        basinH: basinH, basinFwd: basinFwd
      };
    }

    function fit() {
      var r = stage.getBoundingClientRect();
      W = r.width; H = r.height;
      ratio = dpr();
      canvas.width = Math.round(W * ratio);
      canvas.height = Math.round(H * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      sizeLayers();
      vignette = ctx.createRadialGradient(
        W / 2, H / 2, Math.min(W, H) * 0.42,
        W / 2, H / 2, Math.max(W, H) * 0.72
      );
      vignette.addColorStop(0, 'rgba(8,14,20,0)');
      vignette.addColorStop(1, 'rgba(8,14,20,0.5)');
      buildGeometry();
      MP.length = IONS.length = SPL.length = DRIPS.length = PLM.length = 0;
      // Cached once per resize — see progress().
      scrollSpan = scroller.offsetHeight - stage.offsetHeight;
    }

    /* Progress is measured against the stage's own height rather than
       window.innerHeight. On mobile innerHeight changes as the browser
       toolbar hides, which made the walkthrough jump mid-scroll.

       getBoundingClientRect() is read once per frame and is cheap; offsetHeight
       is NOT — it forces a synchronous layout. Reading it every frame while the
       user drags was the main source of stutter through this section on a
       phone, so both heights are cached in fit() instead. */
    function progress() {
      if (scrollSpan <= 0) return 0;
      var top = scroller.getBoundingClientRect().top;
      return Math.min(1, Math.max(0, -top / scrollSpan));
    }
    function ss(p, a, b) {
      var t = Math.min(1, Math.max(0, (p - a) / (b - a)));
      return t * t * (3 - 2 * t);
    }

    /* ---- micro rendering ---- */
    function spawnM(p) {
      var g = micro;
      p.x = -10 - Math.random() * W * 0.2;
      p.y = g.cy + (Math.random() * 2 - 1) * H * 0.42;
      var a = g.air(Math.max(0, p.x), p.y);
      p.vx = a.u; p.vy = a.v; p.q = 0;
      p.r = 1.0 + Math.random() * 1.2;
      p.trail = [];
    }

    function drawMicro(g2, o, animate) {
      var g = micro;
      var fpx = Math.max(10, Math.round(11 * Math.min(W, H) / 640));

      g2.strokeStyle = 'rgba(140,170,190,0.2)';
      g2.lineWidth = 1;
      g2.setLineDash([5, 9]);
      g2.lineDashOffset = -(tick * (0.4 + g.U0 * 0.35));
      g.streams.forEach(function (pts) {
        g2.beginPath(); g2.moveTo(pts[0], pts[1]);
        for (var k = 2; k < pts.length; k += 2) g2.lineTo(pts[k], pts[k + 1]);
        g2.stroke();
      });
      g2.setLineDash([]);

      if (o.fieldR > 0.02) {
        g2.save();
        g2.globalCompositeOperation = 'lighter';
        g2.strokeStyle = 'rgba(86,200,223,' + (0.26 * o.fieldR) + ')';
        g2.lineWidth = 1.1;
        g2.setLineDash([3, 9]);
        g2.lineDashOffset = -(tick * 1.1);
        g.flines.forEach(function (pts) {
          g2.beginPath(); g2.moveTo(pts[0], pts[1]);
          for (var k = 2; k < pts.length; k += 2) g2.lineTo(pts[k], pts[k + 1]);
          g2.stroke();
        });
        g2.setLineDash([]);
        g2.globalAlpha = 0.3 * o.fieldR;
        g2.drawImage(spC, g.cx - g.R * 2.3, g.cy - g.R * 2.3, g.R * 4.6, g.R * 4.6);
        g2.restore();
      }

      var wg = g2.createRadialGradient(g.cx - g.R * 0.35, g.cy - g.R * 0.4, g.R * 0.15, g.cx, g.cy, g.R);
      wg.addColorStop(0, '#233442'); wg.addColorStop(1, '#0D151C');
      g2.fillStyle = wg;
      g2.beginPath(); g2.arc(g.cx, g.cy, g.R, 0, 6.2832); g2.fill();
      g2.strokeStyle = 'rgba(150,190,210,' + (0.45 + 0.45 * o.fieldR) + ')';
      g2.lineWidth = 1.5; g2.stroke();

      if (o.fieldR > 0.05) {
        var gy = g.cy + g.R + 15;
        g2.strokeStyle = 'rgba(150,190,210,' + 0.55 * o.fieldR + ')';
        g2.lineWidth = 1.4;
        g2.beginPath();
        g2.moveTo(g.cx, g.cy + g.R); g2.lineTo(g.cx, gy);
        g2.moveTo(g.cx - 10, gy); g2.lineTo(g.cx + 10, gy);
        g2.moveTo(g.cx - 6, gy + 5); g2.lineTo(g.cx + 6, gy + 5);
        g2.moveTo(g.cx - 2.5, gy + 10); g2.lineTo(g.cx + 2.5, gy + 10);
        g2.stroke();
      }

      if (o.eIn > 0.02) {
        g2.save();
        g2.globalAlpha = o.eIn;
        g2.strokeStyle = 'rgba(150,190,210,0.7)';
        g2.lineWidth = 2;
        g2.beginPath(); g2.moveTo(g.ex - 46, g.ey); g2.lineTo(g.ex - 14, g.ey); g2.stroke();
        g2.fillStyle = '#9FCADC';
        g2.beginPath();
        g2.moveTo(g.ex, g.ey); g2.lineTo(g.ex - 16, g.ey - 7); g2.lineTo(g.ex - 16, g.ey + 7);
        g2.closePath(); g2.fill();
        if (o.chargeR > 0.02) {
          g2.globalCompositeOperation = 'lighter';
          g2.globalAlpha = o.chargeR * (0.5 + 0.2 * Math.sin(tick * 0.15));
          g2.drawImage(spC, g.ex - 26, g.ey - 26, 52, 52);
          var pr = (tick * 1.4) % 46;
          g2.globalAlpha = o.chargeR * 0.5 * (1 - pr / 46);
          g2.strokeStyle = '#56C8DF'; g2.lineWidth = 1;
          g2.beginPath(); g2.arc(g.ex, g.ey, 6 + pr, 0, 6.2832); g2.stroke();
        }
        g2.restore();
      }

      if (animate && o.chargeR > 0.05) {
        var want = Math.round(70 * budget * o.chargeR);
        if (IONS.length < want) IONS.push({ x: g.ex, y: g.ey, life: 1, j: Math.random() * 6.28 });
        g2.save();
        g2.globalCompositeOperation = 'lighter';
        for (var i = IONS.length - 1; i >= 0; i--) {
          var io = IONS[i];
          var e = g.ef(io.x, io.y);
          var m = Math.hypot(e.x, e.y) || 1e-9;
          io.x += (e.x / m) * 2.6 + Math.sin(tick * 0.1 + io.j) * 0.5;
          io.y += (e.y / m) * 2.6 + Math.cos(tick * 0.09 + io.j) * 0.5;
          io.life -= 0.008;
          if (io.life <= 0 || Math.hypot(io.x - g.cx, io.y - g.cy) < g.R + 2 ||
              io.x > W + 10 || io.x < -10 || io.y < -10 || io.y > H + 10) {
            IONS.splice(i, 1); continue;
          }
          g2.globalAlpha = 0.4 * io.life * o.chargeR;
          g2.drawImage(spC, io.x - 3, io.y - 3, 6, 6);
        }
        g2.restore();
      }

      if (animate) {
        var cap = Math.round(120 * budget);
        if (MP.length === 0) {
          for (var s = 0; s < cap; s++) {
            var np = {};
            spawnM(np);
            np.x = Math.random() * W;
            var a0 = g.air(Math.max(0, np.x), np.y);
            np.vx = a0.u; np.vy = a0.v;
            MP.push(np);
          }
        }
        while (MP.length < cap) { var ap = {}; spawnM(ap); MP.push(ap); }
        if (MP.length > cap) MP.length = cap;

        for (var mi = 0; mi < MP.length; mi++) {
          var p = MP[mi];
          var av = g.air(p.x, p.y);
          p.vx += (av.u - p.vx) * 0.1;
          p.vy += (av.v - p.vy) * 0.1;

          if (o.chargeR > 0.02 && p.q < o.chargeR && p.x > g.ex - 14 &&
              p.x < g.ex + W * 0.15 && Math.abs(p.y - g.ey) < H * 0.3) {
            p.q = Math.min(o.chargeR, p.q + 0.05 + 0.1 * Math.random());
          }
          if (p.q > 0.02 && o.fieldR > 0.02) {
            var ev = g.ef(p.x, p.y);
            var K = 110 * o.fieldR * p.q;
            p.vx += Math.max(-0.6, Math.min(0.6, ev.x * K));
            p.vy += Math.max(-0.6, Math.min(0.6, ev.y * K));
          }
          p.x += p.vx; p.y += p.vy;

          if (p.q > 0.2 && o.fieldR > 0.05) {
            p.trail.push(p.x, p.y);
            if (p.trail.length > 44) p.trail.splice(0, 2);
          } else if (p.trail.length) p.trail.length = 0;

          if (Math.hypot(p.x - g.cx, p.y - g.cy) < g.R + p.r) {
            if (SPL.length < 48) SPL.push({ ang: Math.atan2(p.y - g.cy, p.x - g.cx), s: 1.6 + p.q, life: 1 });
            spawnM(p); continue;
          }
          if (p.x > W + 12 || p.y < -14 || p.y > H + 14) spawnM(p);
        }

        for (var ti = 0; ti < MP.length; ti++) {
          var tp = MP[ti];
          if (tp.trail.length > 4) {
            g2.strokeStyle = 'rgba(86,200,223,' + (0.1 + 0.16 * tp.q) + ')';
            g2.lineWidth = 1;
            g2.beginPath(); g2.moveTo(tp.trail[0], tp.trail[1]);
            for (var k2 = 2; k2 < tp.trail.length; k2 += 2) g2.lineTo(tp.trail[k2], tp.trail[k2 + 1]);
            g2.stroke();
          }
        }
        g2.save();
        g2.globalCompositeOperation = 'lighter';
        for (var di = 0; di < MP.length; di++) {
          var dp = MP[di];
          var sz = dp.r * 5;
          g2.globalAlpha = 0.5 + 0.4 * dp.q;
          g2.drawImage(dp.q > 0.25 ? spC : spW, dp.x - sz / 2, dp.y - sz / 2, sz, sz);
        }
        g2.restore();
      } else {
        g2.save();
        g2.globalCompositeOperation = 'lighter';
        for (var si = 0; si < g.streams.length; si++) {
          var spts = g.streams[si];
          var n2 = spts.length / 2;
          for (var kx = (si * 7) % 20; kx < n2; kx += 24) {
            var sx = spts[kx * 2], sy = spts[kx * 2 + 1];
            g2.globalAlpha = 0.55;
            g2.drawImage(o.chargeR > 0.4 && sx > g.ex ? spC : spW, sx - 4, sy - 4, 8, 8);
          }
        }
        g2.restore();
      }

      g2.save();
      g2.globalCompositeOperation = 'lighter';
      for (var pi = SPL.length - 1; pi >= 0; pi--) {
        var spl = SPL[pi];
        if (animate) {
          spl.s = Math.min(4.2, spl.s + 0.01);
          spl.life -= 0.0018;
          var dd = Math.atan2(Math.sin(1.5708 - spl.ang), Math.cos(1.5708 - spl.ang));
          spl.ang += dd * 0.002;
          if (spl.life <= 0) { SPL.splice(pi, 1); continue; }
        }
        var lx = g.cx + Math.cos(spl.ang) * (g.R - 1);
        var ly = g.cy + Math.sin(spl.ang) * (g.R - 1);
        g2.globalAlpha = 0.7 * spl.life;
        g2.drawImage(spC, lx - spl.s * 2.2, ly - spl.s * 2.2, spl.s * 4.4, spl.s * 4.4);
      }
      if (animate && o.fieldR > 0.5 && SPL.length > 8 && Math.random() < 0.02) {
        DRIPS.push({ x: g.cx + (Math.random() - 0.5) * g.R * 0.6, y: g.cy + g.R, vy: 0.4, life: 1 });
      }
      for (var dri = DRIPS.length - 1; dri >= 0; dri--) {
        var dr = DRIPS[dri];
        if (animate) { dr.vy += 0.06; dr.y += dr.vy; dr.life -= 0.02; }
        if (dr.life <= 0 || dr.y > H + 8) { DRIPS.splice(dri, 1); continue; }
        g2.globalAlpha = 0.7 * dr.life;
        g2.drawImage(spC, dr.x - 4, dr.y - 4, 8, 8);
      }
      g2.restore();

      if (o.brIn > 0.02) {
        var A0 = g.R * 0.55;
        var A = A0 + (g.R * 4.4 - A0) * o.fieldR;
        var bx = g.cx - g.R * 3.1;
        var by0 = g.cy - A / 2, by1 = g.cy + A / 2;
        g2.strokeStyle = 'rgba(230,245,250,' + 0.6 * o.brIn + ')';
        g2.lineWidth = 1.2;
        g2.beginPath();
        g2.moveTo(bx, by0); g2.lineTo(bx, by1);
        g2.moveTo(bx - 4, by0 + 7); g2.lineTo(bx, by0); g2.lineTo(bx + 4, by0 + 7);
        g2.moveTo(bx - 4, by1 - 7); g2.lineTo(bx, by1); g2.lineTo(bx + 4, by1 - 7);
        g2.moveTo(bx - 7, by0); g2.lineTo(bx + 7, by0);
        g2.moveTo(bx - 7, by1); g2.lineTo(bx + 7, by1);
        g2.stroke();
        g2.fillStyle = 'rgba(230,245,250,' + 0.85 * o.brIn + ')';
        g2.font = '500 ' + fpx + "px 'IBM Plex Mono', monospace";
        g2.textAlign = 'right';
        g2.fillText(o.fieldR > 0.35 ? 'A' : 'A₀', bx - 12, g.cy + fpx * 0.35);
        g2.textAlign = 'left';
      }

      if (ANNOTATE) {
        // 400 is the only Plex Mono weight the page loads; asking for 500 here
        // just made the engine synthesise one.
        g2.font = '400 ' + Math.max(9, fpx - 1) + "px 'IBM Plex Mono', monospace";
        g2.fillStyle = 'rgba(140,170,190,0.6)';
        g2.fillText('AIR STREAMLINES →', 18, H - 20);
        g2.textAlign = 'center';
        g2.fillStyle = 'rgba(180,210,225,0.75)';
        g2.fillText(
          o.fieldR > 0.3 ? 'COLLECTOR — GROUNDED' : 'COLLECTOR WIRE · ×1,000',
          g.cx, g.cy + g.R + (o.fieldR > 0.05 ? 44 : 24)
        );
        if (o.eIn > 0.1) {
          g2.fillStyle = 'rgba(86,200,223,' + 0.85 * o.eIn + ')';
          g2.fillText('CORONA EMITTER · ~10 kV', g.ex + 10, g.ey - 30);
        }
        if (o.fieldR > 0.2) {
          g2.fillStyle = 'rgba(86,200,223,' + 0.6 * o.fieldR + ')';
          g2.fillText('ELECTRIC FIELD E', (g.ex + g.cx) / 2, g.cy - g.R * 2.6);
        }
        g2.textAlign = 'left';
      }
    }

    /* ---- macro rendering ---- */
    function spawnPL(p, initial) {
      var m = macro;
      var f = m.fans[(Math.random() * m.fans.length) | 0];
      var a = Math.random() * 6.2832;
      var rr = Math.sqrt(Math.random()) * m.fanR * 0.7;
      var s = m.proj(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, m.fanTopZ + 0.04);
      p.x = s[0]; p.y = s[1];
      p.vx = (Math.random() - 0.5) * 0.2;
      p.vy = -(0.55 + Math.random() * 0.65) * (H / 760);
      p.r = (0.12 + Math.random() * 0.16) * m.fanR * m.u;
      p.gr = 1.005 + Math.random() * 0.006;
      p.seed = Math.random() * 6.28;
      p.rise = 0;
      if (initial) {
        var n = (Math.random() * 110) | 0;
        for (var k = 0; k < n; k++) { p.y += p.vy; p.r *= 1 + (p.gr - 1) * 0.55; p.rise++; }
      }
    }

    function quad(g2, a, b, c, d, fill, stroke, lw) {
      g2.beginPath();
      g2.moveTo(a[0], a[1]); g2.lineTo(b[0], b[1]); g2.lineTo(c[0], c[1]); g2.lineTo(d[0], d[1]);
      g2.closePath();
      if (fill) { g2.fillStyle = fill; g2.fill(); }
      if (stroke) { g2.strokeStyle = stroke; g2.lineWidth = lw || 1; g2.stroke(); }
    }

    function ellipse3(g2, cxu, cyu, z, r) {
      var m = macro;
      g2.beginPath();
      var n = smallScreen ? 24 : 40;
      for (var i = 0; i <= n; i++) {
        var a = i / n * 6.2832;
        var s = m.proj(cxu + Math.cos(a) * r, cyu + Math.sin(a) * r, z);
        if (i === 0) g2.moveTo(s[0], s[1]); else g2.lineTo(s[0], s[1]);
      }
    }

    function drawFan(g2, f, active, meshShow) {
      var m = macro;
      var n = smallScreen ? 24 : 40;
      var top = [], base = [];
      for (var i = 0; i <= n; i++) {
        var a = i / n * 6.2832;
        top.push(m.proj(f.x + Math.cos(a) * m.fanR, f.y + Math.sin(a) * m.fanR, m.fanTopZ));
        base.push(m.proj(f.x + Math.cos(a) * m.fanR, f.y + Math.sin(a) * m.fanR, m.Hz));
      }
      for (var j = 0; j < n; j++) {
        var sh = 0.5 + 0.5 * Math.cos(j / n * 6.2832 - 2.3);
        var gv = Math.round(46 + 26 * sh);
        g2.beginPath();
        g2.moveTo(top[j][0], top[j][1]); g2.lineTo(top[j + 1][0], top[j + 1][1]);
        g2.lineTo(base[j + 1][0], base[j + 1][1]); g2.lineTo(base[j][0], base[j][1]);
        g2.closePath();
        g2.fillStyle = 'rgb(' + (gv - 6) + ',' + (gv + 4) + ',' + (gv + 12) + ')';
        g2.fill();
      }
      ellipse3(g2, f.x, f.y, m.Hz, m.fanR);
      g2.strokeStyle = 'rgba(100,130,150,0.4)'; g2.lineWidth = 1; g2.stroke();
      ellipse3(g2, f.x, f.y, m.fanTopZ, m.fanR);
      g2.fillStyle = '#25333D'; g2.fill();
      g2.strokeStyle = 'rgba(140,180,200,0.7)'; g2.lineWidth = 1.3; g2.stroke();
      ellipse3(g2, f.x, f.y, m.fanTopZ, m.fanR * 0.82);
      g2.strokeStyle = 'rgba(120,150,170,0.45)'; g2.lineWidth = 1; g2.stroke();

      var hub = m.proj(f.x, f.y, m.fanTopZ);
      var rot = (reduced ? 0 : tick * 0.03) + f.x * 2;
      g2.save();
      g2.strokeStyle = 'rgba(150,180,200,0.6)';
      g2.lineWidth = 2.2; g2.lineCap = 'round';
      for (var b = 0; b < 5; b++) {
        var ang = rot + b / 5 * 6.2832;
        g2.beginPath(); g2.moveTo(hub[0], hub[1]);
        for (var k = 1; k <= 6; k++) {
          var rr = m.fanR * 0.78 * k / 6;
          var aa = ang + k * 0.2;
          var s2 = m.proj(f.x + Math.cos(aa) * rr, f.y + Math.sin(aa) * rr, m.fanTopZ);
          g2.lineTo(s2[0], s2[1]);
        }
        g2.stroke();
      }
      g2.restore(); g2.lineCap = 'butt';
      g2.fillStyle = '#7E93A2';
      g2.beginPath(); g2.arc(hub[0], hub[1], Math.max(2, m.u * 0.13), 0, 6.2832); g2.fill();

      if (meshShow > 0.02) {
        g2.save();
        g2.globalAlpha = Math.min(1, meshShow);
        var mz = m.fanTopZ + 0.2;
        for (var ri = 1; ri <= 4; ri++) {
          ellipse3(g2, f.x, f.y, mz, m.fanR * ri / 4);
          g2.strokeStyle = 'rgba(86,200,223,' + (0.35 + 0.4 * active) + ')';
          g2.lineWidth = 1; g2.stroke();
        }
        g2.strokeStyle = 'rgba(86,200,223,' + (0.3 + 0.4 * active) + ')';
        g2.lineWidth = 1;
        for (var sI = 0; sI < 12; sI++) {
          var sa = sI / 12 * 6.2832;
          var cc = m.proj(f.x, f.y, mz);
          var ee = m.proj(f.x + Math.cos(sa) * m.fanR, f.y + Math.sin(sa) * m.fanR, mz);
          g2.beginPath(); g2.moveTo(cc[0], cc[1]); g2.lineTo(ee[0], ee[1]); g2.stroke();
        }
        if (active) {
          g2.globalCompositeOperation = 'lighter';
          g2.globalAlpha = 0.22 * meshShow;
          var cc2 = m.proj(f.x, f.y, mz);
          g2.drawImage(spC, cc2[0] - m.fanR * m.u * 1.3, cc2[1] - m.fanR * m.u,
                       m.fanR * m.u * 2.6, m.fanR * m.u * 2.0);
        }
        g2.restore();
      }
    }

    function drawBasin(g2, level) {
      var m = macro, P = m.proj, bz = -m.basinH;
      var x0 = -0.28, y0 = -0.28, x1 = m.Wx + 0.28, y1 = m.Wy + 0.5;
      var B0 = P(x1, y0, 0), C0 = P(x1, y1, 0), D0 = P(x0, y1, 0);
      var Bb = P(x1, y0, bz), Cb = P(x1, y1, bz), Db = P(x0, y1, bz);

      var sA = P(x0, y0, bz), sC = P(x1, y1, bz);
      var scx = (sA[0] + sC[0]) / 2, scy = (sA[1] + sC[1]) / 2 + m.u * 0.3;
      var srx = Math.abs(P(x1, y0, bz)[0] - P(x0, y1, bz)[0]) * 0.62;
      g2.save();
      g2.translate(scx, scy); g2.scale(1, 0.3);
      var sg = g2.createRadialGradient(0, 0, 0, 0, 0, srx);
      sg.addColorStop(0, 'rgba(2,6,10,0.5)'); sg.addColorStop(1, 'rgba(2,6,10,0)');
      g2.fillStyle = sg;
      g2.beginPath(); g2.arc(0, 0, srx, 0, 6.2832); g2.fill();
      g2.restore();

      quad(g2, B0, C0, Cb, Bb, '#1A2530', 'rgba(120,150,170,0.4)', 1.1);
      quad(g2, D0, C0, Cb, Db, '#222F3A', 'rgba(120,150,170,0.4)', 1.1);

      var wl = bz + (m.basinH - 0.05) * Math.max(0.05, level);
      var wA = P(x0 + 0.05, y0 + 0.05, wl), wB = P(x1 - 0.05, y0 + 0.05, wl);
      var wC = P(x1 - 0.05, y1 - 0.05, wl), wD = P(x0 + 0.05, y1 - 0.05, wl);
      quad(g2, wA, wB, wC, wD,
        'rgba(56,150,192,' + (0.12 + 0.43 * level) + ')',
        'rgba(130,190,215,' + (0.12 + 0.33 * level) + ')', 1);

      g2.save();
      g2.globalCompositeOperation = 'lighter';
      g2.globalAlpha = (0.05 + 0.17 * level) * (0.6 + 0.4 * Math.sin(tick * 0.05));
      g2.strokeStyle = 'rgba(174,224,238,0.8)'; g2.lineWidth = 1;
      g2.beginPath(); g2.moveTo(wD[0], wD[1]); g2.lineTo(wC[0], wC[1]); g2.stroke();
      g2.restore();

      g2.strokeStyle = 'rgba(150,180,200,0.5)'; g2.lineWidth = 1.1;
      g2.beginPath();
      g2.moveTo(D0[0], D0[1]); g2.lineTo(C0[0], C0[1]); g2.lineTo(B0[0], B0[1]);
      g2.stroke();
    }

    function drawMacro(g2, o, animate) {
      var m = macro;
      var meshOn = o.mode === 'return';
      var z = o.zoom || 1;
      if (z > 1.001) {
        g2.save();
        g2.translate(W / 2, H * 0.5); g2.scale(z, z); g2.translate(-W / 2, -H * 0.5);
      }
      var topY = Math.min.apply(null, m.fanS.map(function (s) { return s.c[1]; }));

      if (animate) {
        var cap = Math.round((meshOn ? 12 : 42) * budget);
        var fresh = PLM.length === 0;
        if (PLM.length > cap) PLM.length = cap;
        while (PLM.length < cap) { var np = {}; spawnPL(np, fresh); PLM.push(np); }
        var maxR = m.fanR * m.u * 1.05;
        for (var i = 0; i < PLM.length; i++) {
          var p = PLM[i];
          p.rise += 1; p.vy *= 0.998;
          p.r = Math.min(maxR, p.r * p.gr);
          p.x += p.vx + Math.sin(tick * 0.017 + p.seed) * (meshOn ? 0.08 : 0.3);
          p.y += p.vy;
          if (p.y < topY - (meshOn ? H * 0.045 : H * 0.3)) spawnPL(p);
        }
      }

      var P = m.proj;
      drawBasin(g2, meshOn ? 1 : 0.05);

      var rfT = P(m.Wx, m.Wy * 0.5, m.Hz)[1], rfB = P(m.Wx, m.Wy * 0.5, 0)[1];
      var grR = g2.createLinearGradient(0, rfT, 0, rfB);
      grR.addColorStop(0, '#20303B'); grR.addColorStop(1, '#131E27');
      quad(g2, P(m.Wx, 0, 0), P(m.Wx, m.Wy, 0), P(m.Wx, m.Wy, m.Hz), P(m.Wx, 0, m.Hz),
        grR, 'rgba(125,155,175,0.4)', 1.1);

      var ffT = P(m.Wx * 0.5, m.Wy, m.Hz)[1], ffB = P(m.Wx * 0.5, m.Wy, 0)[1];
      var grF = g2.createLinearGradient(0, ffT, 0, ffB);
      grF.addColorStop(0, '#2A3945'); grF.addColorStop(1, '#1A2731');
      quad(g2, P(0, m.Wy, 0), P(m.Wx, m.Wy, 0), P(m.Wx, m.Wy, m.Hz), P(0, m.Wy, m.Hz),
        grF, 'rgba(125,155,175,0.4)', 1.1);

      g2.strokeStyle = 'rgba(110,140,160,0.28)'; g2.lineWidth = 1;
      for (var k = 1; k < 12; k++) {
        var zz = m.Hz * k / 12;
        var a1 = P(m.Wx, 0, zz), b1 = P(m.Wx, m.Wy, zz);
        g2.beginPath(); g2.moveTo(a1[0], a1[1]); g2.lineTo(b1[0], b1[1]); g2.stroke();
        var c1 = P(0, m.Wy, zz), d1 = P(m.Wx, m.Wy, zz);
        g2.beginPath(); g2.moveTo(c1[0], c1[1]); g2.lineTo(d1[0], d1[1]); g2.stroke();
      }

      g2.strokeStyle = 'rgba(105,135,155,0.3)'; g2.lineWidth = 1;
      for (var k2 = 1; k2 < 3; k2++) {
        var yy = m.Wy * k2 / 3;
        var a2 = P(m.Wx, yy, 0), b2 = P(m.Wx, yy, m.Hz);
        g2.beginPath(); g2.moveTo(a2[0], a2[1]); g2.lineTo(b2[0], b2[1]); g2.stroke();
        var xx = m.Wx * k2 / 3;
        var c2 = P(xx, m.Wy, 0), d2 = P(xx, m.Wy, m.Hz);
        g2.beginPath(); g2.moveTo(c2[0], c2[1]); g2.lineTo(d2[0], d2[1]); g2.stroke();
      }

      g2.strokeStyle = 'rgba(125,155,175,0.45)'; g2.lineWidth = 1.3;
      [[m.Wx, 0], [m.Wx, m.Wy], [0, m.Wy]].forEach(function (pt) {
        var a3 = P(pt[0], pt[1], 0), b3 = P(pt[0], pt[1], m.Hz);
        g2.beginPath(); g2.moveTo(a3[0], a3[1]); g2.lineTo(b3[0], b3[1]); g2.stroke();
      });

      quad(g2, P(0, 0, m.Hz), P(m.Wx, 0, m.Hz), P(m.Wx, m.Wy, m.Hz), P(0, m.Wy, m.Hz),
        '#2C3B47', 'rgba(140,175,195,0.5)', 1.2);

      g2.strokeStyle = 'rgba(90,120,140,0.22)'; g2.lineWidth = 1;
      for (var k3 = 1; k3 < 6; k3++) {
        var x3 = m.Wx * k3 / 6;
        var a4 = P(x3, 0, m.Hz), b4 = P(x3, m.Wy, m.Hz);
        g2.beginPath(); g2.moveTo(a4[0], a4[1]); g2.lineTo(b4[0], b4[1]); g2.stroke();
      }

      var hpy = m.Wy * 0.84, hpz = m.Hz + 0.09;
      var hA = P(0.18, hpy, hpz), hB = P(m.Wx - 0.18, hpy, hpz);
      g2.lineCap = 'round';
      g2.strokeStyle = 'rgba(15,24,32,0.9)'; g2.lineWidth = m.u * 0.12 + 1.6;
      g2.beginPath(); g2.moveTo(hA[0], hA[1]); g2.lineTo(hB[0], hB[1]); g2.stroke();
      g2.strokeStyle = '#4E6979'; g2.lineWidth = Math.max(1.4, m.u * 0.12);
      g2.beginPath(); g2.moveTo(hA[0], hA[1]); g2.lineTo(hB[0], hB[1]); g2.stroke();
      g2.strokeStyle = 'rgba(15,24,32,0.85)'; g2.lineWidth = Math.max(1.2, m.u * 0.1);
      m.fans.forEach(function (f) {
        var r1 = P(f.x, hpy, hpz), r2 = P(f.x, f.y + m.fanR * 0.95, hpz);
        g2.beginPath(); g2.moveTo(r1[0], r1[1]); g2.lineTo(r2[0], r2[1]); g2.stroke();
      });
      g2.lineCap = 'butt';

      g2.strokeStyle = 'rgba(130,165,185,0.55)'; g2.lineWidth = 1;
      [[[0, m.Wy], [m.Wx, m.Wy]], [[m.Wx, 0], [m.Wx, m.Wy]]].forEach(function (ed) {
        var s = ed[0], e = ed[1];
        var tA = P(s[0], s[1], m.Hz + 0.24), tB = P(e[0], e[1], m.Hz + 0.24);
        g2.beginPath(); g2.moveTo(tA[0], tA[1]); g2.lineTo(tB[0], tB[1]); g2.stroke();
        for (var i = 0; i <= 6; i++) {
          var x = s[0] + (e[0] - s[0]) * i / 6, y = s[1] + (e[1] - s[1]) * i / 6;
          var a5 = P(x, y, m.Hz), b5 = P(x, y, m.Hz + 0.24);
          g2.beginPath(); g2.moveTo(a5[0], a5[1]); g2.lineTo(b5[0], b5[1]); g2.stroke();
        }
      });

      var meshShow = meshOn ? 1 : (o.meshShow || 0);
      m.fans.forEach(function (f) { drawFan(g2, f, meshOn ? 1 : 0, meshShow); });

      g2.save();
      g2.globalCompositeOperation = 'lighter';
      if (animate) {
        for (var pl = 0; pl < PLM.length; pl++) {
          var pp = PLM[pl];
          var hf = Math.min(1, pp.rise / (meshOn ? 60 : 140));
          var alpha = meshOn ? 0.06 * (1 - hf) + 0.012 : 0.06 * (1 - hf * 0.85);
          g2.globalAlpha = Math.max(0.008, alpha);
          g2.drawImage(meshOn ? spC : spW, pp.x - pp.r, pp.y - pp.r, pp.r * 2, pp.r * 2);
        }
      } else {
        m.fanS.forEach(function (f, idx) {
          for (var i = 0; i < 5; i++) {
            var fy = i / 5;
            var rr = m.fanR * m.u * (0.35 + fy * 0.8);
            g2.globalAlpha = 0.09 * (1 - fy);
            g2.drawImage(meshOn ? spC : spW,
              f.c[0] - rr + ((i * 37) % 16 - 8), f.c[1] - fy * H * 0.16 - rr, rr * 2, rr * 2);
          }
        });
      }
      g2.restore();
      if (z > 1.001) g2.restore();

      if (ANNOTATE) {
        var fpx = Math.max(10, Math.round(11 * Math.min(W, H) / 640));
        g2.font = '400 ' + fpx + "px 'IBM Plex Mono', monospace";
        g2.textAlign = 'center';
        g2.fillStyle = meshOn ? 'rgba(86,200,223,0.9)' : 'rgba(150,180,200,0.85)';
        g2.fillText(
          meshOn ? 'CIRCULAR COLLECTOR ARRAYS — CAPTURING' : 'DRIFT LOSS → ATMOSPHERE',
          W * 0.5, Math.max(H * 0.085, topY - H * 0.12)
        );
        g2.textAlign = 'left';
      }
    }

    function setHud(key, text) {
      if (!hud[key] || lastHud[key] === text) return;
      lastHud[key] = text;
      hud[key].textContent = text;
    }

    /* ---- frame ---- */
    function draw(animate) {
      var p = progress();
      var iv = ss(p, 0.005, 0.15);
      var sp = Math.max(0, Math.min(1, (p * 6 - 1) / 5));
      var stg = Math.max(0, Math.min(5, Math.round(sp * 5)));

      var microIn = ss(sp, 0.11, 0.17), microOut = 1 - ss(sp, 0.85, 0.91);
      var microA = microIn * microOut;
      var lossA = 1 - ss(sp, 0.11, 0.17);
      var retA = ss(sp, 0.85, 0.91);
      var zoomLoss = 1 + 0.45 * ss(sp, 0.02, 0.14);
      var eIn = ss(sp, 0.33, 0.41), chargeR = ss(sp, 0.36, 0.50);
      var fieldR = ss(sp, 0.52, 0.66), collectR = ss(sp, 0.70, 0.82);
      var brIn = ss(sp, 0.17, 0.24), recFrac = ss(sp, 0.88, 1.0);

      if (intro) {
        intro.style.opacity = (1 - iv).toFixed(3);
        intro.style.transform = 'scale(' + (1 + INTRO_ZOOM * iv).toFixed(3) + ')';
        intro.style.visibility = iv > 0.98 ? 'hidden' : 'visible';
        /* Promote the layer only while it is genuinely mid-transition. Leaving
           `will-change` on a full-viewport element permanently costs a
           composited layer for the entire session. */
        var animating = iv > 0.001 && iv < 0.999;
        if (animating !== introAnimating) {
          introAnimating = animating;
          intro.classList.toggle('is-animating', animating);
        }
      }
      fadeEls.forEach(function (el) { el.style.opacity = iv.toFixed(3); });
      if (hudPanel) hudPanel.style.opacity = iv.toFixed(3);
      if (skipFloat) {
        var so = iv * (1 - ss(p, 0.96, 1));
        skipFloat.style.opacity = so.toFixed(3);
        skipFloat.style.visibility = so < 0.02 ? 'hidden' : 'visible';
      }

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(120,150,170,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gx = 56; gx < W; gx += 56) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
      for (var gy = 56; gy < H; gy += 56) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
      ctx.stroke();

      var scenes = [];
      if (lossA > 0.005) scenes.push({ a: lossA, fn: function (gg) { drawMacro(gg, { mode: 'loss', zoom: zoomLoss, meshShow: 0 }, animate); } });
      if (microA > 0.005) scenes.push({ a: microA, fn: function (gg) { drawMicro(gg, { eIn: eIn, chargeR: chargeR, fieldR: fieldR, brIn: brIn }, animate); } });
      if (retA > 0.005) scenes.push({ a: retA, fn: function (gg) { drawMacro(gg, { mode: 'return', zoom: 1, meshShow: 1, recFrac: recFrac }, animate); } });

      if (scenes.length === 1) {
        ctx.globalAlpha = scenes[0].a;
        scenes[0].fn(ctx);
        ctx.globalAlpha = 1;
      } else if (scenes.length > 1) {
        var ly = getLayers();
        scenes.forEach(function (s, idx) {
          var l = ly[idx];
          if (!l) return;
          l.cx.clearRect(0, 0, W, H);
          s.fn(l.cx);
          ctx.globalAlpha = s.a;
          ctx.drawImage(l.cv, 0, 0, W, H);
        });
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      for (var ci = 0; ci < captions.length; ci++) {
        var center = ci / 5;
        var a = 1 - Math.min(1, Math.abs(sp - center) * 5);
        a = a * a * (3 - 2 * a) * iv;
        captions[ci].style.opacity = a.toFixed(3);
        captions[ci].style.transform = 'translateY(' + ((1 - a) * 14).toFixed(1) + 'px)';
        captions[ci].style.visibility = a < 0.01 ? 'hidden' : 'visible';
      }

      /* Every DOM write below invalidates style for its element. Rewriting the
         same string 60 times a second is pure cost, so each one only lands when
         the value has actually changed. */
      if (stg !== lastStage) {
        for (var ri = 0; ri < rails.length; ri++) {
          rails[ri].classList.toggle('is-active', ri === stg);
        }
        if (hud.phase) hud.phase.textContent = PHASES[stg];
        lastStage = stg;
      }
      setHud('v', (10 * chargeR).toFixed(1) + ' kV');
      setHud('i', (0.010 * chargeR).toFixed(3) + ' mA');
      setHud('g', '×' + (1 + 7 * fieldR).toFixed(1));
      // 7,400 L/day is the midpoint of the 4,000–10,000 L/day per-installation
      // range quoted in the caption and the .tech__summary panels. Volume is
      // stated in litres everywhere on this site; do not reintroduce m³.
      setHud('r', Math.round(7400 * Math.max(recFrac, collectR * 0.2)).toLocaleString('en-US') + ' L/d');

      var rpo = ss(sp, 0.86, 0.93);
      if (returnPanel) returnPanel.style.opacity = rpo.toFixed(3);
      if (railWrap) railWrap.style.opacity = (iv * (1 - rpo)).toFixed(3);
      if (recEl) recEl.textContent = Math.round(7400 * recFrac).toLocaleString('en-US');
      if (barA) barA.style.width = (6 + 94 * recFrac).toFixed(0) + '%';

      tick++;
    }

    fit();
    onResize(function () { fit(); draw(!reduced); });

    if (reduced) {
      window.addEventListener('scroll', function () { draw(false); }, { passive: true });
      draw(false);
      return;
    }

    var running = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { running = es[0].isIntersecting; })
        .observe(stage);
    }
    /* On a phone the simulation shares a core with the compositor that is
       already handling the drag. Capping it to ~30fps leaves that headroom, and
       at this particle density the motion is indistinguishable from 60. */
    var minFrame = smallScreen || lowCore ? 32 : 0;
    var prevFrame = 0;
    var raf = 0;
    (function loop(ts) {
      raf = requestAnimationFrame(loop);
      if (!running) return;
      if (minFrame && ts - prevFrame < minFrame) return;
      prevFrame = ts || 0;
      draw(true);
    })(0);
    window.addEventListener('pagehide', function () { cancelAnimationFrame(raf); });
  })();

  /* ========================================================================
     Helpers
     ====================================================================== */
  function toArray(nodeList) {
    return Array.prototype.slice.call(nodeList);
  }

  /* Resize handler shared by both canvases. Mobile browsers fire `resize` every
     time the URL bar slides away; re-fitting a canvas on those is both
     expensive and visually wrong, so height-only changes under a threshold are
     ignored. */
  function onResize(fn) {
    var lastW = window.innerWidth;
    var lastH = window.innerHeight;
    var timer = 0;
    window.addEventListener('resize', function () {
      var dw = Math.abs(window.innerWidth - lastW);
      var dh = Math.abs(window.innerHeight - lastH);
      if (dw === 0 && dh < 140) return;
      lastW = window.innerWidth;
      lastH = window.innerHeight;
      clearTimeout(timer);
      timer = setTimeout(fn, 150);
    }, { passive: true });
  }
})();
