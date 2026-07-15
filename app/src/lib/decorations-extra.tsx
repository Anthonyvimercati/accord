import type { ReactNode } from 'react';
import type { AvatarDecoration, ProfileEffect } from './decorations';

function Decoration({ className, children }: { className: string; children: ReactNode }) {
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

function MoonMoths() {
  return (
    <Decoration className="avatar-decoration--moon-moths">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <path className="extra-moon" d="M86 13a27 27 0 1 0 19 40A31 31 0 1 1 86 13Z" />
        <g className="extra-moth extra-moth--one">
          <path d="m21 40 8-6-2 10 2 9-8-5-8 5 2-9-2-10Z" />
          <circle cx="21" cy="44" r="1.8" />
        </g>
        <g className="extra-moth extra-moth--two">
          <path d="m93 77 7-5-2 9 2 8-7-4-7 4 2-8-2-9Z" />
          <circle cx="93" cy="81" r="1.6" />
        </g>
        <path className="extra-moon-orbit" d="M10 72c18 35 71 47 100 10" />
      </svg>
    </Decoration>
  );
}

function CrystalBloom() {
  return (
    <Decoration className="avatar-decoration--crystal-bloom">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <g className="extra-crystals">
          <path d="m12 85 11-22 9 20-8 23Z" />
          <path d="m26 98 12-29 12 26-9 18Z" />
          <path d="m78 95 12-27 10 25-7 18Z" />
          <path d="m94 87 9-20 8 18-5 19Z" />
          <path d="m51 15 9-11 9 11-9 10Z" />
        </g>
        <circle className="extra-crystal-ring" cx="60" cy="60" r="50" />
      </svg>
    </Decoration>
  );
}

function EmberWings() {
  return (
    <Decoration className="avatar-decoration--ember-wings">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <g className="extra-wing extra-wing--left">
          <path d="M47 84C30 79 12 65 7 43c16 5 26 13 34 24-4-13-3-25 3-36 8 18 10 34 3 53Z" />
          <path d="M39 78C26 70 19 59 15 49" />
        </g>
        <g className="extra-wing extra-wing--right">
          <path d="M73 84c17-5 35-19 40-41-16 5-26 13-34 24 4-13 3-25-3-36-8 18-10 34-3 53Z" />
          <path d="M81 78c13-8 20-19 24-29" />
        </g>
        <path className="extra-ember-gem" d="m60 96 9 9-9 12-9-12Z" />
      </svg>
    </Decoration>
  );
}

function OceanTide() {
  return (
    <Decoration className="avatar-decoration--ocean-tide">
      <span className="extra-tide extra-tide--one" />
      <span className="extra-tide extra-tide--two" />
      {[1, 2, 3, 4].map((index) => (
        <i key={index} className={`extra-bubble extra-bubble--${index}`} />
      ))}
    </Decoration>
  );
}

function ForestSpirit() {
  return (
    <Decoration className="avatar-decoration--forest-spirit">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <path
          className="extra-vine"
          d="M13 101C5 68 9 36 35 13M107 101c8-33 4-65-22-88"
        />
        <g className="extra-leaves">
          <path d="M10 75c15-7 20 2 18 12-12 1-19-3-18-12Z" />
          <path d="M16 45c15-8 21 1 19 12-12 1-19-3-19-12Z" />
          <path d="M110 75c-15-7-20 2-18 12 12 1 19-3 18-12Z" />
          <path d="M104 45c-15-8-21 1-19 12 12 1 19-3 19-12Z" />
        </g>
        <circle className="extra-spirit-light" cx="60" cy="10" r="5" />
      </svg>
    </Decoration>
  );
}

function FrostShards() {
  return (
    <Decoration className="avatar-decoration--frost-shards">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <g className="extra-frost-shards">
          <path d="M13 38 4 20l20 8 8 18Z" />
          <path d="m89 21 18-12-6 22-14 10Z" />
          <path d="m8 91 20-7 8 18-22 10Z" />
          <path d="m91 87 21 5-16 18-13-10Z" />
          <path d="m60 3 7 13-7 11-7-11Z" />
        </g>
        <circle className="extra-frost-ring" cx="60" cy="60" r="49" />
      </svg>
    </Decoration>
  );
}

function HeartRibbon() {
  return (
    <Decoration className="avatar-decoration--heart-ribbon">
      <svg viewBox="0 0 120 120" className="avatar-decoration__svg">
        <path
          className="extra-ribbon"
          d="M8 84c25 24 79 24 104-1l-9-9c-20 18-65 19-86 0Z"
        />
        <path className="extra-ribbon-tail" d="m17 74-9 25 19-5M103 73l9 25-19-5" />
        <path
          className="extra-heart"
          d="M60 21c-8-13-26-7-24 7 2 12 24 24 24 24s22-12 24-24c2-14-16-20-24-7Z"
        />
      </svg>
    </Decoration>
  );
}

function PixelPortal() {
  return (
    <Decoration className="avatar-decoration--pixel-portal">
      <span className="extra-pixel-ring extra-pixel-ring--one" />
      <span className="extra-pixel-ring extra-pixel-ring--two" />
      {[1, 2, 3, 4, 5, 6].map((index) => (
        <i key={index} className={`extra-pixel extra-pixel--${index}`} />
      ))}
    </Decoration>
  );
}

function Effect({ className, children }: { className: string; children: ReactNode }) {
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

function MoonClouds() {
  return (
    <Effect className="profile-effect--moon-clouds">
      <span className="extra-profile-moon" />
      <span className="extra-cloud extra-cloud--one" />
      <span className="extra-cloud extra-cloud--two" />
      <span className="extra-cloud extra-cloud--three" />
    </Effect>
  );
}

function DeepSea() {
  return (
    <Effect className="profile-effect--deep-sea">
      <span className="extra-caustic extra-caustic--one" />
      <span className="extra-caustic extra-caustic--two" />
      {[1, 2, 3, 4, 5, 6].map((index) => (
        <i key={index} className={`extra-sea-bubble extra-sea-bubble--${index}`} />
      ))}
    </Effect>
  );
}

function SoftRain() {
  return (
    <Effect className="profile-effect--soft-rain">
      {Array.from({ length: 10 }, (_, index) => (
        <i key={index} className={`extra-rain extra-rain--${index + 1}`} />
      ))}
      <span className="extra-rain-glow" />
    </Effect>
  );
}

function HoloGrid() {
  return (
    <Effect className="profile-effect--holo-grid">
      <span className="extra-holo-plane" />
      <span className="extra-holo-scan" />
      <span className="extra-holo-orb extra-holo-orb--one" />
      <span className="extra-holo-orb extra-holo-orb--two" />
    </Effect>
  );
}

function Fireflies() {
  return (
    <Effect className="profile-effect--fireflies">
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} className={`extra-firefly extra-firefly--${index + 1}`} />
      ))}
      <span className="extra-forest-haze" />
    </Effect>
  );
}

