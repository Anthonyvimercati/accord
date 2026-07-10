/**
 * Tests du recadrage d'avatar : géométrie pure du carré centré, du recadreur
 * interactif (échelle de couverture, contrainte de position, rectangle source)
 * et du calcul d'octets base64.
 */

import { describe, expect, it } from 'vitest';
import {
  AVATAR_COTE_PX,
  cadrerCarre,
  contraindreDecalage,
  echelleCouverture,
  octetsBase64,
  rectangleSource,
} from './image';

describe('cadrerCarre', () => {
  it('prélève un carré centré dans une image paysage', () => {
    const cadrage = cadrerCarre(1000, 600);

    expect(cadrage.cote).toBe(600);
    expect(cadrage.sx).toBe(200);
    expect(cadrage.sy).toBe(0);
  });

  it('prélève un carré centré dans une image portrait', () => {
    const cadrage = cadrerCarre(600, 1000);

    expect(cadrage.cote).toBe(600);
    expect(cadrage.sx).toBe(0);
    expect(cadrage.sy).toBe(200);
  });

  it('réduit le côté cible à 256 px pour une grande image', () => {
    expect(cadrerCarre(1000, 600).cible).toBe(AVATAR_COTE_PX);
  });

  it('n’agrandit jamais une petite image', () => {
    const cadrage = cadrerCarre(100, 80);

    expect(cadrage.cote).toBe(80);
    expect(cadrage.cible).toBe(80);
  });

  it('reste stable sur une image déjà carrée', () => {
    const cadrage = cadrerCarre(256, 256);

    expect(cadrage).toEqual({ sx: 0, sy: 0, cote: 256, cible: 256 });
  });

  it('tolère des dimensions dégénérées (jamais de côté nul)', () => {
    expect(cadrerCarre(0, 0).cote).toBe(1);
    expect(cadrerCarre(0, 0).cible).toBe(1);
  });
});

describe('echelleCouverture', () => {
  it('couvre un cadre carré depuis le plus petit côté (paysage)', () => {
    // Le plus petit côté (hauteur 600) doit atteindre 300 px de cadre.
    expect(echelleCouverture(1000, 600, 300, 300)).toBeCloseTo(0.5);
  });

  it('couvre un cadre carré depuis le plus petit côté (portrait)', () => {
    expect(echelleCouverture(600, 1000, 300, 300)).toBeCloseTo(0.5);
  });

  it('gère une image carrée dans un cadre carré', () => {
    expect(echelleCouverture(500, 500, 300, 300)).toBeCloseTo(0.6);
  });

  it('ne divise jamais par zéro sur une dimension nulle', () => {
    expect(Number.isFinite(echelleCouverture(0, 0, 300, 300))).toBe(true);
  });

  it('couvre un cadre paysage : la largeur pilote (image carrée)', () => {
    // Cadre 300×100 : largeur 300/600 = 0.5 domine hauteur 100/600 ≈ 0.167.
    expect(echelleCouverture(600, 600, 300, 100)).toBeCloseTo(0.5);
  });

  it('couvre un cadre paysage : la hauteur pilote (image très large)', () => {
    // Cadre 300×100 : hauteur 100/100 = 1 domine largeur 300/900 ≈ 0.333.
    expect(echelleCouverture(900, 100, 300, 100)).toBeCloseTo(1);
  });
});

describe('contraindreDecalage (cadre carré)', () => {
  const CADRE = 300;

  it('paysage au zoom 1 : bloque l’axe couvrant, borne l’axe débordant', () => {
    // echelle 0.5 → 500×300 : hauteur pile, largeur déborde de 200.
    const ech = echelleCouverture(1000, 600, CADRE, CADRE);
    expect(contraindreDecalage({ x: 1000, y: 50 }, 1000, 600, CADRE, CADRE, ech)).toEqual(
      { x: 0, y: 0 },
    );
    expect(contraindreDecalage({ x: -9999, y: 0 }, 1000, 600, CADRE, CADRE, ech)).toEqual(
      { x: -200, y: 0 },
    );
  });

  it('portrait au zoom 1 : borne l’axe vertical, bloque l’horizontal', () => {
    const ech = echelleCouverture(600, 1000, CADRE, CADRE);
    expect(
      contraindreDecalage({ x: 40, y: -9999 }, 600, 1000, CADRE, CADRE, ech),
    ).toEqual({ x: 0, y: -200 });
  });

  it('zoom 2 : autorise le pan dans les deux axes jusqu’aux bords', () => {
    // echelle 1.0 → 1000×600 dans un cadre 300 : marges 700 et 300.
    const ech = echelleCouverture(1000, 600, CADRE, CADRE) * 2;
    expect(contraindreDecalage({ x: 100, y: 100 }, 1000, 600, CADRE, CADRE, ech)).toEqual(
      {
        x: 0,
        y: 0,
      },
    );
    expect(
      contraindreDecalage({ x: -5000, y: -5000 }, 1000, 600, CADRE, CADRE, ech),
    ).toEqual({ x: -700, y: -300 });
    expect(
      contraindreDecalage({ x: -350, y: -150 }, 1000, 600, CADRE, CADRE, ech),
    ).toEqual({ x: -350, y: -150 });
  });

  it('centre une image plus petite que le cadre (cas dégénéré)', () => {
    // echelle 0.5 sur 200×200 → 100×100 : centré à (100, 100).
    expect(contraindreDecalage({ x: 0, y: 0 }, 200, 200, CADRE, CADRE, 0.5)).toEqual({
      x: 100,
      y: 100,
    });
  });
});

