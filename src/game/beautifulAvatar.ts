import * as THREE from "three";
import { getCharacterDefinition, type CharacterId } from "../characters";
import type { MotionName, PlayerRole, PlayerState } from "../types";

export const BEAUTIFUL_AVATAR_VERSION = "beautiful-3d-v3" as const;

interface MaterialSet {
  skin: THREE.MeshPhysicalMaterial;
  skinShadow: THREE.MeshPhysicalMaterial;
  hair: THREE.MeshPhysicalMaterial;
  hairShadow: THREE.MeshPhysicalMaterial;
  cloth: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  ribbon: THREE.MeshPhysicalMaterial;
  white: THREE.MeshPhysicalMaterial;
  dark: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshPhysicalMaterial;
  eye: THREE.MeshPhysicalMaterial;
  eyeDark: THREE.MeshBasicMaterial;
  blush: THREE.MeshBasicMaterial;
  mouth: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  outline: THREE.MeshBasicMaterial;
}

interface EyeRig {
  root: THREE.Group;
  iris: THREE.Object3D;
  pupil: THREE.Object3D;
}

interface HairSpring {
  object: THREE.Object3D;
  restX: number;
  restY: number;
  restZ: number;
  phase: number;
  amplitude: number;
  response: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapAngle(value: number): number {
  const twoPi = Math.PI * 2;
  let result = value % twoPi;
  if (result > Math.PI) result -= twoPi;
  if (result < -Math.PI) result += twoPi;
  return result;
}

function damp(current: number, target: number, sharpness: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-sharpness * dt));
}

function mixHex(a: string, b: string, amount: number): string {
  const color = new THREE.Color(a);
  color.lerp(new THREE.Color(b), clamp(amount, 0, 1));
  return `#${color.getHexString()}`;
}

function makeFabricTexture(primary: string, accent: string, symbol: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable.");

  const gradient = ctx.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, mixHex(primary, "#ffffff", 0.16));
  gradient.addColorStop(0.52, primary);
  gradient.addColorStop(1, mixHex(primary, accent, 0.25));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  for (let x = -512; x < 1024; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 512, 512);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.055;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  for (let y = 24; y < 512; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 70px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 72; y < 512; y += 148) {
    for (let x = 72; x < 512; x += 148) {
      ctx.fillText(symbol, x + ((y / 148) % 2) * 18, y);
    }
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.1, 1.1);
  texture.anisotropy = 8;
  return texture;
}

function makeGlowTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable.");
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,.78)");
  gradient.addColorStop(0.17, new THREE.Color(color).getStyle().replace("rgb", "rgba").replace(")", ",.56)"));
  gradient.addColorStop(0.55, new THREE.Color(color).getStyle().replace("rgb", "rgba").replace(")", ",.18)"));
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function physical(
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshPhysicalMaterialParameters> = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.32,
    ...options,
  });
}

function createMaterialSet(
  characterId: CharacterId,
  fabricTexture: THREE.Texture,
): MaterialSet {
  const character = getCharacterDefinition(characterId);
  const palette = character.palette;
  return {
    skin: physical("#ffd9cf", {
      roughness: 0.64,
      clearcoat: 0.14,
      sheen: 0.22,
      sheenColor: new THREE.Color("#ffafbb"),
    }),
    skinShadow: physical("#efb3ae", {
      roughness: 0.7,
      clearcoat: 0.08,
    }),
    hair: physical(palette.hair, {
      roughness: 0.3,
      clearcoat: 0.72,
      clearcoatRoughness: 0.24,
      sheen: 0.72,
      sheenColor: new THREE.Color(mixHex(palette.hair, "#ffffff", 0.48)),
    }),
    hairShadow: physical(palette.hairShadow, {
      roughness: 0.4,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    }),
    cloth: physical("#fffaff", {
      map: fabricTexture,
      roughness: 0.58,
      clearcoat: 0.18,
      sheen: 0.52,
      sheenColor: new THREE.Color(palette.outfitAccent),
    }),
    accent: physical(palette.outfitAccent, {
      roughness: 0.34,
      clearcoat: 0.78,
      clearcoatRoughness: 0.21,
      sheen: 0.45,
      sheenColor: new THREE.Color("#ffffff"),
    }),
    ribbon: physical(palette.ribbon, {
      roughness: 0.28,
      clearcoat: 0.82,
      emissive: new THREE.Color(palette.ribbon),
      emissiveIntensity: 0.08,
    }),
    white: physical("#ffffff", {
      roughness: 0.3,
      clearcoat: 0.72,
      clearcoatRoughness: 0.2,
    }),
    dark: physical("#302842", {
      roughness: 0.42,
      clearcoat: 0.42,
    }),
    metal: physical("#dffcff", {
      roughness: 0.18,
      metalness: 0.72,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      emissive: new THREE.Color(palette.glow),
      emissiveIntensity: 0.05,
    }),
    eye: physical(palette.eye, {
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      emissive: new THREE.Color(palette.eye),
      emissiveIntensity: 0.12,
    }),
    eyeDark: new THREE.MeshBasicMaterial({ color: 0x201a31, toneMapped: false }),
    blush: new THREE.MeshBasicMaterial({
      color: 0xff789f,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      toneMapped: false,
    }),
    mouth: new THREE.MeshBasicMaterial({ color: 0xaa4e72, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      toneMapped: false,
    }),
    outline: new THREE.MeshBasicMaterial({
      color: new THREE.Color(mixHex(palette.hairShadow, "#171323", 0.68)),
      side: THREE.BackSide,
      depthWrite: true,
      toneMapped: false,
    }),
  };
}

