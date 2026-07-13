import type { MessageTabs } from "../types";

const STORAGE_KEY = "aori-room.messages.v1";
const MAX_MESSAGE_LENGTH = 40;

const DEFAULT_TABS: MessageTabs = [
  ["よろしく！", "ナイス！", "ありがとう", "やるね〜", "もう一回！", "おつかれ！"],
  ["見てる？", "こっちこっち", "まだまだ！", "その動き好き", "追いつける？", "ぐるぐる〜"],
  ["びっくりした？", "落ち着いて〜", "今の見た？", "かわいいね", "全力で来て！", "また遊ぼう"],
];

function cloneTabs(tabs: MessageTabs): MessageTabs {
  return tabs.map((tab) => [...tab]) as MessageTabs;
}

function normalizeMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_MESSAGE_LENGTH);
  return clean || fallback;
}

function isTabArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length === 6;
}

export class MessageStore {
  load(): MessageTabs {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneTabs(DEFAULT_TABS);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every(isTabArray)) {
        return cloneTabs(DEFAULT_TABS);
      }
      return parsed.map((tab, tabIndex) =>
        tab.map((value, index) => {
          const fallback = DEFAULT_TABS[tabIndex]?.[index] ?? "メッセージ";
          return normalizeMessage(value, fallback);
        }),
      ) as MessageTabs;
    } catch {
      return cloneTabs(DEFAULT_TABS);
    }
  }

  save(tabs: MessageTabs): MessageTabs {
    const normalized = tabs.map((tab, tabIndex) =>
      tab.map((value, index) => {
        const fallback = DEFAULT_TABS[tabIndex]?.[index] ?? "メッセージ";
        return normalizeMessage(value, fallback);
      }),
    ) as MessageTabs;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return cloneTabs(normalized);
  }

  reset(): MessageTabs {
    localStorage.removeItem(STORAGE_KEY);
    return cloneTabs(DEFAULT_TABS);
  }
}

export { DEFAULT_TABS, MAX_MESSAGE_LENGTH };
