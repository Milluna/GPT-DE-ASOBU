import * as THREE from "three";
import type { PlayerRole, PlayerState, PresenceState } from "../types";
import { AvatarRig } from "./avatar";
import { FloatingStick } from "./floatingStick";
import { LocomotionController } from "./locomotion";
import { RemoteInterpolator } from "./remoteInterpolator";

interface GameOptions {
  mount: HTMLElement;
  overlay: HTMLElement;
  role: PlayerRole;
  onLocalState: (state: PlayerState) => void;
  onPerformanceMode?: (mode: "full" | "reduced") => void;
}

interface BubbleSlot {
  element: HTMLDivElement;
  hideTimer: number | null;
}

const SEND_INTERVAL_SECONDS = 1 / 20;

function oppositeRole(role: PlayerRole): PlayerRole {
  return role === "host" ? "guest" : "host";
}

function defaultState(role: PlayerRole): PlayerState {
  return {
    x: 0,
    z: role === "host" ? 1.65 : -1.65,
    yaw: role === "host" ? Math.PI : 0,
    speed: 0,
    motion: "idle",
    motionSequence: 0,
    clientTime: performance.now(),
  };
}

function createBackgroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
  gradient.addColorStop(0, "#151426");
  gradient.addColorStop(0.45, "#292346");
  gradient.addColorStop(1, "#645985");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addPlatform(scene: THREE.Scene): void {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(10.4, 0.34, 11.4, 1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x776d98,
      roughness: 0.82,
      metalness: 0.04,
    }),
  );
  base.position.y = -0.22;
  scene.add(base);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9.8, 10.8),
    new THREE.MeshStandardMaterial({
      color: 0xd4c7ef,
      roughness: 0.78,
      metalness: 0.02,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.045;
  scene.add(floor);

  const inset = new THREE.Mesh(
    new THREE.PlaneGeometry(8.7, 9.7),
    new THREE.MeshStandardMaterial({
      color: 0xb6a4dd,
      roughness: 0.84,
      transparent: true,
      opacity: 0.72,
    }),
  );
  inset.rotation.x = -Math.PI / 2;
  inset.position.y = -0.036;
  scene.add(inset);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.54,
    side: THREE.DoubleSide,
  });
  const centerRing = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.22, 64), ringMaterial);
  centerRing.rotation.x = -Math.PI / 2;
  centerRing.position.y = -0.024;
  scene.add(centerRing);

  const orbitRing = new THREE.Mesh(new THREE.RingGeometry(3.25, 3.3, 64), ringMaterial.clone());
  orbitRing.rotation.x = -Math.PI / 2;
  orbitRing.position.y = -0.023;
  (orbitRing.material as THREE.MeshBasicMaterial).opacity = 0.24;
  scene.add(orbitRing);

  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.32,
  });
  for (const x of [-2.7, 0, 2.7]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 8.9), lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, -0.022, 0);
    scene.add(line);
  }

  const postGeometry = new THREE.CylinderGeometry(0.08, 0.12, 0.65, 12);
  const postMaterial = new THREE.MeshToonMaterial({ color: 0xffd9eb });
  const orbGeometry = new THREE.SphereGeometry(0.14, 14, 10);
  const orbMaterial = new THREE.MeshBasicMaterial({ color: 0x9ef2ff });
  for (const [x, z] of [
    [-4.65, -5.05],
    [4.65, -5.05],
    [-4.65, 5.05],
    [4.65, 5.05],
  ] as Array<[number, number]>) {
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.set(x, 0.24, z);
    scene.add(post);
    const orb = new THREE.Mesh(orbGeometry, orbMaterial);
    orb.position.set(x, 0.64, z);
    scene.add(orb);
  }

  // Short transparent center net. The sides are intentionally open for circling taunts.
  const net = new THREE.Group();
  net.name = "center-net";
  const netFrameMaterial = new THREE.MeshToonMaterial({ color: 0xff9fc8 });
  const netPanelMaterial = new THREE.MeshBasicMaterial({
    color: 0xe9f7ff,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const netPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.92), netPanelMaterial);
  netPanel.position.y = 0.54;
  net.add(netPanel);
  const horizontalGeometry = new THREE.BoxGeometry(4.48, 0.07, 0.08);
  const netTop = new THREE.Mesh(horizontalGeometry, netFrameMaterial);
  netTop.position.y = 1.02;
  net.add(netTop);
  const netBottom = new THREE.Mesh(horizontalGeometry, netFrameMaterial);
  netBottom.position.y = 0.08;
  net.add(netBottom);
  const netPostGeometry = new THREE.BoxGeometry(0.09, 1.08, 0.09);
  for (const x of [-2.22, 2.22]) {
    const post = new THREE.Mesh(netPostGeometry, netFrameMaterial);
    post.position.set(x, 0.54, 0);
    net.add(post);
  }
  scene.add(net);

  // Soft decorative floating motes. These are intentionally sparse for mobile GPUs.
  const moteGeometry = new THREE.SphereGeometry(0.035, 8, 6);
  const moteMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
  });
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const radius = 5.8 + (index % 4) * 0.22;
    const mote = new THREE.Mesh(moteGeometry, moteMaterial);
    mote.position.set(
      Math.cos(angle) * radius,
      0.75 + (index % 6) * 0.27,
      Math.sin(angle) * radius,
    );
    mote.userData.phase = index * 0.73;
    mote.userData.baseY = mote.position.y;
    mote.name = "ambient-mote";
    scene.add(mote);
  }
}

