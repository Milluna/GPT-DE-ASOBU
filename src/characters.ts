export type CharacterId = "lumi" | "mio" | "sena";

export type HairStyle = "side-pony" | "soft-bob" | "twin-tail";

export interface CharacterPalette {
  hair: string;
  hairShadow: string;
  outfit: string;
  outfitAccent: string;
  eye: string;
  ribbon: string;
  glow: string;
  panel: string;
}

export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  romanName: string;
  epithet: string;
  description: string;
  quote: string;
  symbol: string;
  hairStyle: HairStyle;
  palette: CharacterPalette;
}

export const CHARACTER_DEFINITIONS: readonly CharacterDefinition[] = [
  {
    id: "lumi",
    name: "ルミ",
    romanName: "LUMI",
    epithet: "きらめきエース",
    description: "軽やかなステップと星のような笑顔。王道かわいい、最初のひとり。",
    quote: "負ける気しないっ♪",
    symbol: "✦",
    hairStyle: "side-pony",
    palette: {
      hair: "#ef91c1",
      hairShadow: "#8f4d94",
      outfit: "#fff7fb",
      outfitAccent: "#8f80ff",
      eye: "#765ee8",
      ribbon: "#72f0dc",
      glow: "#ff7eb9",
      panel: "#4b2c64",
    },
  },
  {
    id: "mio",
    name: "ミオ",
    romanName: "MIO",
    epithet: "涼風トリックスター",
    description: "透明感のあるミントカラー。涼しい顔で、くるりと相手を翻弄する。",
    quote: "追いつけるかな？",
    symbol: "◆",
    hairStyle: "soft-bob",
    palette: {
      hair: "#77d8d1",
      hairShadow: "#327f8c",
      outfit: "#f5fffd",
      outfitAccent: "#4b91ec",
      eye: "#2f83c7",
      ribbon: "#ff9fc7",
      glow: "#72f0dc",
      panel: "#224e63",
    },
  },
  {
    id: "sena",
    name: "セナ",
    romanName: "SENA",
    epithet: "陽だまりスマッシャー",
    description: "蜂蜜色のツインテールと元気なオレンジ。一直線に距離を詰める熱血タイプ。",
    quote: "本気、見せよっか！",
    symbol: "●",
    hairStyle: "twin-tail",
    palette: {
      hair: "#f2bd68",
      hairShadow: "#b66d4f",
      outfit: "#fff8ed",
      outfitAccent: "#ff765f",
      eye: "#b85f55",
      ribbon: "#ffd65d",
      glow: "#ff8c69",
      panel: "#6a3d45",
    },
  },
];

export const DEFAULT_CHARACTER_ID: CharacterId = "lumi";

const CHARACTER_IDS = new Set<CharacterId>(
  CHARACTER_DEFINITIONS.map((character) => character.id),
);

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && CHARACTER_IDS.has(value as CharacterId);
}

export function getCharacterDefinition(
  id: CharacterId | null | undefined,
): CharacterDefinition {
  return (
    CHARACTER_DEFINITIONS.find((character) => character.id === id) ??
    CHARACTER_DEFINITIONS[0]!
  );
}
