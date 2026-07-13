import {
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  isCharacterId,
  type CharacterId,
} from "./characters";
import { TauntGame } from "./game/game";
import { createTitleScreen } from "./titleScreen";
import {
  createRoom,
  joinRoom,
  RoomClient,
  type ConnectionStatus,
} from "./network/roomClient";
import { MAX_MESSAGE_LENGTH, MessageStore } from "./settings/messageStore";
import type { MessageTabs, PlayerRole, PresenceState, RoomSession } from "./types";

const TITLE = "AORI ROOM";
const LOCAL_ROOM_CODE = "LOCAL";
const CHARACTER_STORAGE_KEY = "aori-room.character.v2";
const TAB_LABELS = ["あいさつ", "ちょい煽り", "リアクション"] as const;

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function oppositeRole(role: PlayerRole): PlayerRole {
  return role === "host" ? "guest" : "host";
}

function statusText(status: ConnectionStatus): string {
  switch (status) {
    case "connecting":
      return "接続中";
    case "connected":
      return "接続済み";
    case "reconnecting":
      return "再接続中";
    case "closed":
      return "切断";
  }
}

function roleLabel(role: PlayerRole): string {
  return role === "host" ? "ピンク" : "ミント";
}

export class App {
  private readonly root: HTMLElement;
  private readonly messageStore = new MessageStore();
  private messages: MessageTabs;
  private game: TauntGame | null = null;
  private roomClient: RoomClient | null = null;
  private activeSession: RoomSession | null = null;
  private bubbleSequence = 0;
  private toastTimer: number | null = null;
  private loadingOverlay: HTMLDivElement | null = null;
  private selectedCharacterId: CharacterId = DEFAULT_CHARACTER_ID;

  constructor(root: HTMLElement) {
    this.root = root;
    this.selectedCharacterId = this.loadSelectedCharacter();
    this.messages = this.messageStore.load();
    this.renderTitle();
  }

  private renderTitle(): void {
    this.cleanupRoom();
    this.root.replaceChildren();
    document.body.classList.remove("is-in-room");
    document.title = TITLE;

    const screen = createTitleScreen({
      selectedCharacterId: this.selectedCharacterId,
      onSelectCharacter: (characterId) => {
        this.selectedCharacterId = characterId;
        this.saveSelectedCharacter(characterId);
      },
      onCreateRoom: () => {
        void this.handleCreateRoom();
      },
      onJoinRoom: () => this.openJoinDialog(),
      onLocalDemo: () => this.startLocalDemo(),
      onSettings: () => this.renderSettings(),
    });
    this.root.append(screen);
  }

  private async handleCreateRoom(): Promise<void> {
    this.showLoading("部屋をつくっています…");
    try {
      const session = await createRoom();
      this.enterRoom(session);
    } catch (error) {
      this.hideLoading();
      this.showToast(error instanceof Error ? error.message : "部屋を作れませんでした");
    }
  }

  private openJoinDialog(): void {
    const backdrop = element("div", "modal-backdrop");
    backdrop.dataset.noStick = "true";
    const dialog = element("section", "modal-card");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "join-title");