export class TauntGame {
  private readonly mount: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly role: PlayerRole;
  private readonly onLocalState: (state: PlayerState) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly timer = new THREE.Timer();
  private readonly localAvatar: AvatarRig;
  private readonly remoteAvatar: AvatarRig;
  private readonly controller = new LocomotionController();
  private readonly remoteInterpolator: RemoteInterpolator;
  private readonly stick: FloatingStick;
  private readonly bubbles: Record<PlayerRole, BubbleSlot>;
  private readonly backgroundTexture: THREE.Texture;
  private readonly resizeObserver: ResizeObserver;

  private sendAccumulator = 0;
  private lastLocalState: PlayerState;
  private destroyed = false;
  private remoteConnected = false;
  private frameSamples: number[] = [];
  private performanceMode: "full" | "reduced" = "full";
  private readonly onPerformanceMode: ((mode: "full" | "reduced") => void) | undefined;

  constructor(options: GameOptions) {
    this.mount = options.mount;
    this.overlay = options.overlay;
    this.timer.connect(document);
    this.role = options.role;
    this.onLocalState = options.onLocalState;
    this.onPerformanceMode = options.onPerformanceMode;

    const localSpawn = defaultState(this.role);
    const remoteSpawn = defaultState(oppositeRole(this.role));
    this.controller.reset(localSpawn.x, localSpawn.z, localSpawn.yaw);
    this.lastLocalState = this.controller.snapshot(performance.now());
    this.remoteInterpolator = new RemoteInterpolator(remoteSpawn);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = "game-canvas";
    this.renderer.domElement.setAttribute("aria-label", "3Dルーム");
    this.renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
    this.mount.append(this.renderer.domElement);

    this.backgroundTexture = createBackgroundTexture();
    this.scene.background = this.backgroundTexture;
    this.scene.fog = new THREE.Fog(0x332b4c, 8.5, 18);

    const hemisphere = new THREE.HemisphereLight(0xece9ff, 0x443756, 2.4);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff0f8, 3.1);
    key.position.set(-4, 8, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fefff, 1.8);
    rim.position.set(5, 4, -5);
    this.scene.add(rim);

    addPlatform(this.scene);

    this.localAvatar = new AvatarRig(this.role);
    this.remoteAvatar = new AvatarRig(oppositeRole(this.role));
    this.scene.add(this.localAvatar.root, this.remoteAvatar.root);
    this.remoteAvatar.root.visible = false;

    this.localAvatar.root.position.set(localSpawn.x, 0, localSpawn.z);
    this.localAvatar.root.rotation.y = localSpawn.yaw;
    this.remoteAvatar.root.position.set(remoteSpawn.x, 0, remoteSpawn.z);
    this.remoteAvatar.root.rotation.y = remoteSpawn.yaw;

    const cameraSign = this.role === "host" ? 1 : -1;
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
    this.camera.position.set(0, 6.35, 9.55 * cameraSign);
    this.camera.lookAt(0, 0.83, 0);

