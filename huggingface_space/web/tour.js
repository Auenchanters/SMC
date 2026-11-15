/* Guided tour, shared by both pages. Each page calls startTour({key, steps}) where a step is
   {target: CSS selector or null for a centred card, title, text, enter: optional function run before the step}.
   Everything but the target is dimmed and blurred; the clear hole moves from part to part. */
const Tour = (() => {
  let steps = [], key = '', i = 0, open = false, lastFocus = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const app = document.getElementById('app');
  const veil = document.createElement('div'); veil.className = 'tour-veil';
  const ring = document.createElement('div'); ring.className = 'tour-ring';
  const card = document.createElement('div'); card.className = 'tour-card';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tourTitle');
  card.innerHTML = `<div class="tour-meta"><span class="over" id="tourCount"></span><button class="tour-skip" id="tourSkip">Skip tour</button></div>
    <div class="tour-bar"><i id="tourBar"></i></div>
    <h2 id="tourTitle"></h2><p id="tourText"></p>
    <div class="tour-nav"><button class="btn" id="tourBack">Back</button><button class="go tour-next" id="tourNext"><span id="tourNextText">Next</span><span aria-hidden="true">→</span></button></div>`;
  document.body.append(veil, ring, card);
  const $t = id => card.querySelector('#' + id);
  const find = sel => [...document.querySelectorAll(sel)].find(e => e.getClientRects().length); /* first visible match */

  /* four blurred panels around the spotlight; no clip-path cut-out, which some renderers draw wrongly */
  veil.innerHTML = '<i></i><i></i><i></i><i></i>';
  const [pt, pb, pl, pr] = veil.children;
  const box = (e, x, y, w, h) => Object.assign(e.style, { left: x + 'px', top: y + 'px', width: Math.max(w, 0) + 'px', height: Math.max(h, 0) + 'px' });
  function hole(r) {
    const W = innerWidth, H = innerHeight;
    if (!r) { box(pt, 0, 0, W, H); box(pb, 0, H, W, 0); box(pl, 0, 0, 0, 0); box(pr, W, 0, 0, 0); return; }
    const x = r.left, y = r.top, x2 = x + r.width, y2 = y + r.height;
    box(pt, 0, 0, W, y); box(pb, 0, y2, W, H - y2); box(pl, 0, y, x, r.height); box(pr, x2, y, W - x2, r.height);
  }
  function rectOf(el) {
    const b = el.getBoundingClientRect(), pad = 6, top = el.closest(".top") ? -4 : 56; /* never under the top bar, unless the part is in it */
    const y = Math.max(b.top - pad, top + 4), y2 = Math.min(b.bottom + pad, innerHeight - 4);
    return { left: Math.max(b.left - pad, 4), top: y, width: Math.min(b.width + pad * 2, innerWidth - 8), height: Math.max(y2 - y, 40) };
  }
  function place() {
    const s = steps[i], el = s.target && find(s.target);
    const phone = innerWidth < 760;
    if (!el) { hole(null); ring.style.opacity = 0; card.classList.add('centre'); card.style.left = card.style.top = ''; return; }
    card.classList.remove('centre');
    const r = rectOf(el); hole(r);
    Object.assign(ring.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', opacity: 1 });
    if (phone) { card.style.left = card.style.top = ''; return; } /* phone: card docks at the bottom (CSS) */
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14;
    let left, top;
    if (innerWidth - (r.left + r.width) > cw + gap * 2) { left = r.left + r.width + gap; top = r.top; }      /* right of the part */
    else if (r.left > cw + gap * 2) { left = r.left - cw - gap; top = r.top; }                                /* left of it */
    else if (innerHeight - (r.top + r.height) > ch + gap) { left = r.left; top = r.top + r.height + gap; }   /* below */
    else if (r.top - 56 > ch + gap) { left = r.left; top = r.top - ch - gap; }                                /* above */
    else { left = r.left + r.width - cw - 16; top = r.top + r.height - ch - 16; }                             /* inside, bottom right */
    card.style.left = Math.min(Math.max(left, 12), innerWidth - cw - 12) + 'px';
    card.style.top = Math.min(Math.max(top, 64), innerHeight - ch - 12) + 'px';
  }
  function go(n) {
    i = Math.max(0, Math.min(n, steps.length - 1));
    const s = steps[i];
    if (s.enter) s.enter();
    $t('tourCount').textContent = `Step ${i + 1} of ${steps.length}`;
    $t('tourBar').style.width = ((i + 1) / steps.length * 100) + '%';
    $t('tourTitle').textContent = s.title; $t('tourText').textContent = s.text;
    $t('tourBack').disabled = i === 0;
    $t('tourNextText').textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
    const el = s.target && find(s.target);
    if (el) {
      const b = el.getBoundingClientRect(), phone = innerWidth < 760;
      const room = phone ? innerHeight - card.offsetHeight - 70 : innerHeight - 70;
      if (b.top < 64 || b.bottom > 56 + room) el.scrollIntoView({ block: phone || b.height > room ? 'start' : 'center', behavior: 'auto' });
      if (phone) scrollBy(0, -64);
    }
    place(); setTimeout(place, 60); /* again once layout settles after the scroll */
    $t('tourNext').focus({ preventScroll: true });
  }
  function close(done) {
    open = false; document.documentElement.classList.remove('touring'); app.inert = false;
    if (done) try { localStorage.setItem(key, '1'); } catch (e) {}
    if (steps.onEnd) steps.onEnd();
    (lastFocus || document.body).focus?.();
  }
  $t('tourNext').onclick = () => i === steps.length - 1 ? close(true) : go(i + 1);
  $t('tourBack').onclick = () => go(i - 1);
  $t('tourSkip').onclick = () => close(true);
  addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') close(true);
    else if (e.key === 'ArrowRight') $t('tourNext').click();
    else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
    else if (e.key === 'Tab') { /* keep focus inside the card */
      const f = [...card.querySelectorAll('button:not([disabled])')], a = f.indexOf(document.activeElement);
      e.preventDefault(); f[(a + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  addEventListener('resize', () => open && place());
  addEventListener('scroll', () => open && place(), { passive: true });
  new ResizeObserver(() => open && place()).observe(document.body); /* fonts or content changing the layout */
  return {
    start(cfg, at = 0) {
      steps = cfg.steps; steps.onEnd = cfg.onEnd; key = cfg.key; open = true; lastFocus = document.activeElement;
      document.documentElement.classList.add('touring'); app.inert = true;
      for (let j = 0; j < at; j++) steps[j].enter?.(); /* a later start still sets up the page as the earlier steps would */
      go(at);
    },
    firstVisit(cfg) {
      const m = location.hash.match(/tour=(\d+)/);
      if (m) return this.start(cfg, +m[1] - 1);
      let seen = false; try { seen = localStorage.getItem(cfg.key) === '1'; } catch (e) {}
      if (!seen) setTimeout(() => this.start(cfg), 600);
    }
  };
})();