    const title = element("h2", "modal-title", "部屋番号を入力");
    title.id = "join-title";
    const help = element("p", "modal-help", "友だちに教えてもらった5桁の数字を入れてください。");
    const input = element("input", "room-code-input");
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.maxLength = 5;
    input.placeholder = "00000";
    input.setAttribute("aria-label", "5桁の部屋番号");
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 5);
    });

    const errorText = element("p", "form-error");
    const controls = element("div", "modal-controls");
    const cancel = button("secondary-button", "もどる", () => backdrop.remove());
    const join = button("primary-button", "入室する", () => {
      void (async () => {
        errorText.textContent = "";
        if (!/^\d{5}$/.test(input.value)) {
          errorText.textContent = "5桁の数字を入力してください";
          input.focus();
          return;
        }
        join.disabled = true;
        join.textContent = "接続中…";
        try {
          const session = await joinRoom(input.value);
          backdrop.remove();
          this.enterRoom(session);
        } catch (error) {
          join.disabled = false;
          join.textContent = "入室する";
          errorText.textContent = error instanceof Error ? error.message : "入室できませんでした";
        }
      })();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") join.click();
    });
    controls.append(cancel, join);
    dialog.append(title, help, input, errorText, controls);
    backdrop.append(dialog);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) backdrop.remove();
    });
    this.root.append(backdrop);
    window.setTimeout(() => input.focus(), 50);
  }

  private startLocalDemo(): void {
    this.enterRoom({
      roomCode: LOCAL_ROOM_CODE,
      token: "",
      role: "host",
      expiresAt: Date.now() + 30 * 60 * 1000,
      localOnly: true,
    });
  }

  private enterRoom(session: RoomSession): void {
    this.hideLoading();
    this.cleanupRoom();
    this.activeSession = session;
    this.bubbleSequence = 0;
    this.root.replaceChildren();
    document.body.classList.add("is-in-room");
    document.title = session.localOnly ? `${TITLE} · 操作テスト` : `${TITLE} · ${session.roomCode}`;
    const localCharacter = getCharacterDefinition(this.selectedCharacterId);

    const screen = element("main", "game-screen");
    const mount = element("div", "game-stage");
    const overlay = element("div", "game-overlay");
    const chrome = element("div", "game-chrome");
    chrome.dataset.noStick = "true";

    const topBar = element("header", "room-header");
    const leaveButton = button("round-button round-button--leave", "‹", () => this.renderTitle());
    leaveButton.setAttribute("aria-label", "タイトルへ戻る");
    const roomIdentity = element("div", "room-identity");
    const roomLabel = element(
      "span",
      "room-identity__label",
      session.localOnly ? "操作テスト" : "ROOM",
    );
    const roomCode = element(
      "strong",
      "room-identity__code",
      session.localOnly ? "SOLO" : session.roomCode,
    );
    roomIdentity.append(roomLabel, roomCode);
    if (!session.localOnly) {
      roomIdentity.tabIndex = 0;
      roomIdentity.setAttribute("role", "button");
      roomIdentity.setAttribute("aria-label", `部屋番号 ${session.roomCode} をコピー`);
      const copyCode = () => void this.copyRoomCode(session.roomCode);
      roomIdentity.addEventListener("click", copyCode);
      roomIdentity.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") copyCode();
      });
    }
    const statusChip = element("div", "connection-chip");
    statusChip.dataset.status = session.localOnly ? "local" : "connecting";
    statusChip.append(element("i", "connection-chip__dot"));
    const statusLabel = element(
      "span",
      "connection-chip__label",
      session.localOnly ? "端末内" : "接続中",
    );
    statusChip.append(statusLabel);
    topBar.append(leaveButton, roomIdentity, statusChip);

    const participantCard = element("div", "participant-card");
    const localPill = element("span", "participant-pill participant-pill--local");
    localPill.dataset.character = localCharacter.id;
    const localSwatch = element("i", "participant-pill__swatch");
    localSwatch.style.background = `linear-gradient(135deg, ${localCharacter.palette.hair}, ${localCharacter.palette.outfitAccent})`;
    localSwatch.style.boxShadow = `0 0 12px ${localCharacter.palette.glow}`;
    localPill.append(localSwatch, document.createTextNode(`あなた・${localCharacter.name}`));
    const versus = element("span", "participant-versus", "×");
    const peerPill = element("span", "participant-pill participant-pill--peer is-waiting");
    const peerSwatch = element("i", "participant-pill__swatch");
    let remoteCharacterId: CharacterId | null = null;
    const peerText = document.createTextNode(session.localOnly ? "練習相手なし" : "待っています…");
    peerPill.append(peerSwatch, peerText);
    participantCard.append(localPill, versus, peerPill);

    const hint = element(
      "div",
      "gesture-hint",
      session.localOnly ? "画面の空いている場所をドラッグ" : "空いている場所をドラッグして移動",
    );
    hint.append(element("span", "gesture-hint__line", "円を描くとサンドリ"));

    const performanceBadge = element("div", "performance-badge", "軽量表示");
    performanceBadge.hidden = true;

    const messageButton = button("message-fab", "💬", () => {
      const isOpen = messagePanel.classList.toggle("is-open");
      messageButton.classList.toggle("is-open", isOpen);
      messageButton.setAttribute("aria-expanded", String(isOpen));
    });
    messageButton.setAttribute("aria-label", "定型メッセージを開く");
    messageButton.setAttribute("aria-expanded", "false");

    const messagePanel = this.createMessagePanel(session.role, messageButton);

    chrome.append(topBar, participantCard, hint, performanceBadge, messagePanel, messageButton);
    screen.append(mount, overlay, chrome);
    this.root.append(screen);

    let network: RoomClient | null = null;
    try {
      this.game = new TauntGame({
        mount,
        overlay,
        role: session.role,
        characterId: this.selectedCharacterId,
        onRemoteCharacter: (characterId) => {
          remoteCharacterId = characterId;
          const remoteCharacter = getCharacterDefinition(characterId);
          peerPill.dataset.character = remoteCharacter.id;
          peerSwatch.style.background = `linear-gradient(135deg, ${remoteCharacter.palette.hair}, ${remoteCharacter.palette.outfitAccent})`;
          peerSwatch.style.boxShadow = `0 0 12px ${remoteCharacter.palette.glow}`;
          if (peerPill.classList.contains("is-present")) {
            peerText.nodeValue = `${remoteCharacter.name}と対戦中`;
          }
        },
        onLocalState: (state) => network?.sendState(state),
        onPerformanceMode: (mode) => {
          performanceBadge.hidden = mode !== "reduced";
        },
      });
    } catch (error) {
      const fallback = element("div", "webgl-fallback");
      fallback.dataset.noStick = "true";
      fallback.append(
        element("div", "webgl-fallback__icon", "△"),
        element("h2", "webgl-fallback__title", "3D表示を開始できませんでした"),
        element(
          "p",
          "webgl-fallback__text",
          "Safariを最新版にしてページを開き直してください。プライベートブラウズや省電力設定を解除すると改善する場合があります。",
        ),
        button("primary-button", "タイトルへ戻る", () => this.renderTitle()),
      );
      mount.append(fallback);
      this.showToast(error instanceof Error ? error.message : "WebGLを利用できません");
      return;
    }

    if (session.localOnly) {
      this.game.setPresence({ host: true, guest: false });
      return;
    }

    const applyPresence = (presence: PresenceState): void => {
      this.game?.setPresence(presence);
      const connected = presence[oppositeRole(session.role)];
      peerPill.classList.toggle("is-waiting", !connected);
      peerPill.classList.toggle("is-present", connected);
      peerText.nodeValue = connected
        ? remoteCharacterId
          ? `${getCharacterDefinition(remoteCharacterId).name}と対戦中`
          : `${roleLabel(oppositeRole(session.role))}の友だち`
        : "待っています…";
      participantCard.classList.toggle("has-peer", connected);
      hint.firstChild!.textContent = connected
        ? "左右を細かく切り返してモーション連打"
        : "友だちに5桁の番号を共有";
      if (!connected) hint.querySelector(".gesture-hint__line")!.textContent = "待ちながら操作できます";
      else hint.querySelector(".gesture-hint__line")!.textContent = "円を描くとサンドリ";
    };

    network = new RoomClient(session, {
      onStatus: (status) => {
        statusChip.dataset.status = status;
        statusLabel.textContent = statusText(status);
      },
      onWelcome: (message) => {
        applyPresence(message.presence);
        if (message.peerState) this.game?.applyRemoteState(message.peerState);
      },
      onPresence: (message) => applyPresence(message.presence),
      onState: (message) => {
        if (message.role !== session.role) this.game?.applyRemoteState(message.state);
      },
      onBubble: (message) => {
        if (message.role !== session.role) this.game?.showBubble(message.role, message.text);
      },
      onExpired: () => {
        this.renderTitle();
        this.showToast("この部屋は終了しました");
      },
      onError: (message) => this.showToast(message),
    });
    this.roomClient = network;
    network.start();
  }

  private createMessagePanel(role: PlayerRole, fab: HTMLButtonElement): HTMLElement {
    const panel = element("section", "message-panel");
    panel.dataset.noStick = "true";
    panel.setAttribute("aria-label", "定型メッセージ");
    const handle = element("div", "message-panel__handle");
    const tabs = element("div", "message-tabs");
    const grids = element("div", "message-grids");
    let activeTab = 0;

    const renderGrid = (): void => {
      grids.replaceChildren();
      const grid = element("div", "message-grid");
      this.messages[activeTab]?.forEach((message, index) => {
        const choice = button("message-choice", message, () => {
          this.bubbleSequence += 1;
          this.game?.showBubble(role, message);
          this.roomClient?.sendBubble(message, this.bubbleSequence);
          choice.classList.remove("is-fired");
          void choice.offsetWidth;
          choice.classList.add("is-fired");
          window.setTimeout(() => choice.classList.remove("is-fired"), 220);
        });
        choice.dataset.index = String(index);
        grid.append(choice);
      });
      grids.append(grid);
    };

    TAB_LABELS.forEach((label, index) => {
      const tab = button("message-tab", label, () => {
        activeTab = index;
        tabs.querySelectorAll(".message-tab").forEach((node, nodeIndex) => {
          node.classList.toggle("is-active", nodeIndex === activeTab);
          node.setAttribute("aria-selected", String(nodeIndex === activeTab));
        });
        renderGrid();
      });
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(index === 0));
      tab.classList.toggle("is-active", index === 0);
      tabs.append(tab);
    });

    const close = button("message-panel__close", "×", () => {
      panel.classList.remove("is-open");
      fab.classList.remove("is-open");
      fab.setAttribute("aria-expanded", "false");
    });
    close.setAttribute("aria-label", "メッセージ一覧を閉じる");
    panel.append(handle, close, tabs, grids);
    renderGrid();
    return panel;
  }

  private renderSettings(): void {
    this.cleanupRoom();
    this.root.replaceChildren();
    document.body.classList.remove("is-in-room");
    document.title = `${TITLE} · メッセージ設定`;

    const screen = element("main", "settings-screen");
    const header = element("header", "settings-header");
    const back = button("round-button", "‹", () => this.renderTitle());
    back.setAttribute("aria-label", "タイトルへ戻る");
    const headingWrap = element("div", "settings-heading");
    headingWrap.append(
      element("p", "settings-heading__eyebrow", "3タブ × 6メッセージ"),
      element("h1", "settings-heading__title", "吹き出しを編集"),
    );
    header.append(back, headingWrap);

    const intro = element(
      "p",
      "settings-intro",
      `各メッセージは${MAX_MESSAGE_LENGTH}文字まで。設定はこのiPhoneのブラウザ内に保存されます。`,
    );
    const form = element("form", "settings-form");
    const draft = this.messages.map((tab) => [...tab]) as MessageTabs;

    draft.forEach((tab, tabIndex) => {
      const section = element("section", "settings-tab-card");
      const tabHeader = element("div", "settings-tab-card__header");
      tabHeader.append(
        element("span", "settings-tab-card__number", String(tabIndex + 1).padStart(2, "0")),
        element("h2", "settings-tab-card__title", TAB_LABELS[tabIndex] ?? `タブ${tabIndex + 1}`),
      );
      const fieldGrid = element("div", "settings-field-grid");
      tab.forEach((message, messageIndex) => {
        const label = element("label", "message-field");
        const fieldNumber = element("span", "message-field__number", String(messageIndex + 1));
        const input = element("input", "message-field__input");
        input.type = "text";
        input.maxLength = MAX_MESSAGE_LENGTH;
        input.value = message;
        input.autocomplete = "off";
        input.addEventListener("input", () => {
          draft[tabIndex]![messageIndex] = input.value;
        });
        label.append(fieldNumber, input);
        fieldGrid.append(label);
      });
      section.append(tabHeader, fieldGrid);
      form.append(section);
    });

    const footer = element("div", "settings-actions");
    const reset = button("secondary-button", "初期設定に戻す", () => {
      const confirmed = window.confirm("18個のメッセージを初期設定に戻しますか？");
      if (!confirmed) return;
      this.messages = this.messageStore.reset();
      this.renderSettings();
      this.showToast("初期設定に戻しました");
    });
    const save = button("primary-button", "保存してタイトルへ", () => {
      this.messages = this.messageStore.save(draft);
      this.renderTitle();
      this.showToast("メッセージを保存しました");
    });
    footer.append(reset, save);
    form.addEventListener("submit", (event) => event.preventDefault());
    screen.append(header, intro, form, footer);
    this.root.append(screen);
  }

  private loadSelectedCharacter(): CharacterId {
    try {
      const stored = localStorage.getItem(CHARACTER_STORAGE_KEY);
      return isCharacterId(stored) ? stored : DEFAULT_CHARACTER_ID;
    } catch {
      return DEFAULT_CHARACTER_ID;
    }
  }

  private saveSelectedCharacter(characterId: CharacterId): void {
    try {
      localStorage.setItem(CHARACTER_STORAGE_KEY, characterId);
    } catch {
      // Private browsing or storage limits should not block room entry.
    }
  }

  private async copyRoomCode(roomCode: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(roomCode);
      this.showToast(`部屋番号 ${roomCode} をコピーしました`);
    } catch {
      this.showToast(`部屋番号は ${roomCode} です`);
    }
  }

  private showToast(message: string): void {
    let toast = this.root.querySelector<HTMLDivElement>(".app-toast");
    if (!toast) {
      toast = element("div", "app-toast");
      toast.setAttribute("role", "status");
      toast.dataset.noStick = "true";
      this.root.append(toast);
    }
    toast.textContent = message;
    toast.classList.remove("is-visible");
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast?.classList.remove("is-visible");
      this.toastTimer = null;
    }, 2800);
  }

  private showLoading(text: string): void {
    this.hideLoading();
    const overlay = element("div", "loading-overlay");
    overlay.dataset.noStick = "true";
    const spinner = element("span", "loading-spinner");
    const label = element("p", "loading-label", text);
    overlay.append(spinner, label);
    this.root.append(overlay);
    this.loadingOverlay = overlay;
  }

  private hideLoading(): void {
    this.loadingOverlay?.remove();
    this.loadingOverlay = null;
  }

  private cleanupRoom(): void {
    this.roomClient?.stop();
    this.roomClient = null;
    this.game?.destroy();
    this.game = null;
    this.activeSession = null;
    this.hideLoading();
  }
}
