import {
  CHARACTER_DEFINITIONS,
  getCharacterDefinition,
  type CharacterDefinition,
  type CharacterId,
} from "./characters";

interface TitleScreenOptions {
  selectedCharacterId: CharacterId;
  onSelectCharacter: (characterId: CharacterId) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onLocalDemo: () => void;
  onSettings: () => void;
}

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

function actionButton(
  className: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function applyCharacterTheme(node: HTMLElement, character: CharacterDefinition): void {
  node.dataset.character = character.id;
  node.dataset.hair = character.hairStyle;
  node.style.setProperty("--char-hair", character.palette.hair);
  node.style.setProperty("--char-hair-shadow", character.palette.hairShadow);
  node.style.setProperty("--char-outfit", character.palette.outfit);
  node.style.setProperty("--char-accent", character.palette.outfitAccent);
  node.style.setProperty("--char-eye", character.palette.eye);
  node.style.setProperty("--char-ribbon", character.palette.ribbon);
  node.style.setProperty("--char-glow", character.palette.glow);
  node.style.setProperty("--char-panel", character.palette.panel);
}

function createAmbient(): HTMLElement {
  const ambient = element("div", "title-v2__ambient");
  ambient.setAttribute("aria-hidden", "true");
  ambient.append(
    element("div", "title-v2__orb title-v2__orb--one"),
    element("div", "title-v2__orb title-v2__orb--two"),
    element("div", "title-v2__grid"),
  );
  for (let index = 0; index < 18; index += 1) {
    const spark = element("i", "title-v2__spark");
    spark.style.setProperty("--spark-index", String(index));
    ambient.append(spark);
  }
  return ambient;
}

function createCharacterToken(character: CharacterDefinition): HTMLElement {
  const token = element("span", "character-token");
  applyCharacterTheme(token, character);
  token.setAttribute("aria-hidden", "true");

  const hairBack = element("i", "character-token__hair-back");
  const face = element("i", "character-token__face");
  face.append(
    element("i", "character-token__eye"),
    element("i", "character-token__eye"),
  );
  const bangs = element("i", "character-token__bangs");
  const tailLeft = element("i", "character-token__tail character-token__tail--left");
  const tailRight = element("i", "character-token__tail character-token__tail--right");
  const ribbon = element("i", "character-token__ribbon");
  token.append(hairBack, face, bangs, tailLeft, tailRight, ribbon);
  return token;
}

function createHeroCharacter(character: CharacterDefinition): HTMLElement {
  const figure = element("div", "hero-character");
  applyCharacterTheme(figure, character);
  figure.setAttribute("aria-hidden", "true");

  const aura = element("div", "hero-character__aura");
  const halo = element("div", "hero-character__halo");
  const platform = element("div", "hero-character__platform");
  const body = element("div", "hero-character__body");
  const shadow = element("div", "hero-character__shadow");

  const leftLeg = element("div", "hero-character__leg hero-character__leg--left");
  const rightLeg = element("div", "hero-character__leg hero-character__leg--right");
  const torso = element("div", "hero-character__torso");
  const collar = element("i", "hero-character__collar");
  const emblem = element("i", "hero-character__emblem", character.symbol);
  torso.append(collar, emblem);
  const skirt = element("div", "hero-character__skirt");

  const leftArm = element("div", "hero-character__arm hero-character__arm--left");
  const rightArm = element("div", "hero-character__arm hero-character__arm--right");
  const racket = element("div", "hero-character__racket");
  racket.append(element("i", "hero-character__racket-face"));
  rightArm.append(racket);

  const head = element("div", "hero-character__head");
  const hairBack = element("div", "hero-character__hair-back");
  const face = element("div", "hero-character__face");
  face.append(
    element("i", "hero-character__brow hero-character__brow--left"),
    element("i", "hero-character__brow hero-character__brow--right"),
    element("i", "hero-character__eye hero-character__eye--left"),
    element("i", "hero-character__eye hero-character__eye--right"),
    element("i", "hero-character__blush hero-character__blush--left"),
    element("i", "hero-character__blush hero-character__blush--right"),
    element("i", "hero-character__mouth"),
  );
  const bangs = element("div", "hero-character__bangs");
  const tailLeft = element("div", "hero-character__tail hero-character__tail--left");
  const tailRight = element("div", "hero-character__tail hero-character__tail--right");
  const ribbon = element("div", "hero-character__ribbon");
  head.append(hairBack, face, bangs, tailLeft, tailRight, ribbon);

  body.append(leftLeg, rightLeg, torso, skirt, leftArm, rightArm, head);
  for (let index = 0; index < 7; index += 1) {
    const shine = element("i", "hero-character__shine");
    shine.style.setProperty("--shine-index", String(index));
    figure.append(shine);
  }

  const speech = element("div", "hero-character__speech", character.quote);
  const nameplate = element("div", "hero-character__nameplate");
  nameplate.append(
    element("span", "hero-character__nameplate-symbol", character.symbol),
    element("strong", "hero-character__nameplate-name", character.name),
    element("small", "hero-character__nameplate-roman", character.romanName),
  );

  figure.append(aura, halo, platform, shadow, body, speech, nameplate);
  return figure;
}

export function createTitleScreen(options: TitleScreenOptions): HTMLElement {
  let selected = getCharacterDefinition(options.selectedCharacterId);

  const screen = element("main", "title-screen title-screen--v2");
  applyCharacterTheme(screen, selected);
  screen.append(createAmbient());

  const shell = element("div", "title-v2__shell");
  const brand = element("header", "title-v2__brand");
  const kicker = element("p", "title-v2__kicker", "TWO PLAYER 3D COMMUNICATION");
  const logo = element("h1", "title-v2__logo");
  logo.append(
    element("span", "title-v2__logo-aori", "AORI"),
    element("span", "title-v2__logo-room", "ROOM"),
  );
  const lead = element(
    "p",
    "title-v2__lead",
    "キャラを選んで、ふたりだけのコートへ。くるくる動いて、吹き出しでじゃれ合おう。",
  );
  brand.append(kicker, logo, lead);

  const showcase = element("section", "character-showcase");
  showcase.setAttribute("aria-live", "polite");
  const visualMount = element("div", "character-showcase__visual");
  let hero = createHeroCharacter(selected);
  visualMount.append(hero);

  const copy = element("div", "character-showcase__copy");
  const selectLabel = element("p", "character-showcase__label", "SELECT YOUR PLAYER");
  const selectedName = element("h2", "character-showcase__name", selected.name);
  const selectedRoman = element("span", "character-showcase__roman", selected.romanName);
  selectedName.append(selectedRoman);
  const selectedEpithet = element("p", "character-showcase__epithet", selected.epithet);
  const selectedDescription = element(
    "p",
    "character-showcase__description",
    selected.description,
  );
  const featureList = element("div", "character-showcase__features");
  featureList.append(
    element("span", "character-feature", "3Dアバター"),
    element("span", "character-feature", "個別カラー"),
    element("span", "character-feature", "相手にも同期"),
  );
  copy.append(
    selectLabel,
    selectedName,
    selectedEpithet,
    selectedDescription,
    featureList,
  );
  showcase.append(visualMount, copy);

  const rosterSection = element("section", "character-select-panel");
  const rosterHeading = element("div", "character-select-panel__heading");
  rosterHeading.append(
    element("span", "character-select-panel__step", "01"),
    element("div", "character-select-panel__heading-copy"),
  );
  const headingCopy = rosterHeading.lastElementChild as HTMLDivElement;
  headingCopy.append(
    element("h2", "character-select-panel__title", "キャラクターを選ぶ"),
    element("p", "character-select-panel__hint", "タップすると見た目とカラーが切り替わります"),
  );

  const roster = element("div", "character-roster");
  roster.setAttribute("role", "radiogroup");
  roster.setAttribute("aria-label", "キャラクター選択");
  const cards = new Map<CharacterId, HTMLButtonElement>();

  const entryPanel = element("section", "entry-panel");
  const entryHeading = element("div", "entry-panel__heading");
  entryHeading.append(
    element("span", "character-select-panel__step", "02"),
    element("h2", "entry-panel__title", "このキャラで入室"),
  );
  const createButton = actionButton(
    "entry-button entry-button--create",
    `${selected.name}で部屋をつくる`,
    options.onCreateRoom,
  );
  const joinButton = actionButton(
    "entry-button entry-button--join",
    "部屋番号で入る",
    options.onJoinRoom,
  );
  const utility = element("div", "entry-panel__utility");
  utility.append(
    actionButton("entry-utility-button", "ひとりで操作テスト", options.onLocalDemo),
    actionButton("entry-utility-button", "吹き出し設定", options.onSettings),
  );
  entryPanel.append(entryHeading, createButton, joinButton, utility);

  const selectCharacter = (characterId: CharacterId, focusCard = false): void => {
    const next = getCharacterDefinition(characterId);
    if (next.id === selected.id && !focusCard) return;
    selected = next;
    options.onSelectCharacter(next.id);
    applyCharacterTheme(screen, next);

    const nextHero = createHeroCharacter(next);
    hero.replaceWith(nextHero);
    hero = nextHero;
    selectedName.firstChild!.textContent = next.name;
    selectedRoman.textContent = next.romanName;
    selectedEpithet.textContent = next.epithet;
    selectedDescription.textContent = next.description;
    createButton.textContent = `${next.name}で部屋をつくる`;

    cards.forEach((card, id) => {
      const isSelected = id === next.id;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-checked", String(isSelected));
      card.tabIndex = isSelected ? 0 : -1;
    });
    if (focusCard) cards.get(next.id)?.focus();
  };

  CHARACTER_DEFINITIONS.forEach((character, index) => {
    const card = actionButton("character-card", "", () => selectCharacter(character.id));
    applyCharacterTheme(card, character);
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", String(character.id === selected.id));
    card.setAttribute("aria-label", `${character.name}、${character.epithet}`);
    card.tabIndex = character.id === selected.id ? 0 : -1;
    card.classList.toggle("is-selected", character.id === selected.id);
    card.append(
      element("span", "character-card__number", String(index + 1).padStart(2, "0")),
      createCharacterToken(character),
    );
    const cardCopy = element("span", "character-card__copy");
    cardCopy.append(
      element("strong", "character-card__name", character.name),
      element("small", "character-card__roman", character.romanName),
      element("span", "character-card__epithet", character.epithet),
    );
    card.append(cardCopy, element("span", "character-card__check", "✓"));
    roster.append(card);
    cards.set(character.id, card);
  });

  roster.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = CHARACTER_DEFINITIONS.findIndex(
      (character) => character.id === selected.id,
    );
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      (currentIndex + direction + CHARACTER_DEFINITIONS.length) %
      CHARACTER_DEFINITIONS.length;
    const next = CHARACTER_DEFINITIONS[nextIndex];
    if (next) selectCharacter(next.id, true);
  });

  rosterSection.append(rosterHeading, roster);

  const footnote = element("footer", "title-v2__footnote");
  footnote.append(
    element("span", "", "縦持ち推奨"),
    element("i", ""),
    element("span", "", "iPhone Safari対応"),
    element("i", ""),
    element("span", "", "部屋は30分"),
  );

  shell.append(brand, showcase, rosterSection, entryPanel, footnote);
  screen.append(shell);
  return screen;
}
