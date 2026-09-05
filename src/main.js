(() => {
  const d = document, root = d.documentElement;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // theme
  const btn = d.querySelector('[data-theme-toggle]');
  const current = () => root.dataset.theme || (mq.matches ? 'dark' : 'light');
  const apply = (t) => {
    root.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch {}
    btn && btn.setAttribute('aria-pressed', String(t === 'dark'));
  };
  if (btn) {
    btn.setAttribute('aria-pressed', String(current() === 'dark'));
    btn.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
  }

  // print / save as PDF
  d.querySelectorAll('[data-print]').forEach((b) => { b.hidden = false; b.addEventListener('click', () => window.print()); });

  // copy buttons
  if (navigator.clipboard) {
    d.querySelectorAll('[data-copy]').forEach((b) => {
      b.hidden = false;
      const label = b.textContent;
      b.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
          b.dataset.state = 'copied'; b.textContent = b.dataset.copied;
          setTimeout(() => { delete b.dataset.state; b.textContent = label; }, 1500);
        } catch {}
      });
    });
  }

  // remember language choice
  d.querySelectorAll('[data-lang-switch]').forEach((a) =>
    a.addEventListener('click', () => { try { localStorage.setItem('lang', a.dataset.langSwitch); } catch {} })
  );

  // reveal on scroll (whole sections, subtle)
  const els = d.querySelectorAll('.sec, .intro');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0.02 });
    els.forEach((e) => io.observe(e));
  }

  // scroll spy: top nav + rail nav + mobile menu
  const links = [...d.querySelectorAll('a[data-spy]')];
  const secs = [...new Set(links.map((a) => a.dataset.spy))].map((id) => d.getElementById(id)).filter(Boolean);
  if (secs.length && 'IntersectionObserver' in window) {
    let active = null;
    const setActive = (id) => {
      if (id === active) return; active = id;
      links.forEach((a) => (a.dataset.spy === id ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
    };
    const spy = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis.length) setActive(vis[0].target.id);
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.1, 0.5] });
    secs.forEach((s) => spy.observe(s));
    setActive(secs[0].id);
    // bottom of page → last section
    addEventListener('scroll', () => {
      if (innerHeight + scrollY >= d.body.offsetHeight - 2) setActive(secs[secs.length - 1].id);
    }, { passive: true });
  }

  // close mobile menu after choosing a section
  const menu = d.querySelector('details.menu');
  menu && menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => menu.removeAttribute('open')));
  d.addEventListener('click', (e) => { if (menu && menu.open && !menu.contains(e.target)) menu.removeAttribute('open'); });
})();
