import * as THREE from "three";
import { isCharacterId, type CharacterId } from "./characters";
import { AvatarRig, BEAUTIFUL_AVATAR_VERSION } from "./game/avatar";
import type { PlayerState } from "./types";

const PREVIEW_SELECTOR = ".character-showcase__visual";
const SCREEN_SELECTOR = ".title-screen--v2";

class TitleCharacterPreview {
  private readonly mount: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(27, 1, 0.1, 30);
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private readonly particleField: THREE.Points;
  private readonly pedestal: THREE.Group;
  private readonly state: PlayerState;
  private avatar: AvatarRig;
  private characterId: CharacterId;
  private destroyed = false;
  private frame = 0;

  constructor(mount: HTMLElement, characterId: CharacterId) {
    this.mount = mount;
    this.characterId = characterId;
    this.mount.classList.add("title-preview", `title-preview--${BEAUTIFUL_AVATAR_VERSION}`);
    this.mount.dataset.previewVersion = BEAUTIFUL_AVATAR_VERSION;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "title-preview__canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.mount.append(this.renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xfff8ff, 0x2b2145, 2.8);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffe9f6, 4.1);
    key.position.set(-3.8, 6.2, 5.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 18;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x88efff, 2.5);
    rim.position.set(4.5, 3.4, -4.2);
    this.scene.add(rim);

    const face = new THREE.PointLight(0xffffff, 1.7, 7, 2);
    face.position.set(0, 2.2, 3.4);
    this.scene.add(face);

    this.pedestal = this.createPedestal();
    this.scene.add(this.pedestal);
    this.particleField = this.createParticles();
    this.scene.add(this.particleField);

    this.avatar = new AvatarRig("host", characterId);
    this.avatar.root.position.y = 0.12;
    this.avatar.root.rotation.y = Math.PI;
    this.scene.add(this.avatar.root);

    this.state = {
      x: 0,
      z: 0,
      yaw: Math.PI,
      speed: 0,
      motion: "idle",
      motionSequence: 0,
      clientTime: performance.now(),
      characterId,
    };

    this.camera.position.set(0, 2.25, 5.2);
    this.camera.lookAt(0, 1.22, 0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.resize();
    this.renderer.setAnimationLoop(this.animate);
  }

  setCharacter(characterId: CharacterId): void {
    if (this.destroyed || characterId === this.characterId) return;
    this.characterId = characterId;
    this.state.characterId = characterId;
    const previous = this.avatar;
    this.scene.remove(previous.root);
    previous.dispose();
    this.avatar = new AvatarRig("host", characterId);
    this.avatar.root.position.y = 0.12;
    this.avatar.root.rotation.y = Math.PI;
    this.scene.add(this.avatar.root);
    this.mount.classList.remove("title-preview--switching");
    void this.mount.offsetWidth;
    this.mount.classList.add("title-preview--switching");
    window.setTimeout(() => this.mount.classList.remove("title-preview--switching"), 520);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.avatar.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.mount.classList.remove("title-preview--ready", "title-preview--switching");
  }

  private createPedestal(): THREE.Group {
    const group = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xf3eaff,
      transparent: true,
      opacity: 0.26,
      roughness: 0.18,
      metalness: 0.16,
      transmission: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const edge = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.52,
      toneMapped: false,
    });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.08, 0.11, 64), glass);
    disc.position.y = 0.035;
    disc.receiveShadow = true;
    group.add(disc);
    const upperRing = new THREE.Mesh(new THREE.TorusGeometry(0.91, 0.018, 8, 64), edge);
    upperRing.rotation.x = Math.PI / 2;
    upperRing.position.y = 0.1;
    group.add(upperRing);
    const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.009, 6, 64), edge.clone());
    orbitRing.rotation.x = Math.PI / 2;
    orbitRing.position.y = 0.14;
    orbitRing.userData.orbit = true;
    group.add(orbitRing);
    return group;
  }

  private createParticles(): THREE.Points {
    const count = 42;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 * 2.7;
      const radius = 1.15 + (index % 7) * 0.07;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = 0.24 + ((index * 37) % 100) / 100 * 2.4;
      positions[index * 3 + 2] = Math.sin(angle) * radius * 0.66;
      sizes[index] = 0.5 + (index % 4) * 0.17;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return new THREE.Points(geometry, material);
  }

  private readonly animate = (): void => {
    if (this.destroyed) return;
    if (!this.mount.isConnected) {
      this.destroy();
      return;
    }

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    this.state.clientTime = performance.now();
    this.avatar.update(dt, this.state);
    this.avatar.root.rotation.y = Math.PI + Math.sin(time * 0.52) * 0.13;
    this.avatar.root.position.y = 0.12 + Math.sin(time * 1.55) * 0.012;
    this.pedestal.rotation.y = time * 0.18;
    this.pedestal.children.forEach((child) => {
      if (child.userData.orbit) child.rotation.z = time * 0.42;
    });
    this.particleField.rotation.y = time * 0.08;
    this.particleField.position.y = Math.sin(time * 0.65) * 0.035;

    this.renderer.render(this.scene, this.camera);
    this.frame += 1;
    if (this.frame === 2) {
      this.mount.classList.add("title-preview--ready");
      this.mount.dataset.renderedCharacter = this.characterId;
    }
  };

  private resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    this.camera.aspect = width / height;
    const portraitTightness = clamp((0.92 - this.camera.aspect) * 0.6, 0, 0.38);
    this.camera.position.z = 5.2 + portraitTightness;
    this.camera.position.y = 2.25 + portraitTightness * 0.35;
    this.camera.lookAt(0, 1.22, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function installTitlePreview(): () => void {
  let preview: TitleCharacterPreview | null = null;
  let previewMount: HTMLElement | null = null;
  let observedScreen: HTMLElement | null = null;
  let characterObserver: MutationObserver | null = null;

  const detach = (): void => {
    characterObserver?.disconnect();
    characterObserver = null;
    observedScreen = null;
    preview?.destroy();
    preview = null;
    previewMount = null;
  };

  const attach = (): void => {
    const screen = document.querySelector<HTMLElement>(SCREEN_SELECTOR);
    const mount = screen?.querySelector<HTMLElement>(PREVIEW_SELECTOR) ?? null;
    if (!screen || !mount) {
      if (previewMount && !previewMount.isConnected) detach();
      return;
    }
    if (
      screen === observedScreen &&
      mount === previewMount &&
      (preview || mount.classList.contains("title-preview--failed"))
    ) return;

    detach();
    const rawCharacterId = screen.dataset.character;
    const characterId: CharacterId = isCharacterId(rawCharacterId) ? rawCharacterId : "lumi";
    try {
      preview = new TitleCharacterPreview(mount, characterId);
      previewMount = mount;
      observedScreen = screen;
      characterObserver = new MutationObserver(() => {
        const rawNextId = screen.dataset.character;
        const nextId: CharacterId = isCharacterId(rawNextId) ? rawNextId : "lumi";
        preview?.setCharacter(nextId);
        if (previewMount) previewMount.dataset.renderedCharacter = nextId;
      });
      characterObserver.observe(screen, { attributes: true, attributeFilter: ["data-character"] });
    } catch (error) {
      console.warn("Beautiful 3D title preview is unavailable; keeping the CSS fallback.", error);
      mount.classList.add("title-preview--failed");
      preview = null;
      previewMount = mount;
      observedScreen = screen;
    }
  };

  const documentObserver = new MutationObserver(attach);
  documentObserver.observe(document.body, { childList: true, subtree: true });
  queueMicrotask(attach);

  return () => {
    documentObserver.disconnect();
    detach();
  };
}