function Snowfall() {
  return (
    <Effect className="profile-effect--snowfall">
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} className={`extra-snow extra-snow--${index + 1}`} />
      ))}
      <span className="extra-frost-glow" />
    </Effect>
  );
}

function InkBloom() {
  return (
    <Effect className="profile-effect--ink-bloom">
      <span className="extra-ink extra-ink--one" />
      <span className="extra-ink extra-ink--two" />
      <span className="extra-ink extra-ink--three" />
      <span className="extra-ink-grain" />
    </Effect>
  );
}

function CosmicPortal() {
  return (
    <Effect className="profile-effect--cosmic-portal">
      <span className="extra-portal extra-portal--one" />
      <span className="extra-portal extra-portal--two" />
      <span className="extra-portal extra-portal--three" />
      <span className="extra-portal-core" />
    </Effect>
  );
}

export const EXTRA_AVATAR_DECORATIONS = [
  {
    id: 'moon_moths',
    label: { fr: 'Papillons lunaires', en: 'Moon Moths' },
    render: () => <MoonMoths />,
  },
  {
    id: 'crystal_bloom',
    label: { fr: 'Floraison cristal', en: 'Crystal Bloom' },
    render: () => <CrystalBloom />,
  },
  {
    id: 'ember_wings',
    label: { fr: 'Ailes de braise', en: 'Ember Wings' },
    render: () => <EmberWings />,
  },
  {
    id: 'ocean_tide',
    label: { fr: 'Marée', en: 'Ocean Tide' },
    render: () => <OceanTide />,
  },
  {
    id: 'forest_spirit',
    label: { fr: 'Esprit sylvestre', en: 'Forest Spirit' },
    render: () => <ForestSpirit />,
  },
  {
    id: 'frost_shards',
    label: { fr: 'Éclats polaires', en: 'Frost Shards' },
    render: () => <FrostShards />,
  },
  {
    id: 'heart_ribbon',
    label: { fr: 'Ruban cœur', en: 'Heart Ribbon' },
    render: () => <HeartRibbon />,
  },
  {
    id: 'pixel_portal',
    label: { fr: 'Portail pixel', en: 'Pixel Portal' },
    render: () => <PixelPortal />,
  },
] as const satisfies readonly AvatarDecoration[];

export const EXTRA_PROFILE_EFFECTS = [
  {
    id: 'moon_clouds',
    label: { fr: 'Clair de lune', en: 'Moonlight' },
    render: () => <MoonClouds />,
  },
  {
    id: 'deep_sea',
    label: { fr: 'Grand bleu', en: 'Deep Sea' },
    render: () => <DeepSea />,
  },
  {
    id: 'soft_rain',
    label: { fr: 'Pluie douce', en: 'Soft Rain' },
    render: () => <SoftRain />,
  },
  {
    id: 'holo_grid',
    label: { fr: 'Hologramme', en: 'Hologram' },
    render: () => <HoloGrid />,
  },
  {
    id: 'fireflies',
    label: { fr: 'Lucioles', en: 'Fireflies' },
    render: () => <Fireflies />,
  },
  { id: 'snowfall', label: { fr: 'Neige', en: 'Snowfall' }, render: () => <Snowfall /> },
  {
    id: 'ink_bloom',
    label: { fr: 'Encre vivante', en: 'Living Ink' },
    render: () => <InkBloom />,
  },
  {
    id: 'cosmic_portal',
    label: { fr: 'Portail cosmique', en: 'Cosmic Portal' },
    render: () => <CosmicPortal />,
  },
] as const satisfies readonly ProfileEffect[];
