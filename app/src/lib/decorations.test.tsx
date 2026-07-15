import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_DECORATIONS,
  PROFILE_EFFECTS,
  decorationById,
  effectById,
} from './decorations';

describe('catalogue de personnalisation', () => {
  it('expose des identifiants uniques et compatibles avec le protocole', () => {
    const ids = [
      ...AVATAR_DECORATIONS.map((item) => item.id),
      ...PROFILE_EFFECTS.map((item) => item.id),
    ];

    expect(AVATAR_DECORATIONS).toHaveLength(14);
    expect(PROFILE_EFFECTS).toHaveLength(12);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_-]{1,24}$/);
    }
  });

  it('résout les nouveaux choix et ignore les identifiants inconnus', () => {
    expect(decorationById('moon_moths')?.label.fr).toBe('Papillons lunaires');
    expect(effectById('cosmic_portal')?.label.en).toBe('Cosmic Portal');
    expect(decorationById('<style>')).toBeUndefined();
    expect(effectById('missing')).toBeUndefined();
  });

  it('rend les nouvelles familles sans contenu interactif', () => {
    render(
      <div>
        {decorationById('crystal_bloom')?.render(80)}
        {effectById('fireflies')?.render()}
      </div>,
    );

    expect(screen.getByTestId('avatar-decoration')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.getByTestId('profile-effect')).toHaveAttribute('aria-hidden', 'true');
  });
});