function applyTransform(
  object: THREE.Object3D,
  options: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  },
): void {
  if (options.position) object.position.set(...options.position);
  if (options.rotation) object.rotation.set(...options.rotation);
  if (options.scale) object.scale.set(...options.scale);
}

function addOutlined(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  outlineMaterial: THREE.Material,
  options: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    outline?: number;
    castShadow?: boolean;
    receiveShadow?: boolean;
  } = {},
): THREE.Group {
  const holder = new THREE.Group();
  applyTransform(holder, options);
  parent.add(holder);

  const outline = new THREE.Mesh(geometry, outlineMaterial);
  outline.scale.setScalar(options.outline ?? 1.035);
  outline.castShadow = false;
  outline.receiveShadow = false;
  holder.add(outline);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? false;
  holder.add(mesh);
  return holder;
}

function addPlain(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    castShadow?: boolean;
    receiveShadow?: boolean;
    renderOrder?: number;
  } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  applyTransform(mesh, options);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  if (options.renderOrder !== undefined) mesh.renderOrder = options.renderOrder;
  parent.add(mesh);
  return mesh;
}

function makeCurve(
  start: [number, number, number],
  control: [number, number, number],
  end: [number, number, number],
): THREE.QuadraticBezierCurve3 {
  return new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(...start),
    new THREE.Vector3(...control),
    new THREE.Vector3(...end),
  );
}

