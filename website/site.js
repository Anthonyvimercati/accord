/*
 * Accord — animations et téléchargement direct.
 * Progressif : sans JS (ou si l'API GitHub ne répond pas), les liens
 * pointent déjà vers la page des releases.
 */
(() => {
  const doc = document;
  const lang = (doc.documentElement.lang || 'fr').slice(0, 2);
  const fr = lang === 'fr';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Révélation au défilement (délai échelonné via style="--d:…"). */
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.12 },
  );
  doc.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* Compteurs animés. */
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const cio = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        cio.unobserve(e.target);
        const el = e.target;
        const target = Number(el.dataset.count);
        const suffix = el.dataset.suffix || '';
        if (reduced || !Number.isFinite(target)) {
          el.textContent = target + suffix;
          continue;
        }
        const t0 = performance.now();
        const dur = 1300;
        const tick = (t) => {
          const p = Math.min(1, (t - t0) / dur);
          el.textContent = Math.round(target * easeOut(p)) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.5 },
  );
  doc.querySelectorAll('[data-count]').forEach((el) => cio.observe(el));

  /* Parallaxe très douce de la capture du hero. */
  const heroImg = doc.querySelector('.showcase--hero img');
  if (heroImg && !reduced) {
    let raf = 0;
    addEventListener(
      'scroll',
      () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          heroImg.style.transform = `translateY(${Math.min(26, window.scrollY * 0.045)}px)`;
        });
      },
      { passive: true },
    );
  }

  /* Détection de l'OS : met en avant la carte correspondante tout de suite. */
  const ua = navigator.userAgent;
  const os = /Macintosh|Mac OS X/.test(ua)
    ? 'mac'
    : /Windows/.test(ua)
      ? 'win'
      : /Linux/.test(ua) && !/Android/.test(ua)
        ? 'linux'
        : null;
  if (os) {
    const card = doc.querySelector(`[data-card="${os}"]`);
    if (card) {
      card.classList.add('dl-card--mine');
      const badge = doc.createElement('span');
      badge.className = 'dl-card__badge';
      badge.textContent = fr ? 'Votre système' : 'Your system';
      card.appendChild(badge);
    }
  }

  /* Liens de téléchargement directs depuis la dernière release GitHub. */
  const fmtSize = (bytes) => {
    const mo = bytes / (1024 * 1024);
    const n = mo >= 100 ? Math.round(mo) : Math.round(mo * 10) / 10;
    return fr ? `${String(n).replace('.', ',')} Mo` : `${n} MB`;
  };
  const OS_NAMES = { mac: 'macOS', win: 'Windows', linux: 'Linux' };

  fetch('https://api.github.com/repos/Gomouu/accord/releases/latest')
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      if (!rel || !Array.isArray(rel.assets)) return;
      const find = (re) => rel.assets.find((a) => re.test(a.name));
      const main = {
        mac: find(/\.dmg$/),
        win: find(/-setup\.exe$/) || find(/\.msi$/),
        linux: find(/\.AppImage$/) || find(/\.deb$/),
      };
      const alts = {
        mac: [],
        win: [find(/\.msi$/)].filter(Boolean),
        linux: [find(/\.deb$/), find(/\.rpm$/)].filter(Boolean),
      };
      const version = (rel.tag_name || '').replace(/^v/, '');

      for (const [key, asset] of Object.entries(main)) {
        if (!asset) continue;
        doc.querySelectorAll(`[data-dl="${key}"]`).forEach((a) => {
          a.href = asset.browser_download_url;
          const meta = a.closest('.dl-card')?.querySelector('.dl-meta');
          if (meta) meta.textContent = `v${version} · ${fmtSize(asset.size)}`;
        });
        const altBox = doc.querySelector(`[data-alt="${key}"]`);
        if (altBox && alts[key].length > 0) {
          altBox.textContent = fr ? 'ou : ' : 'or: ';
          alts[key].forEach((x, i) => {
            if (i > 0) altBox.append(' · ');
            const link = doc.createElement('a');
            link.href = x.browser_download_url;
            link.textContent = `.${x.name.split('.').pop()} (${fmtSize(x.size)})`;
            altBox.append(link);
          });
        }
      }

      if (version) {
        doc.querySelectorAll('[data-version]').forEach((el) => {
          el.textContent = version;
        });
      }
      if (rel.published_at) {
        const s = new Date(rel.published_at).toLocaleDateString(fr ? 'fr-FR' : 'en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        doc.querySelectorAll('[data-reldate]').forEach((el) => {
          el.textContent = s;
        });
      }

      /* CTA du hero : lien direct pour l'OS détecté. */
      if (os && main[os]) {
        const hero = doc.querySelector('[data-hero-dl]');
        if (hero) {
          hero.href = main[os].browser_download_url;
          hero.childNodes[0].textContent = fr
            ? `Télécharger pour ${OS_NAMES[os]} `
            : `Download for ${OS_NAMES[os]} `;
          const sub = hero.querySelector('.btn__sub');
          if (sub) sub.textContent = `v${version} · ${fmtSize(main[os].size)}`;
        }
      }
    })
    .catch(() => {
      /* Hors ligne ou limité : les liens statiques vers les releases suffisent. */
    });
})();