    this.stick = new FloatingStick(this.renderer.domElement, this.overlay, {
      activationDistance: 9,
      onPress: () => {
        const state = this.controller.triggerRacketSwing(performance.now());
        this.lastLocalState = state;
        this.sendAccumulator = 0;
        this.onLocalState({ ...state });
      },
      onMoveStart: () => { this.sendAccumulator = SEND_INTERVAL_SECONDS; },
    });
    this.bubbles = {
      host: this.createBubble("host"),
      guest: this.createBubble("guest"),
    };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.resize();
    this.renderer.setAnimationLoop(this.animate);
  }

  setPresence(presence: PresenceState): void {
    const remoteRole = oppositeRole(this.role);
    this.remoteConnected = presence[remoteRole];
    this.remoteAvatar.root.visible = this.remoteConnected;
    if (!this.remoteConnected) {
      this.bubbles[remoteRole].element.classList.remove("is-visible");
    }
  }

  applyRemoteState(state: PlayerState): void {
    this.remoteInterpolator.push(state);
    this.remoteConnected = true;
    this.remoteAvatar.root.visible = true;
  }

  showBubble(role: PlayerRole, text: string): void {
    const slot = this.bubbles[role];
    slot.element.textContent = text;
    slot.element.classList.remove("is-visible", "is-pop");
    // Force a reflow so repeated messages replay the pop animation.
    void slot.element.offsetWidth;
    slot.element.classList.add("is-visible", "is-pop");
    if (slot.hideTimer !== null) window.clearTimeout(slot.hideTimer);
    slot.hideTimer = window.setTimeout(() => {
      slot.element.classList.remove("is-visible", "is-pop");
      slot.hideTimer = null;
    }, 2400);
  }

  getLocalState(): PlayerState {
    return { ...this.lastLocalState };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.stick.destroy();
    Object.values(this.bubbles).forEach((slot) => {
      if (slot.hideTimer !== null) window.clearTimeout(slot.hideTimer);
      slot.element.remove();
    });
    this.localAvatar.dispose();
    this.remoteAvatar.dispose();
    this.backgroundTexture.dispose();
    this.timer.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly animate = (): void => {
    if (this.destroyed) return;
    this.timer.update();
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const now = performance.now();

    const cameraSign = this.role === "host" ? 1 : -1;
    const stick = this.stick.value;
    const cameraRelativeInput = {
      x: stick.x * cameraSign,
      y: stick.y * cameraSign,
    };
    this.lastLocalState = this.controller.update(dt, cameraRelativeInput, now);

    this.localAvatar.root.position.set(this.lastLocalState.x, 0, this.lastLocalState.z);
    this.localAvatar.root.rotation.y = this.lastLocalState.yaw;
    this.localAvatar.update(dt, this.lastLocalState);

    const remoteState = this.remoteInterpolator.update(dt);
    this.remoteAvatar.root.position.set(remoteState.x, 0, remoteState.z);
    this.remoteAvatar.root.rotation.y = remoteState.yaw;
    this.remoteAvatar.update(dt, remoteState);

    this.sendAccumulator += dt;
    if (this.sendAccumulator >= SEND_INTERVAL_SECONDS) {
      this.sendAccumulator %= SEND_INTERVAL_SECONDS;
      this.onLocalState({ ...this.lastLocalState });
    }

    this.updateMotes(now * 0.001);
    this.updateBubblePosition(this.role, this.localAvatar.bubbleAnchor);
    this.updateBubblePosition(oppositeRole(this.role), this.remoteAvatar.bubbleAnchor);
    this.samplePerformance(rawDt);
    this.renderer.render(this.scene, this.camera);
  };

  private createBubble(role: PlayerRole): BubbleSlot {
    const element = document.createElement("div");
    element.className = `avatar-bubble avatar-bubble--${role}`;
    element.dataset.noStick = "true";
    element.setAttribute("role", "status");
    this.overlay.append(element);
    return { element, hideTimer: null };
  }

  private updateBubblePosition(role: PlayerRole, anchor: THREE.Object3D): void {
    const slot = this.bubbles[role];
    if (role !== this.role && !this.remoteConnected) {
      slot.element.style.visibility = "hidden";
      return;
    }

    const world = new THREE.Vector3();
    anchor.getWorldPosition(world);
    world.project(this.camera);
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;
    const x = (world.x * 0.5 + 0.5) * width;
    const y = (-world.y * 0.5 + 0.5) * height;
    const inFront = world.z > -1 && world.z < 1;
    slot.element.style.visibility = inFront ? "visible" : "hidden";
    slot.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }

  private updateMotes(time: number): void {
    this.scene.traverse((object) => {
      if (object.name !== "ambient-mote") return;
      const baseY = Number(object.userData.baseY ?? object.position.y);
      const phase = Number(object.userData.phase ?? 0);
      object.position.y = baseY + Math.sin(time * 1.2 + phase) * 0.08;
    });
  }

  private samplePerformance(dt: number): void {
    if (dt <= 0 || dt > 0.25) return;
    this.frameSamples.push(dt);
    if (this.frameSamples.length < 120) return;
    const average = this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
    this.frameSamples = [];

    if (average > 1 / 42 && this.performanceMode === "full") {
      this.performanceMode = "reduced";
      this.renderer.setPixelRatio(1);
      this.onPerformanceMode?.("reduced");
      this.resize();
    }
  }

  private resize(): void {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    this.camera.aspect = width / height;
    const cameraSign = this.role === "host" ? 1 : -1;
    const portraitPenalty = Math.max(0, 0.72 - this.camera.aspect);
    const distance = 10.35 + portraitPenalty * 9.5;
    const cameraHeight = 6.65 + portraitPenalty * 2.2;
    this.camera.position.set(0, cameraHeight, distance * cameraSign);
    this.camera.lookAt(0, 0.82, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
