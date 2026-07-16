import { describe, expect, it } from 'vitest';
import { applySlashCommand } from './slashCommands';

describe('applySlashCommand — /shrug', () => {
  it('sans texte : la frimousse seule', () => {
    expect(applySlashCommand('/shrug')).toBe('¯\\_(ツ)_/¯');
  });

  it('avec texte : ajouté avant la frimousse', () => {
    expect(applySlashCommand('/shrug osef')).toBe('osef ¯\\_(ツ)_/¯');
  });
});

describe('applySlashCommand — /tableflip', () => {
  it('sans texte', () => {
    expect(applySlashCommand('/tableflip')).toBe('(╯°□°)╯︵ ┻━┻');
  });

  it('avec texte', () => {
    expect(applySlashCommand('/tableflip grr')).toBe('grr (╯°□°)╯︵ ┻━┻');
  });
});

describe('applySlashCommand — /unflip', () => {
  it('sans texte', () => {
    expect(applySlashCommand('/unflip')).toBe('┬─┬ ノ( ゜-゜ノ)');
  });

  it('avec texte', () => {
    expect(applySlashCommand('/unflip bon')).toBe('bon ┬─┬ ノ( ゜-゜ノ)');
  });
});

describe('applySlashCommand — /me', () => {
  it('avec texte : action en italique', () => {
    expect(applySlashCommand('/me observe au loin')).toBe('*observe au loin*');
  });

  it("sans texte : italique vide plutôt qu'un rejet", () => {
    expect(applySlashCommand('/me')).toBe('**');
  });
});

describe('applySlashCommand — /spoiler', () => {
  it('avec texte : enrobé de spoiler markdown', () => {
    expect(applySlashCommand('/spoiler le majordome')).toBe('||le majordome||');
  });

  it('sans texte', () => {
    expect(applySlashCommand('/spoiler')).toBe('||||');
  });
});

describe('applySlashCommand — passthrough', () => {
  it('commande inconnue : envoyée telle quelle', () => {
    expect(applySlashCommand('/foo bar')).toBe('/foo bar');
  });

  it('« / » seul : envoyé tel quel', () => {
    expect(applySlashCommand('/')).toBe('/');
  });

  it('message normal sans commande : inchangé', () => {
    expect(applySlashCommand('bonjour tout le monde')).toBe('bonjour tout le monde');
  });

  it('mention ou emoji personnalisé en tête : jamais confondu avec une commande', () => {
    expect(applySlashCommand('@Alice :wave:')).toBe('@Alice :wave:');
  });

  it('préfixe partiel qui ne matche aucun mot connu (mot-collé) : inchangé', () => {
    expect(applySlashCommand("/shrugging n'importe quoi")).toBe(
      "/shrugging n'importe quoi",
    );
  });

  it('espace en tête avant la commande : pas « exactement » en tête, inchangé', () => {
    expect(applySlashCommand(' /shrug osef')).toBe(' /shrug osef');
  });

  it('commande en milieu de message : inchangé (seule une commande de tête compte)', () => {
    expect(applySlashCommand('salut /shrug')).toBe('salut /shrug');
  });
});
