import type { ReactNode } from 'react';

export interface DecorationLabel {
  fr: string;
  en: string;
}

export const DECORATION_UI_TEXT = {
  decorationTitle: { fr: "Décoration d'avatar", en: 'Avatar decoration' },
  decorationHint: {
    fr: 'Une signature visuelle visible partout où ton avatar apparaît.',
    en: 'A visual signature shown everywhere your avatar appears.',
  },
  effectTitle: { fr: 'Effet de profil', en: 'Profile effect' },
  effectHint: {
    fr: 'Une atmosphère animée pour ta carte de profil.',
    en: 'An animated atmosphere for your profile card.',
  },
  preview: { fr: 'Aperçu en direct', en: 'Live preview' },
  signature: { fr: 'Signature Accord', en: 'Accord signature' },
  none: { fr: 'Aucune', en: 'None' },
  saved: { fr: 'Personnalisation enregistrée', en: 'Personalization saved' },
} as const;

export interface AvatarDecoration {
  id: string;
  label: DecorationLabel;
  render: (size: number) => ReactNode;
}

export interface ProfileEffect {
  id: string;
  label: DecorationLabel;
  render: () => ReactNode;
}

function DecorationLayer({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      data-testid="avatar-decoration"
      className={`avatar-decoration ${className}`}
    >
      {children}
    </span>
  );
}

function PrismaticHalo() {
  return (
    <DecorationLayer className="avatar-decoration--halo">
      <span className="avatar-decoration__aura" />
      <span className="avatar-decoration__ring" />
      <span className="avatar-decoration__glint avatar-decoration__glint--north" />
      <span className="avatar-decoration__glint avatar-decoration__glint--south" />
    </DecorationLayer>
  );
}

function NeonEclipse() {
  return (
    <DecorationLayer className="avatar-decoration--eclipse">
      <span className="avatar-decoration__ring" />
      <span className="avatar-decoration__arc" />
      <span className="avatar-decoration__node avatar-decoration__node--one" />
      <span className="avatar-decoration__node avatar-decoration__node--two" />
    </DecorationLayer>
  );
}

function AuroraOrbit() {
  return (
    <DecorationLayer className="avatar-decoration--orbit">
      <span className="avatar-decoration__orbit avatar-decoration__orbit--outer" />
      <span className="avatar-decoration__orbit avatar-decoration__orbit--inner" />
      <span className="avatar-decoration__comet" />
    </DecorationLayer>
  );
}

const LAUREL_LEAVES = [
  { x: 26, y: 91, angle: -28, scale: 1 },
  { x: 18, y: 81, angle: -46, scale: 0.92 },
  { x: 13, y: 69, angle: -62, scale: 0.84 },
  { x: 11, y: 56, angle: -78, scale: 0.74 },
] as const;

function LaurelBranch({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <g transform={mirrored ? 'translate(120 0) scale(-1 1)' : undefined}>
      <path
        d="M 28 98 C 12 87, 7 70, 12 48"
        fill="none"
        stroke="url(#laurel-stem)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {LAUREL_LEAVES.map((leaf) => (
        <ellipse
          key={leaf.y}
          cx={leaf.x}
          cy={leaf.y}
          rx={7 * leaf.scale}
          ry={3.2 * leaf.scale}
          fill="url(#laurel-leaf)"
          transform={`rotate(${leaf.angle} ${leaf.x} ${leaf.y})`}
        />
      ))}
    </g>
  );
}

function SolarLaurel() {
  return (
    <DecorationLayer className="avatar-decoration--laurel">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <defs>
          <linearGradient id="laurel-stem" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff1a8" />
            <stop offset="1" stopColor="#b66f18" />
          </linearGradient>
          <linearGradient id="laurel-leaf" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff3b0" />
            <stop offset="0.45" stopColor="#e2ab45" />
            <stop offset="1" stopColor="#9d5b12" />
          </linearGradient>
          <radialGradient id="laurel-gem">
            <stop stopColor="#fffbd5" />
            <stop offset="0.45" stopColor="#ffcf61" />
            <stop offset="1" stopColor="#b35a16" />
          </radialGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r="49"
          fill="none"
          stroke="url(#laurel-stem)"
          strokeWidth="2"
        />
        <LaurelBranch />
        <LaurelBranch mirrored />
        <path d="M52 104 60 98 68 104 60 112Z" fill="url(#laurel-gem)" />
      </svg>
    </DecorationLayer>
  );
}

const BLOSSOMS = [
  { x: 25, y: 24, scale: 0.82 },
  { x: 44, y: 12, scale: 1 },
  { x: 66, y: 10, scale: 0.76 },
  { x: 88, y: 21, scale: 0.92 },
] as const;

function SakuraCrest() {
  return (
    <DecorationLayer className="avatar-decoration--sakura">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <defs>
          <linearGradient id="sakura-branch" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#7b3d54" />
            <stop offset="1" stopColor="#d48aa5" />
          </linearGradient>
          <linearGradient id="sakura-petal" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff4fa" />
            <stop offset="1" stopColor="#ff86b6" />
          </linearGradient>
        </defs>
        <path
          d="M8 39 C35 7, 72 2, 111 34"
          fill="none"
          stroke="url(#sakura-branch)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        {BLOSSOMS.map((blossom) => (
          <g
            key={blossom.x}
            transform={`translate(${blossom.x} ${blossom.y}) scale(${blossom.scale})`}
          >
            {[0, 72, 144, 216, 288].map((angle) => (
              <ellipse
                key={angle}
                cy="-5"
                rx="3.4"
                ry="5.5"
                fill="url(#sakura-petal)"
                transform={`rotate(${angle})`}
              />
            ))}
            <circle r="1.8" fill="#ffd86b" />
          </g>
        ))}
        <path
          d="M98 30 C108 39, 109 49, 106 58"
          fill="none"
          stroke="url(#sakura-branch)"
          strokeWidth="1.5"
        />
        <path
          d="M104 58 C110 56, 114 59, 114 64 C109 65, 105 63, 104 58Z"
          fill="url(#sakura-petal)"
        />
      </svg>
    </DecorationLayer>
  );
}

