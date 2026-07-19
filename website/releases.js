/*
 * Accord — page Nouveautés : les versions sont tirées des releases GitHub,
 * plus de liste à maintenir à la main. Progressif : si l'API ne répond pas
 * (hors ligne, limite de débit), le contenu statique de la page reste.
 * Sécurité : le Markdown des notes est rendu en construisant le DOM
 * (textContent partout) — jamais d'injection HTML.
 */
(() => {
  const doc = document;
  const conteneur = doc.querySelector('[data-releases]');
  if (!conteneur) return;
  const lang = (doc.documentElement.lang || 'fr').slice(0, 2);
  const fr = lang === 'fr';

  /* --- Rendu inline sûr : **gras**, `code`, [texte](https://…). --- */
  const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  const inline = (texte, cible) => {
    let reste = texte;
    let m;
    INLINE.lastIndex = 0;
    let dernier = 0;
    while ((m = INLINE.exec(reste)) !== null) {
      if (m.index > dernier) cible.append(reste.slice(dernier, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) {
        const b = doc.createElement('strong');
        b.textContent = tok.slice(2, -2);
        cible.append(b);
      } else if (tok.startsWith('`')) {
        const c = doc.createElement('code');
        c.textContent = tok.slice(1, -1);
        cible.append(c);
      } else {
        const fin = tok.indexOf(']');
        const a = doc.createElement('a');
        a.textContent = tok.slice(1, fin);
        a.href = m[2];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        cible.append(a);
      }
      dernier = m.index + tok.length;
    }
    if (dernier < reste.length) cible.append(reste.slice(dernier));
  };

  /* --- Corps Markdown (sous-ensemble des notes de release) → DOM.
     Gère aussi les blocs présents dans nos notes : code clôturé ``` et
     <details>/<summary> (repli « Install notes »). Tout autre balisage HTML
     est réduit à son texte — jamais interprété. --- */
  const rendreCorps = (md, racine) => {
    let cible = racine; // <article> ou <details> ouvert
    let ul = null;
    let courant = null; // dernier <li> ou <p> (lignes de continuation)
    let code = null; // <code> du bloc clôturé en cours
    const stripHtml = (s) => s.replace(/<[^>]*>/g, '');
    for (const brute of md.split(/\r?\n/)) {
      const ligne = brute.replace(/\s+$/, '');
      if (code !== null) {
        if (/^\s*```/.test(ligne)) {
          code = null;
        } else {
          code.append(brute + '\n');
        }
        continue;
      }
      if (/^\s*```/.test(ligne)) {
        ul = null;
        courant = null;
        const pre = doc.createElement('pre');
        code = doc.createElement('code');
        pre.append(code);
        cible.append(pre);
        continue;
      }
      const nette = ligne.trim();
      if (nette === '<details>') {
        ul = null;
        courant = null;
        cible = doc.createElement('details');
        racine.append(cible);
        continue;
      }
      if (nette === '</details>') {
        ul = null;
        courant = null;
        cible = racine;
        continue;
      }
      const resume = nette.match(/^<summary>(.*)<\/summary>$/);
      if (resume) {
        const s = doc.createElement('summary');
        s.textContent = stripHtml(resume[1]);
        cible.prepend(s);
        continue;
      }
      if (nette === '' || /^\[[^\]]+\]:\s/.test(nette)) {
        courant = null;
        continue;
      }
      const titre = ligne.match(/^#{2,4}\s+(.*)/);
      if (titre) {
        ul = null;
        courant = null;
        const h = doc.createElement('h3');
        inline(stripHtml(titre[1]), h);
        cible.append(h);
        continue;
      }
      const puce = ligne.match(/^\s*[-*]\s+(.*)/);
      if (puce) {
        if (!ul) {
          ul = doc.createElement('ul');
          cible.append(ul);
        }
        courant = doc.createElement('li');
        inline(stripHtml(puce[1]), courant);
        ul.append(courant);
        continue;
      }
      if (/^\s{2,}/.test(brute) && courant) {
        courant.append(' ');
        inline(stripHtml(nette), courant);
        continue;
      }
      ul = null;
      courant = doc.createElement('p');
      inline(stripHtml(nette), courant);
      cible.append(courant);
    }
  };

  fetch('https://api.github.com/repos/Gomouu/accord/releases?per_page=15')
    .then((r) => (r.ok ? r.json() : null))
    .then((releases) => {
      if (!Array.isArray(releases)) return;
      const publiees = releases.filter((r) => !r.draft && !r.prerelease);
      if (publiees.length === 0) return;

      const frag = doc.createDocumentFragment();
      const note = doc.createElement('p');
      note.style.cssText = 'color:var(--faint);font-size:0.88rem';
      note.textContent = fr
        ? 'Liste tirée en direct des releases GitHub (notes rédigées en anglais).'
        : 'Pulled live from the GitHub releases.';
      frag.append(note);

      for (const rel of publiees) {
        const art = doc.createElement('article');
        art.className = 'release';
        const tete = doc.createElement('div');
        tete.className = 'release__head';
        const version = doc.createElement('span');
        version.className = 'release__version';
        version.textContent = (rel.tag_name || '').replace(/^v/, '');
        const date = doc.createElement('span');
        date.className = 'release__date';
        date.textContent = rel.published_at
          ? new Date(rel.published_at).toLocaleDateString(fr ? 'fr-FR' : 'en-US', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : '';
        const lien = doc.createElement('a');
        lien.className = 'release__link';
        lien.href = rel.html_url;
        lien.textContent = fr ? 'Release GitHub →' : 'GitHub release →';
        tete.append(version, date, lien);
        art.append(tete);
        rendreCorps(rel.body || '', art);
        frag.append(art);
      }
      conteneur.replaceChildren(frag);
    })
    .catch(() => {
      /* API injoignable : le contenu statique de secours reste affiché. */
    });
})();