function makeStarGeometry(outer = 0.12, inner = 0.055, points = 5): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index / (points * 2)) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function makeDiamondGeometry(size = 0.12): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, size);
  shape.lineTo(size * 0.72, 0);
  shape.lineTo(0, -size);
  shape.lineTo(-size * 0.72, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function createEye(
  parent: THREE.Object3D,
  x: number,
  materials: MaterialSet,
): EyeRig {
  const root = new THREE.Group();
  root.position.set(x, -0.005, 0.355);
  parent.add(root);

  addPlain(root, new THREE.SphereGeometry(0.1, 20, 14), materials.white, {
    scale: [1.02, 1.32, 0.24],
    castShadow: false,
  });
  const iris = addPlain(root, new THREE.SphereGeometry(0.066, 20, 14), materials.eye, {
    position: [0, -0.003, 0.038],
    scale: [0.92, 1.22, 0.18],
  });
  const pupil = addPlain(root, new THREE.SphereGeometry(0.033, 16, 10), materials.eyeDark, {
    position: [0, -0.01, 0.062],
    scale: [0.86, 1.15, 0.12],
  });
  addPlain(root, new THREE.SphereGeometry(0.017, 12, 8), materials.white, {
    position: [-0.024, 0.038, 0.075],
    scale: [1, 1.25, 0.5],
  });
  addPlain(root, new THREE.SphereGeometry(0.008, 10, 7), materials.white, {
    position: [0.025, -0.038, 0.078],
  });

  const lashCurve = makeCurve([-0.102, 0.05, 0.07], [0, 0.105, 0.085], [0.102, 0.05, 0.07]);
  addPlain(root, new THREE.TubeGeometry(lashCurve, 12, 0.011, 6, false), materials.eyeDark, {
    renderOrder: 6,
  });
  const outerSign = x < 0 ? -1 : 1;
  const lashTipCurve = makeCurve(
    [outerSign * 0.086, 0.057, 0.072],
    [outerSign * 0.125, 0.085, 0.08],
    [outerSign * 0.138, 0.057, 0.074],
  );
  addPlain(root, new THREE.TubeGeometry(lashTipCurve, 8, 0.008, 5, false), materials.eyeDark, {
    renderOrder: 6,
  });

  return { root, iris, pupil };
}

function addBow(
  parent: THREE.Object3D,
  materials: MaterialSet,
  position: [number, number, number],
  scale = 1,
): THREE.Group {
  const bow = new THREE.Group();
  bow.position.set(...position);
  bow.scale.setScalar(scale);
  parent.add(bow);
  const wing = new THREE.SphereGeometry(0.12, 14, 10);
  addOutlined(bow, wing, materials.ribbon, materials.outline, {
    position: [-0.09, 0, 0],
    scale: [1.2, 0.64, 0.36],
    rotation: [0, 0, -0.28],
    outline: 1.045,
  });
  addOutlined(bow, wing, materials.ribbon, materials.outline, {
    position: [0.09, 0, 0],
    scale: [1.2, 0.64, 0.36],
    rotation: [0, 0, 0.28],
    outline: 1.045,
  });
  addOutlined(bow, new THREE.SphereGeometry(0.055, 12, 9), materials.metal, materials.outline, {
    outline: 1.05,
  });
  return bow;
}

function registerSpring(
  list: HairSpring[],
  object: THREE.Object3D,
  phase: number,
  amplitude: number,
  response = 9,
): void {
  list.push({
    object,
    restX: object.rotation.x,
    restY: object.rotation.y,
    restZ: object.rotation.z,
    phase,
    amplitude,
    response,
  });
}

export class AvatarRig {
  readonly root = new THREE.Group();
  readonly bubbleAnchor = new THREE.Object3D();
  readonly visualVersion = BEAUTIFUL_AVATAR_VERSION;

  private readonly characterId: CharacterId;
  private readonly visual = new THREE.Group();
  private readonly torsoPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly skirt = new THREE.Group();
  private readonly ponytail = new THREE.Group();
  private readonly racketPivot = new THREE.Group();
  private readonly leftEye: EyeRig;
  private readonly rightEye: EyeRig;
  private readonly mouth: THREE.Object3D;
  private readonly roleRing: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly glowPlane: THREE.Mesh;
  private readonly hairSprings: HairSpring[] = [];
  private readonly sparkles: THREE.Object3D[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];

  private elapsed = Math.random() * 6;
  private stridePhase = Math.random() * Math.PI * 2;
  private motionAge = 0;
  private previousMotion: MotionName = "idle";
  private previousSequence = -1;
  private previousYaw = Math.PI;
  private smoothedTurnRate = 0;

  constructor(role: PlayerRole, characterId: CharacterId) {
    this.characterId = characterId;
    const character = getCharacterDefinition(characterId);
    const palette = character.palette;
    const fabricTexture = makeFabricTexture(palette.outfit, palette.outfitAccent, character.symbol);
    const glowTexture = makeGlowTexture(palette.glow);
    this.ownedTextures.push(fabricTexture, glowTexture);
    const materials = createMaterialSet(characterId, fabricTexture);

    this.root.name = `${role}-${characterId}-${BEAUTIFUL_AVATAR_VERSION}`;
    this.root.add(this.visual);

    const glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.45), glowMaterial);
    this.glowPlane.rotation.x = -Math.PI / 2;
    this.glowPlane.position.y = 0.008;
    this.root.add(this.glowPlane);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x171223,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 36), shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.shadow.scale.set(1.2, 0.62, 1);
    this.root.add(this.shadow);

    const roleColor = role === "host" ? 0xff7eb9 : 0x72f0dc;
    const roleRingMaterial = new THREE.MeshBasicMaterial({
      color: roleColor,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.roleRing = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.59, 48), roleRingMaterial);
    this.roleRing.rotation.x = -Math.PI / 2;
    this.roleRing.position.y = 0.018;
    this.root.add(this.roleRing);

    for (let index = 0; index < 6; index += 1) {
      const sparkle = addPlain(
        this.root,
        new THREE.OctahedronGeometry(index % 2 === 0 ? 0.025 : 0.018, 0),
        materials.glow,
        { castShadow: false },
      );
      sparkle.userData.index = index;
      this.sparkles.push(sparkle);
    }

    // Legs, socks, and layered shoes.
    this.leftLeg.position.set(-0.15, 0.91, 0);
    this.rightLeg.position.set(0.15, 0.91, 0);
    this.visual.add(this.leftLeg, this.rightLeg);
    const legGeometry = new THREE.CapsuleGeometry(0.095, 0.42, 5, 12);
    addOutlined(this.leftLeg, legGeometry, materials.skinShadow, materials.outline, {
      position: [0, -0.31, 0],
      outline: 1.045,
    });
    addOutlined(this.rightLeg, legGeometry, materials.skinShadow, materials.outline, {
      position: [0, -0.31, 0],
      outline: 1.045,
    });
    const sockGeometry = new THREE.CapsuleGeometry(0.108, 0.16, 4, 12);
    addOutlined(this.leftLeg, sockGeometry, materials.white, materials.outline, {
      position: [0, -0.57, 0.01],
      outline: 1.04,
    });
    addOutlined(this.rightLeg, sockGeometry, materials.white, materials.outline, {
      position: [0, -0.57, 0.01],
      outline: 1.04,
    });
    const shoeGeometry = new THREE.SphereGeometry(0.5, 20, 14);
    for (const leg of [this.leftLeg, this.rightLeg]) {
      addOutlined(leg, shoeGeometry, materials.dark, materials.outline, {
        position: [0, -0.76, 0.085],
        scale: [0.33, 0.18, 0.5],
        outline: 1.05,
      });
      addPlain(leg, new THREE.BoxGeometry(0.22, 0.035, 0.34), materials.accent, {
        position: [0, -0.69, 0.1],
        rotation: [0.22, 0, 0],
        castShadow: true,
      });
      addPlain(leg, new THREE.BoxGeometry(0.24, 0.035, 0.39), materials.metal, {
        position: [0, -0.835, 0.1],
        castShadow: true,
      });
    }

    // Torso and layered dress.
    this.torsoPivot.position.y = 1.2;
    this.visual.add(this.torsoPivot);
    addOutlined(this.torsoPivot, new THREE.SphereGeometry(0.5, 28, 18), materials.cloth, materials.outline, {
      scale: [0.46, 0.57, 0.34],
      outline: 1.035,
    });
    addOutlined(
      this.torsoPivot,
      new THREE.CylinderGeometry(0.28, 0.25, 0.15, 24),
      materials.accent,
      materials.outline,
      { position: [0, -0.24, 0], outline: 1.035 },
    );

    this.skirt.position.set(0, -0.34, 0);
    this.torsoPivot.add(this.skirt);
    addOutlined(
      this.skirt,
      new THREE.CylinderGeometry(0.27, 0.44, 0.3, 28, 2, false),
      materials.accent,
      materials.outline,
      { outline: 1.03 },
    );
    addOutlined(
      this.skirt,
      new THREE.CylinderGeometry(0.31, 0.49, 0.17, 28, 1, false),
      materials.cloth,
      materials.outline,
      { position: [0, -0.17, 0], outline: 1.025 },
    );
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const pleat = addPlain(this.skirt, new THREE.BoxGeometry(0.035, 0.27, 0.025), materials.ribbon, {
        position: [Math.cos(angle) * 0.34, -0.06, Math.sin(angle) * 0.34],
        rotation: [0, -angle, 0],
        castShadow: true,
      });
      pleat.scale.y = index % 2 === 0 ? 1 : 0.86;
    }
    addPlain(this.torsoPivot, new THREE.TorusGeometry(0.265, 0.026, 8, 28), materials.metal, {
      position: [0, -0.255, 0],
      rotation: [Math.PI / 2, 0, 0],
    });

    // Collar, chest bow, and character emblem.
    addPlain(this.torsoPivot, new THREE.BoxGeometry(0.22, 0.055, 0.025), materials.ribbon, {
      position: [-0.075, 0.18, 0.31],
      rotation: [0, 0, -0.48],
      castShadow: true,
    });
    addPlain(this.torsoPivot, new THREE.BoxGeometry(0.22, 0.055, 0.025), materials.ribbon, {
      position: [0.075, 0.18, 0.31],
      rotation: [0, 0, 0.48],
      castShadow: true,
    });
    addBow(this.torsoPivot, materials, [0, 0.02, 0.36], 0.58);
    const emblemGeometry =
      character.id === "mio" ? makeDiamondGeometry(0.095) : makeStarGeometry(0.1, 0.047, character.id === "sena" ? 6 : 5);
    addPlain(this.torsoPivot, emblemGeometry, materials.metal, {
      position: [0, -0.095, 0.375],
      scale: [1, 1, 1],
      castShadow: false,
      renderOrder: 4,
    });

    // Arms, sleeves, and hands.
    this.leftArm.position.set(-0.32, 0.22, 0);
    this.rightArm.position.set(0.32, 0.22, 0);
    this.torsoPivot.add(this.leftArm, this.rightArm);
    const puffGeometry = new THREE.SphereGeometry(0.15, 18, 12);
    addOutlined(this.leftArm, puffGeometry, materials.accent, materials.outline, {
      position: [0, -0.03, 0],
      scale: [1.05, 0.82, 0.92],
      outline: 1.04,
    });
    addOutlined(this.rightArm, puffGeometry, materials.accent, materials.outline, {
      position: [0, -0.03, 0],
      scale: [1.05, 0.82, 0.92],
      outline: 1.04,
    });
    const armGeometry = new THREE.CapsuleGeometry(0.073, 0.31, 4, 10);
    addOutlined(this.leftArm, armGeometry, materials.skin, materials.outline, {
      position: [0, -0.28, 0],
      outline: 1.05,
    });
    addOutlined(this.rightArm, armGeometry, materials.skin, materials.outline, {
      position: [0, -0.28, 0],
      outline: 1.05,
    });
    addOutlined(this.leftArm, new THREE.SphereGeometry(0.088, 14, 10), materials.skin, materials.outline, {
      position: [0, -0.5, 0],
      scale: [0.9, 1.05, 0.82],
      outline: 1.05,
    });
    addOutlined(this.rightArm, new THREE.SphereGeometry(0.088, 14, 10), materials.skin, materials.outline, {
      position: [0, -0.5, 0],
      scale: [0.9, 1.05, 0.82],
      outline: 1.05,
    });

    // Racket with a readable frame and strings.
    this.racketPivot.position.set(0, -0.49, 0.025);
    this.rightArm.add(this.racketPivot);
    addOutlined(
      this.racketPivot,
      new THREE.CylinderGeometry(0.031, 0.044, 0.46, 12),
      materials.dark,
      materials.outline,
      { position: [0, -0.2, 0], outline: 1.08 },
    );
    addPlain(this.racketPivot, new THREE.CylinderGeometry(0.052, 0.052, 0.16, 12), materials.ribbon, {
      position: [0, -0.03, 0],
      castShadow: true,
    });
    addOutlined(
      this.racketPivot,
      new THREE.TorusGeometry(0.225, 0.027, 10, 32),
      materials.metal,
      materials.outline,
      { position: [0, -0.64, 0], scale: [0.82, 1.14, 1], outline: 1.07 },
    );
    for (const offset of [-0.12, -0.06, 0, 0.06, 0.12]) {
      addPlain(this.racketPivot, new THREE.BoxGeometry(0.012, 0.43, 0.009), materials.white, {
        position: [offset, -0.64, 0],
        scale: [1, Math.sqrt(Math.max(0.2, 1 - (offset / 0.19) ** 2)), 1],
      });
      addPlain(this.racketPivot, new THREE.BoxGeometry(0.35, 0.011, 0.009), materials.white, {
        position: [0, -0.64 + offset * 1.2, 0],
        scale: [Math.sqrt(Math.max(0.2, 1 - (offset / 0.18) ** 2)), 1, 1],
      });
    }

    // Head and face shell.
    this.headPivot.position.set(0, 1.87, 0);
    this.visual.add(this.headPivot);
    const headGeometry = new THREE.SphereGeometry(0.5, 36, 24);
    addOutlined(this.headPivot, headGeometry, materials.skin, materials.outline, {
      position: [0, -0.015, 0.045],
      scale: [0.66, 0.71, 0.59],
      outline: 1.028,
    });

    // Back hair and glossy cap.
    addOutlined(this.headPivot, new THREE.SphereGeometry(0.5, 32, 22), materials.hairShadow, materials.outline, {
      position: [0, 0.03, -0.08],
      scale: [0.72, 0.76, 0.69],
      outline: 1.035,
    });
    addOutlined(
      this.headPivot,
      new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.54),
      materials.hair,
      materials.outline,
      { position: [0, 0.09, 0.02], scale: [0.7, 0.73, 0.64], outline: 1.033 },
    );

    this.leftEye = createEye(this.headPivot, -0.155, materials);
    this.rightEye = createEye(this.headPivot, 0.155, materials);

    // Brows, blush, nose, and smile.
    for (const side of [-1, 1] as const) {
      const brow = makeCurve(
        [side * 0.24, 0.13, 0.405],
        [side * 0.155, 0.17, 0.43],
        [side * 0.085, 0.145, 0.425],
      );
      addPlain(this.headPivot, new THREE.TubeGeometry(brow, 10, 0.012, 6, false), materials.mouth, {
        renderOrder: 6,
      });
      addPlain(this.headPivot, new THREE.CircleGeometry(0.075, 20), materials.blush, {
        position: [side * 0.285, -0.13, 0.385],
        scale: [1.35, 0.48, 1],
        renderOrder: 5,
      });
    }
    addPlain(this.headPivot, new THREE.SphereGeometry(0.018, 12, 8), materials.skinShadow, {
      position: [0, -0.08, 0.4],
      scale: [0.7, 0.45, 0.4],
      renderOrder: 5,
    });
    const mouthCurve = makeCurve([-0.065, -0.19, 0.405], [0, -0.245, 0.43], [0.065, -0.19, 0.405]);
    this.mouth = addPlain(
      this.headPivot,
      new THREE.TubeGeometry(mouthCurve, 12, 0.013, 7, false),
      materials.mouth,
      { renderOrder: 7 },
    );

    // Individual hair strands around the forehead.
    const bangGeometry = new THREE.CapsuleGeometry(0.035, 0.18, 4, 9);
    const bangOffsets: Array<[number, number, number, number, number]> = [
      [-0.24, 0.12, 0.33, -0.43, 0.96],
      [-0.14, 0.15, 0.36, -0.25, 1.08],
      [-0.045, 0.15, 0.38, -0.08, 1.12],
      [0.05, 0.15, 0.38, 0.1, 1.1],
      [0.145, 0.14, 0.36, 0.27, 1.04],
      [0.235, 0.11, 0.33, 0.44, 0.94],
    ];
    for (const [x, y, z, rotationZ, scaleY] of bangOffsets) {
      addOutlined(this.headPivot, bangGeometry, materials.hair, materials.outline, {
        position: [x, y, z],
        rotation: [0.1, 0, rotationZ],
        scale: [1, scaleY, 1],
        outline: 1.05,
      });
    }
    const sideLockGeometry = new THREE.CapsuleGeometry(0.055, 0.34, 5, 10);
    for (const side of [-1, 1] as const) {
      const lock = addOutlined(this.headPivot, sideLockGeometry, materials.hair, materials.outline, {
        position: [side * 0.34, -0.08, 0.07],
        rotation: [0.1, 0, side * 0.11],
        outline: 1.045,
      });
      registerSpring(this.hairSprings, lock, side * 0.7, 0.035, 11);
    }

    // Hair highlights are small emissive ribbons placed over the cap.
    for (const x of [-0.2, -0.1, 0.02, 0.14]) {
      addPlain(this.headPivot, new THREE.CapsuleGeometry(0.014, 0.11, 3, 7), materials.white, {
        position: [x, 0.31 - Math.abs(x) * 0.2, 0.33],
        rotation: [0.18, 0, -x * 0.8],
        scale: [1, 1, 0.45],
        renderOrder: 5,
      });
    }

    // Character-specific silhouette and accessories.
    this.headPivot.add(this.ponytail);
    if (character.hairStyle === "side-pony") {
      const base = new THREE.Group();
      base.position.set(0.43, 0.2, -0.23);
      base.rotation.z = -0.28;
      this.ponytail.add(base);
      addBow(base, materials, [-0.05, 0.03, 0], 0.82);
      const upper = addOutlined(base, new THREE.SphereGeometry(0.5, 22, 16), materials.hair, materials.outline, {
        position: [0.12, -0.12, -0.02],
        scale: [0.27, 0.48, 0.3],
        rotation: [0, 0, -0.2],
        outline: 1.04,
      });
      const lower = addOutlined(base, new THREE.SphereGeometry(0.5, 22, 16), materials.hair, materials.outline, {
        position: [0.21, -0.46, -0.025],
        scale: [0.24, 0.42, 0.27],
        rotation: [0, 0, -0.34],
        outline: 1.04,
      });
      registerSpring(this.hairSprings, base, 0.3, 0.16, 8.5);
      registerSpring(this.hairSprings, upper, 1.1, 0.08, 8);
      registerSpring(this.hairSprings, lower, 2.0, 0.12, 7);
      addPlain(this.headPivot, makeStarGeometry(0.095, 0.04), materials.metal, {
        position: [-0.29, 0.28, 0.42],
        rotation: [0, 0, -0.2],
        renderOrder: 7,
      });
    } else if (character.hairStyle === "twin-tail") {
      for (const side of [-1, 1] as const) {
        const base = new THREE.Group();
        base.position.set(side * 0.43, 0.14, -0.2);
        base.rotation.z = side * 0.27;
        this.ponytail.add(base);
        addBow(base, materials, [side * 0.02, 0.04, 0], 0.7);
        const upper = addOutlined(base, new THREE.SphereGeometry(0.5, 22, 16), materials.hair, materials.outline, {
          position: [side * 0.08, -0.17, -0.02],
          scale: [0.24, 0.45, 0.27],
          rotation: [0, 0, side * 0.2],
          outline: 1.04,
        });
        const lower = addOutlined(base, new THREE.SphereGeometry(0.5, 22, 16), materials.hair, materials.outline, {
          position: [side * 0.15, -0.48, -0.02],
          scale: [0.2, 0.37, 0.24],
          rotation: [0, 0, side * 0.32],
          outline: 1.04,
        });
        registerSpring(this.hairSprings, base, side * 0.5, 0.15, 8.2);
        registerSpring(this.hairSprings, upper, side * 1.2, 0.08, 7.8);
        registerSpring(this.hairSprings, lower, side * 2.1, 0.12, 7.2);
      }
      addPlain(this.headPivot, makeStarGeometry(0.085, 0.04, 6), materials.metal, {
        position: [0, 0.39, 0.3],
        renderOrder: 7,
      });
    } else {
      for (let index = 0; index < 7; index += 1) {
        const angle = Math.PI * (0.66 + (index / 6) * 0.68);
        const lock = addOutlined(
          this.headPivot,
          new THREE.CapsuleGeometry(0.055, 0.27 + (index % 2) * 0.05, 4, 9),
          materials.hair,
          materials.outline,
          {
            position: [Math.cos(angle) * 0.34, -0.1 + Math.sin(angle) * 0.2, -0.02],
            rotation: [0.08, 0, -angle + Math.PI / 2],
            outline: 1.04,
          },
        );
        registerSpring(this.hairSprings, lock, index * 0.55, 0.025, 11);
      }
      const beret = addOutlined(this.headPivot, new THREE.SphereGeometry(0.5, 24, 14), materials.accent, materials.outline, {
        position: [-0.04, 0.36, -0.03],
        scale: [0.52, 0.13, 0.43],
        rotation: [0.03, 0, -0.13],
        outline: 1.035,
      });
      registerSpring(this.hairSprings, beret, 0.2, 0.012, 12);
      addPlain(this.headPivot, makeDiamondGeometry(0.085), materials.metal, {
        position: [0.23, 0.35, 0.34],
        rotation: [0, 0, 0.18],
        renderOrder: 7,
      });
    }

    // Character-specific outfit details.
    if (character.id === "mio") {
      const cape = new THREE.Group();
      cape.position.set(-0.18, 0.04, -0.23);
      this.torsoPivot.add(cape);
      const capePanel = addOutlined(
        cape,
        new THREE.CapsuleGeometry(0.1, 0.45, 4, 10),
        materials.ribbon,
        materials.outline,
        { rotation: [0.35, 0, -0.18], scale: [1.1, 1, 0.45], outline: 1.04 },
      );
      registerSpring(this.hairSprings, capePanel, 1.8, 0.08, 8.5);
    } else if (character.id === "sena") {
      for (const side of [-1, 1] as const) {
        addPlain(this.torsoPivot, new THREE.BoxGeometry(0.055, 0.42, 0.03), materials.ribbon, {
          position: [side * 0.22, -0.02, 0.3],
          rotation: [0, 0, side * 0.12],
          castShadow: true,
        });
      }
    } else {
      const shoulderBow = addBow(this.torsoPivot, materials, [-0.3, 0.23, 0.05], 0.54);
      shoulderBow.rotation.y = -0.45;
      shoulderBow.rotation.z = -0.35;
    }

    this.bubbleAnchor.position.set(0, 2.56, 0);
    this.root.add(this.bubbleAnchor);
  }

  update(dtSeconds: number, state: PlayerState): void {
    const dt = clamp(dtSeconds, 0, 0.05);
    this.elapsed += dt;

    if (state.motion !== this.previousMotion || state.motionSequence !== this.previousSequence) {
      this.motionAge = 0;
      this.previousMotion = state.motion;
      this.previousSequence = state.motionSequence;
    } else {
      this.motionAge += dt;
    }

    const turnRate = dt > 0 ? wrapAngle(state.yaw - this.previousYaw) / dt : 0;
    this.previousYaw = state.yaw;
    this.smoothedTurnRate = damp(this.smoothedTurnRate, turnRate, 10, dt);

    const speed01 = clamp(state.speed / 4.85, 0, 1);
    const fixedLocomotionLoop = state.motion === "run" || state.motion === "sandori";
    const locomotionEnergy = fixedLocomotionLoop ? 1 : speed01;
    const strideRate = state.motion === "sandori" ? 15.8 : state.motion === "run" ? 13.4 : 2.15;
    this.stridePhase += dt * strideRate;
    const stride = Math.sin(this.stridePhase);
    const secondaryStride = Math.sin(this.stridePhase + Math.PI / 2);

    let bodyY = Math.sin(this.elapsed * 2.25) * 0.012;
    let torsoX = 0;
    let torsoZ = 0;
    let torsoYaw = 0;
    let headZ = 0;
    let headY = 0;
    let leftLegX = 0;
    let rightLegX = 0;
    let leftLegZ = 0;
    let rightLegZ = 0;
    let leftArmX = 0.04;
    let rightArmX = -0.04;
    let leftArmZ = -0.05;
    let rightArmZ = 0.05;
    let racketX = 0.18;
    let racketY = 0;
    let racketZ = -0.2;
    let skirtZ = 0;
    let expressionEnergy = 0;

    if (state.motion === "racket-swing") {
      const t = clamp(this.motionAge / 0.43, 0, 1);
      const strike = t < 0.22 ? t / 0.22 : t < 0.62 ? (t - 0.22) / 0.4 : 1 - (t - 0.62) / 0.38;
      const p = clamp(strike, 0, 1);
      bodyY -= Math.sin(t * Math.PI) * 0.035;
      torsoYaw = (t < 0.22 ? -0.3 : 0.48) * p;
      torsoZ = -0.1 * p;
      headY = -torsoYaw * 0.22;
      leftArmX = -0.2 * p;
      rightArmX = t < 0.22 ? 1.12 * p : -1.24 * p;
      rightArmZ = t < 0.22 ? 0.82 * p : -0.92 * p;
      racketX = t < 0.22 ? 1.0 * p : -1.2 * p;
      racketY = 0.14 * Math.sin(t * Math.PI * 2);
      racketZ = t < 0.22 ? 0.92 * p : -1.28 * p;
      expressionEnergy = p;
    } else if (state.motion === "run") {
      bodyY += Math.abs(secondaryStride) * 0.035;
      torsoX = 0.12;
      torsoZ = clamp(-this.smoothedTurnRate * 0.022, -0.16, 0.16);
      headZ = -torsoZ * 0.35;
      leftLegX = stride * 0.72;
      rightLegX = -stride * 0.72;
      leftArmX = -stride * 0.48;
      rightArmX = stride * 0.48;
      skirtZ = torsoZ * 0.3;
    } else if (state.motion === "sandori") {
      const bank = clamp(-this.smoothedTurnRate * 0.065, -0.34, 0.34);
      bodyY += Math.abs(secondaryStride) * 0.045;
      torsoX = 0.17;
      torsoZ = bank;
      torsoYaw = clamp(this.smoothedTurnRate * 0.028, -0.18, 0.18);
      headZ = -bank * 0.34;
      leftLegX = stride * 0.88;
      rightLegX = -stride * 0.88;
      leftLegZ = -bank * 0.22;
      rightLegZ = -bank * 0.22;
      leftArmX = -0.28 - stride * 0.25;
      rightArmX = -0.28 + stride * 0.25;
      leftArmZ = -0.68;
      rightArmZ = 0.68;
      skirtZ = bank * 0.45;
      expressionEnergy = 0.32;
    } else if (state.motion === "start-left" || state.motion === "start-right") {
      const side = state.motion === "start-left" ? -1 : 1;
      const t = clamp(this.motionAge / 0.19, 0, 1);
      const impulse = Math.sin(t * Math.PI);
      const snap = Math.sin(Math.min(1, t * 1.45) * Math.PI);
      bodyY -= 0.075 * impulse;
      this.visual.position.x = damp(this.visual.position.x, side * 0.065 * impulse, 34, dt);
      torsoX = 0.13 * impulse;
      torsoZ = -side * 0.27 * impulse;
      torsoYaw = side * 0.12 * impulse;
      headZ = side * 0.1 * impulse;
      leftLegX = side < 0 ? -0.36 * snap : 0.58 * snap;
      rightLegX = side > 0 ? -0.36 * snap : 0.58 * snap;
      leftLegZ = side < 0 ? -0.26 * impulse : 0.14 * impulse;
      rightLegZ = side > 0 ? 0.26 * impulse : -0.14 * impulse;
      leftArmX = side < 0 ? 0.42 * impulse : -0.2 * impulse;
      rightArmX = side > 0 ? 0.42 * impulse : -0.2 * impulse;
      skirtZ = torsoZ * 0.35;
      expressionEnergy = impulse * 0.25;
    } else {
      const idleBreath = Math.sin(this.elapsed * 2.1);
      bodyY += idleBreath * 0.012;
      torsoX = idleBreath * 0.025;
      headZ = Math.sin(this.elapsed * 1.35) * 0.025;
      headY = Math.sin(this.elapsed * 0.72 + (this.characterId === "mio" ? 1.2 : 0)) * 0.035;
      leftArmX = 0.06 + idleBreath * 0.025;
      rightArmX = -0.06 - idleBreath * 0.025;
    }

    if (state.motion !== "start-left" && state.motion !== "start-right") {
      this.visual.position.x = damp(this.visual.position.x, 0, 14, dt);
    }

    this.visual.position.y = damp(this.visual.position.y, bodyY, 18, dt);
    this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, torsoX, 20, dt);
    this.torsoPivot.rotation.z = damp(this.torsoPivot.rotation.z, torsoZ, 22, dt);
    this.torsoPivot.rotation.y = damp(this.torsoPivot.rotation.y, torsoYaw, 20, dt);
    this.headPivot.rotation.z = damp(this.headPivot.rotation.z, headZ, 18, dt);
    this.headPivot.rotation.y = damp(this.headPivot.rotation.y, headY, 16, dt);
    this.headPivot.rotation.x = damp(this.headPivot.rotation.x, -torsoX * 0.25, 16, dt);

    this.leftLeg.rotation.x = damp(this.leftLeg.rotation.x, leftLegX, 26, dt);
    this.rightLeg.rotation.x = damp(this.rightLeg.rotation.x, rightLegX, 26, dt);
    this.leftLeg.rotation.z = damp(this.leftLeg.rotation.z, leftLegZ, 24, dt);
    this.rightLeg.rotation.z = damp(this.rightLeg.rotation.z, rightLegZ, 24, dt);
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, leftArmX, 24, dt);
    this.rightArm.rotation.x = damp(this.rightArm.rotation.x, rightArmX, 24, dt);
    this.leftArm.rotation.z = damp(this.leftArm.rotation.z, leftArmZ, 20, dt);
    this.rightArm.rotation.z = damp(this.rightArm.rotation.z, rightArmZ, 20, dt);
    this.racketPivot.rotation.x = damp(this.racketPivot.rotation.x, racketX, 34, dt);
    this.racketPivot.rotation.y = damp(this.racketPivot.rotation.y, racketY, 34, dt);
    this.racketPivot.rotation.z = damp(this.racketPivot.rotation.z, racketZ, 36, dt);
    this.skirt.rotation.z = damp(this.skirt.rotation.z, skirtZ, 16, dt);
    this.skirt.rotation.x = damp(this.skirt.rotation.x, locomotionEnergy * 0.025, 12, dt);

    const blinkCycle = (this.elapsed + (this.characterId === "sena" ? 1.3 : this.characterId === "mio" ? 0.6 : 0)) % 4.15;
    const blink = blinkCycle < 0.14 ? Math.sin((blinkCycle / 0.14) * Math.PI) : 0;
    const eyeScale = clamp(1 - blink * 0.94 + expressionEnergy * 0.05, 0.06, 1.08);
    this.leftEye.root.scale.y = damp(this.leftEye.root.scale.y, eyeScale, 44, dt);
    this.rightEye.root.scale.y = damp(this.rightEye.root.scale.y, eyeScale, 44, dt);
    this.leftEye.iris.position.y = Math.sin(this.elapsed * 0.52) * 0.006;
    this.rightEye.iris.position.y = Math.sin(this.elapsed * 0.52) * 0.006;
    this.leftEye.pupil.scale.y = 1 + expressionEnergy * 0.08;
    this.rightEye.pupil.scale.y = 1 + expressionEnergy * 0.08;
    this.mouth.scale.x = damp(this.mouth.scale.x, 1 + expressionEnergy * 0.28, 18, dt);
    this.mouth.scale.y = damp(this.mouth.scale.y, 1 + expressionEnergy * 0.5, 18, dt);

    const springEnergy = 0.045 + locomotionEnergy * 0.16;
    for (const spring of this.hairSprings) {
      const wave = Math.sin(this.elapsed * (3.4 + spring.response * 0.08) + spring.phase + this.stridePhase * 0.22);
      const turnInfluence = clamp(this.smoothedTurnRate * 0.02, -0.16, 0.16);
      spring.object.rotation.x = damp(
        spring.object.rotation.x,
        spring.restX + Math.abs(stride) * locomotionEnergy * spring.amplitude * 0.35,
        spring.response,
        dt,
      );
      spring.object.rotation.y = damp(
        spring.object.rotation.y,
        spring.restY - turnInfluence * 0.35,
        spring.response,
        dt,
      );
      spring.object.rotation.z = damp(
        spring.object.rotation.z,
        spring.restZ + wave * spring.amplitude * (springEnergy / 0.12) - torsoZ * 0.24,
        spring.response,
        dt,
      );
    }

    const shadowScale = 1 + locomotionEnergy * 0.13;
    this.shadow.scale.x = damp(this.shadow.scale.x, 1.2 * shadowScale, 10, dt);
    this.shadow.scale.y = damp(this.shadow.scale.y, 0.62 * (1 - locomotionEnergy * 0.08), 10, dt);
    const pulse = 1 + Math.sin(this.elapsed * 2.4) * 0.025;
    this.roleRing.scale.setScalar(pulse);
    (this.roleRing.material as THREE.MeshBasicMaterial).opacity = 0.38 + Math.sin(this.elapsed * 2.4) * 0.06;
    this.glowPlane.scale.setScalar(1 + Math.sin(this.elapsed * 1.8) * 0.035 + locomotionEnergy * 0.05);

    this.sparkles.forEach((sparkle, index) => {
      const angle = this.elapsed * (0.45 + (index % 2) * 0.12) + (index / this.sparkles.length) * Math.PI * 2;
      const radius = 0.57 + (index % 3) * 0.07;
      sparkle.position.set(
        Math.cos(angle) * radius,
        0.08 + Math.sin(this.elapsed * 2 + index) * 0.045,
        Math.sin(angle) * radius,
      );
      sparkle.rotation.y = angle;
      sparkle.rotation.x = angle * 0.6;
      sparkle.scale.setScalar(0.75 + Math.sin(this.elapsed * 2.5 + index) * 0.2);
    });
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
      else materials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.ownedTextures.forEach((texture) => texture.dispose());
    this.root.clear();
  }
}