function ArcadeCrown() {
  return (
    <DecorationLayer className="avatar-decoration--crown">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <defs>
          <linearGradient id="crown-gold" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#fff2a1" />
            <stop offset="0.5" stopColor="#f0b938" />
            <stop offset="1" stopColor="#9f5d12" />
          </linearGradient>
        </defs>
        <path
          d="M32 25 40 8 52 22 60 3 68 22 80 8 88 25 84 38H36Z"
          fill="url(#crown-gold)"
          stroke="#6f4010"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M38 31H82" stroke="#fff0a0" strokeWidth="2" strokeLinecap="round" />
        <rect
          x="56"
          y="25"
          width="8"
          height="8"
          rx="1.5"
          fill="#5eead4"
          stroke="#164e63"
          strokeWidth="1"
          transform="rotate(45 60 29)"
        />
        <path d="M17 82 24 89 17 96 10 89Z" fill="#61e7ff" />
        <path d="M103 82 110 89 103 96 96 89Z" fill="#ff6dac" />
      </svg>
    </DecorationLayer>
  );
}

export const AVATAR_DECORATIONS: readonly AvatarDecoration[] = [
  {
    id: 'soft_glow',
    label: { fr: 'Prisme', en: 'Prism' },
    render: () => <PrismaticHalo />,
  },
  {
    id: 'neon_ring',
    label: { fr: 'Éclipse', en: 'Eclipse' },
    render: () => <NeonEclipse />,
  },
  {
    id: 'aurora_ring',
    label: { fr: 'Orbite', en: 'Orbit' },
    render: () => <AuroraOrbit />,
  },
  {
    id: 'golden_laurel',
    label: { fr: 'Solaire', en: 'Solar' },
    render: () => <SolarLaurel />,
  },
  {
    id: 'sakura_arc',
    label: { fr: 'Sakura', en: 'Sakura' },
    render: () => <SakuraCrest />,
  },
  {
    id: 'pixel_crown',
    label: { fr: 'Arcade', en: 'Arcade' },
    render: () => <ArcadeCrown />,
  },
];

function EffectLayer({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      data-testid="profile-effect"
      className={`profile-effect ${className}`}
    >
      {children}
    </span>
  );
}

function AuroraEffect() {
  return (
    <EffectLayer className="profile-effect--aurora">
      <span className="profile-effect__mesh profile-effect__mesh--one" />
      <span className="profile-effect__mesh profile-effect__mesh--two" />
      <span className="profile-effect__mesh profile-effect__mesh--three" />
      <span className="profile-effect__grain" />
    </EffectLayer>
  );
}

function StarfieldEffect() {
  return (
    <EffectLayer className="profile-effect--starfield">
      <svg
        viewBox="0 0 300 220"
        preserveAspectRatio="none"
        className="profile-effect__constellation"
      >
        <path d="M18 67 72 38 119 82 177 49 231 76 282 31" />
        <path d="M42 172 96 132 151 166 217 119 275 157" />
      </svg>
      {Array.from({ length: 12 }, (_, index) => (
        <span
          key={index}
          className={`profile-effect__star profile-effect__star--${index + 1}`}
        />
      ))}
    </EffectLayer>
  );
}

function PetalsEffect() {
  return (
    <EffectLayer className="profile-effect--petals">
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          className={`profile-effect__petal-track profile-effect__petal-track--${index + 1}`}
        >
          <i className="profile-effect__petal" />
        </span>
      ))}
      <span className="profile-effect__rose-light" />
    </EffectLayer>
  );
}

function EmbersEffect() {
  return (
    <EffectLayer className="profile-effect--embers">
      <span className="profile-effect__ember-arc profile-effect__ember-arc--one" />
      <span className="profile-effect__ember-arc profile-effect__ember-arc--two" />
      {Array.from({ length: 10 }, (_, index) => (
        <span
          key={index}
          className={`profile-effect__mote profile-effect__mote--${index + 1}`}
        />
      ))}
    </EffectLayer>
  );
}

export const PROFILE_EFFECTS: readonly ProfileEffect[] = [
  { id: 'aurora', label: { fr: 'Aurore', en: 'Aurora' }, render: () => <AuroraEffect /> },
  {
    id: 'starfield',
    label: { fr: 'Constellation', en: 'Constellation' },
    render: () => <StarfieldEffect />,
  },
  {
    id: 'falling_petals',
    label: { fr: 'Pétales', en: 'Petals' },
    render: () => <PetalsEffect />,
  },
  {
    id: 'floating_particles',
    label: { fr: 'Braises', en: 'Embers' },
    render: () => <EmbersEffect />,
  },
];

const DECORATION_BY_ID = new Map(AVATAR_DECORATIONS.map((item) => [item.id, item]));
const EFFECT_BY_ID = new Map(PROFILE_EFFECTS.map((item) => [item.id, item]));

export function decorationById(
  id: string | null | undefined,
): AvatarDecoration | undefined {
  return id == null ? undefined : DECORATION_BY_ID.get(id);
}

export function effectById(id: string | null | undefined): ProfileEffect | undefined {
  return id == null ? undefined : EFFECT_BY_ID.get(id);
}