describe('contraindreDecalage (cadre paysage / bannière)', () => {
  // Cadre bannière 300×100 (ratio 3:1) : chaque axe est borné indépendamment.
  const CADRE_W = 300;
  const CADRE_H = 100;

  it('borne le seul axe vertical quand la largeur est pile couverte', () => {
    // Image 600×600, echelle 0.5 → 300×300 : largeur pile, hauteur déborde 200.
    const ech = echelleCouverture(600, 600, CADRE_W, CADRE_H); // 0.5
    expect(
      contraindreDecalage({ x: 50, y: -9999 }, 600, 600, CADRE_W, CADRE_H, ech),
    ).toEqual({ x: 0, y: -200 });
    expect(contraindreDecalage({ x: 0, y: 0 }, 600, 600, CADRE_W, CADRE_H, ech)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('borne le seul axe horizontal quand la hauteur est pile couverte', () => {
    // Image 900×100, echelle 1.0 → 900×100 : hauteur pile, largeur déborde 600.
    const ech = echelleCouverture(900, 100, CADRE_W, CADRE_H); // 1.0
    expect(
      contraindreDecalage({ x: -9999, y: 50 }, 900, 100, CADRE_W, CADRE_H, ech),
    ).toEqual({ x: -600, y: 0 });
  });
});

describe('rectangleSource (cadre carré)', () => {
  const CADRE = 300;

  it('paysage au zoom 1 centré : coïncide avec le carré centré', () => {
    const ech = echelleCouverture(1000, 600, CADRE, CADRE); // 0.5
    // Décalage centré sur l'axe débordant : (300 - 500) / 2 = -100.
    const rect = rectangleSource({ x: -100, y: 0 }, CADRE, CADRE, ech);
    expect(rect.largeur).toBeCloseTo(600);
    expect(rect.hauteur).toBeCloseTo(600);
    expect(rect.sx).toBeCloseTo(200);
    expect(rect.sy).toBeCloseTo(0);
    // Même prélèvement que cadrerCarre pour une image déjà bien placée.
    expect(rect.sx).toBeCloseTo(cadrerCarre(1000, 600).sx);
  });

  it('portrait au zoom 1 centré : prélève le carré médian', () => {
    const ech = echelleCouverture(600, 1000, CADRE, CADRE); // 0.5
    const rect = rectangleSource({ x: 0, y: -100 }, CADRE, CADRE, ech);
    expect(rect.largeur).toBeCloseTo(600);
    expect(rect.hauteur).toBeCloseTo(600);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(200);
  });

  it('zoom 2 au coin haut-gauche : petite fenêtre à l’origine', () => {
    const ech = echelleCouverture(1000, 600, CADRE, CADRE) * 2; // 1.0
    const rect = rectangleSource({ x: 0, y: 0 }, CADRE, CADRE, ech);
    expect(rect.largeur).toBeCloseTo(300);
    expect(rect.hauteur).toBeCloseTo(300);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(0);
  });

  it('zoom 2 au coin bas-droit : fenêtre translatée dans la source', () => {
    const ech = echelleCouverture(1000, 600, CADRE, CADRE) * 2; // 1.0
    const rect = rectangleSource({ x: -700, y: -300 }, CADRE, CADRE, ech);
    expect(rect.largeur).toBeCloseTo(300);
    expect(rect.hauteur).toBeCloseTo(300);
    expect(rect.sx).toBeCloseTo(700);
    expect(rect.sy).toBeCloseTo(300);
  });
});

describe('rectangleSource (cadre paysage / bannière)', () => {
  const CADRE_W = 300;
  const CADRE_H = 100;

  it('prélève un rectangle au ratio du cadre (3:1)', () => {
    // Image 600×600, echelle 0.5 → 300×300 : hauteur débordante centrée à -100.
    const ech = echelleCouverture(600, 600, CADRE_W, CADRE_H); // 0.5
    const rect = rectangleSource({ x: 0, y: -100 }, CADRE_W, CADRE_H, ech);
    expect(rect.largeur).toBeCloseTo(600);
    expect(rect.hauteur).toBeCloseTo(200);
    // Ratio paysage préservé (3:1) pour un encodage sans distorsion.
    expect(rect.largeur / rect.hauteur).toBeCloseTo(CADRE_W / CADRE_H);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(200);
  });
});

describe('octetsBase64', () => {
  it('compte les octets décodés sans remplissage', () => {
    expect(octetsBase64('QUJD')).toBe(3); // "ABC"
  });

  it('tient compte du remplissage « = »', () => {
    expect(octetsBase64('QUI=')).toBe(2); // "AB"
    expect(octetsBase64('QQ==')).toBe(1); // "A"
  });

  it('rend zéro sur une chaîne vide', () => {
    expect(octetsBase64('')).toBe(0);
  });
});
