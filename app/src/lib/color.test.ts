/** Tests de la conversion sûre des couleurs de profil (`0xRRGGBB` → `#rrggbb`). */

import { describe, expect, it } from 'vitest';
import { profileColorCss } from './color';

describe('profileColorCss', () => {
  it('convertit un entier 0xRRGGBB en #rrggbb', () => {
    expect(profileColorCss(0x5865f2)).toBe('#5865f2');
  });

  it('conserve les zéros de tête', () => {
    expect(profileColorCss(0x0000ff)).toBe('#0000ff');
    expect(profileColorCss(0)).toBe('#000000');
  });

  it('rend `null` pour `null`', () => {
    expect(profileColorCss(null)).toBeNull();
  });

  it('rend `null` pour `undefined`', () => {
    expect(profileColorCss(undefined)).toBeNull();
  });

  it('ramène toute valeur hors 24 bits aux bits utiles sans exception', () => {
    expect(profileColorCss(0x1ffffff)).toBe('#ffffff');
    expect(profileColorCss(-1)).toBe('#ffffff');
  });

  it('rend `null` pour une valeur non finie (donnée pair non fiable)', () => {
    expect(profileColorCss(Number.NaN)).toBeNull();
    expect(profileColorCss(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
