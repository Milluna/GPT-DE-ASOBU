import * as THREE from "three";
import type { MotionName, PlayerRole, PlayerState } from "../types";

interface AvatarPalette {
  hair: string;
  hairShadow: string;
  outfit: string;
  outfitAccent: string;
  eye: string;
  ribbon: string;
}

const PALETTES: Record<PlayerRole, AvatarPalette> = {
  host: {
    hair: "#6d3b78",
    hairShadow: "#38264c",
    outfit: "#ff86ac",
    outfitAccent: "#8d73f3",
    eye: "#6f58d9",
    ribbon: "#62d9e5",
  },
  guest: {
    hair: "#315b69",
    hairShadow: "#213a4c",
    outfit: "#62d7c7",
    outfitAccent: "#5d83ec",
    eye: "#3d7ec7",
    ribbon: "#ff9bc0",
  },
};

const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x261f37,
  side: THREE.BackSide,
  depthWrite: true,
});

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

function makeFabricTexture(primary: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable.");

  const gradient = ctx.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, primary);
  gradient.addColorStop(0.55, primary);
  gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  for (let x = -256; x < 512; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 256, 256);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#ffffff";
  for (let y = 18; y < 256; y += 42) {
    for (let x = 18; x < 256; x += 42) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.25, 1.25);
  texture.anisotropy = 4;
  return texture;
}

function makeFaceTexture(eyeColor: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable.");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawEye = (cx: number): void => {
    const gradient = ctx.createLinearGradient(cx, 105, cx, 248);
    gradient.addColorStop(0, "#201b36");
    gradient.addColorStop(0.45, eyeColor);
    gradient.addColorStop(1, "#9feaf5");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(cx, 180, 52, 73, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.96)";
    ctx.beginPath();
    ctx.ellipse(cx - 18, 146, 15, 23, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 17, 201, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#2e2442";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 49, 106);
    ctx.quadraticCurveTo(cx, 80, cx + 50, 108);
    ctx.stroke();
  };

  drawEye(155);
  drawEye(357);

  ctx.globalAlpha = 0.34;
  ctx.fillStyle = "#ff7f9e";
  ctx.beginPath();
  ctx.ellipse(80, 270, 46, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(432, 270, 46, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "#8c4b72";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(256, 254, 34, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function toonMaterial(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial(map ? { color, map } : { color });
}

function addOutlinedMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    outline?: number;
  } = {},
): THREE.Mesh {
  const holder = new THREE.Group();
  if (options.position) holder.position.set(...options.position);
  if (options.rotation) holder.rotation.set(...options.rotation);
  if (options.scale) holder.scale.set(...options.scale);
  parent.add(holder);

  const outlineScale = options.outline ?? 1.035;
  const outline = new THREE.Mesh(geometry, OUTLINE_MATERIAL);
  outline.scale.setScalar(outlineScale);
  holder.add(outline);

  const mesh = new THREE.Mesh(geometry, material);
  holder.add(mesh);
  return mesh;
}

function addPlainMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

export class AvatarRig {
  readonly root = new THREE.Group();
  readonly bubbleAnchor = new THREE.Object3D();

  private readonly visual = new THREE.Group();
  private readonly torsoPivot = new THREE.Group();
  private readonly headPivot = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly ponytail = new THREE.Group();
  private readonly skirt = new THREE.Group();
  private readonly racketPivot = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly ownedTextures: THREE.Texture[] = [];

  private elapsed = Math.random() * 10;
  private stridePhase = Math.random() * Math.PI * 2;
  private motionAge = 0;
  private previousMotion: MotionName = "idle";
  private previousSequence = -1;
  private previousYaw = Math.PI;
  private smoothedTurnRate = 0;

  constructor(role: PlayerRole) {
    const palette = PALETTES[role];
    const fabricTexture = makeFabricTexture(palette.outfit, palette.outfitAccent);
    const faceTexture = makeFaceTexture(palette.eye);
    this.ownedTextures.push(fabricTexture, faceTexture);

    const skin = toonMaterial("#ffd4c8");
    const skinShadow = toonMaterial("#efb4aa");
    const hair = toonMaterial(palette.hair);
    const hairShadow = toonMaterial(palette.hairShadow);
    const cloth = toonMaterial("#ffffff", fabricTexture);
    const clothAccent = toonMaterial(palette.outfitAccent);
    const ribbon = toonMaterial(palette.ribbon);
    const white = toonMaterial("#fffaf7");
    const dark = toonMaterial("#443b61");

    this.root.name = `${role}-avatar`;
    this.root.add(this.visual);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x211b32,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow);

    // Legs and chunky shoes. The total figure is approximately three heads tall.
    this.leftLeg.position.set(-0.145, 0.88, 0);
    this.rightLeg.position.set(0.145, 0.88, 0);
    this.visual.add(this.leftLeg, this.rightLeg);
    const legGeometry = new THREE.CapsuleGeometry(0.105, 0.43, 4, 10);
    addOutlinedMesh(this.leftLeg, legGeometry, skinShadow, {
      position: [0, -0.33, 0],
      outline: 1.045,
    });
    addOutlinedMesh(this.rightLeg, legGeometry, skinShadow, {
      position: [0, -0.33, 0],
      outline: 1.045,
    });

    const sockGeometry = new THREE.CapsuleGeometry(0.12, 0.13, 3, 10);
    addOutlinedMesh(this.leftLeg, sockGeometry, white, {
      position: [0, -0.61, 0.015],
      outline: 1.045,
    });
    addOutlinedMesh(this.rightLeg, sockGeometry, white, {
      position: [0, -0.61, 0.015],
      outline: 1.045,
    });

    const shoeGeometry = new THREE.SphereGeometry(0.5, 18, 12);
    addOutlinedMesh(this.leftLeg, shoeGeometry, dark, {
      position: [0, -0.77, 0.08],
      scale: [0.34, 0.18, 0.48],
      outline: 1.055,
    });
    addOutlinedMesh(this.rightLeg, shoeGeometry, dark, {
      position: [0, -0.77, 0.08],
      scale: [0.34, 0.18, 0.48],
      outline: 1.055,
    });

    // Torso and short layered skirt.
    this.torsoPivot.position.y = 1.16;
    this.visual.add(this.torsoPivot);
    const torsoGeometry = new THREE.SphereGeometry(0.5, 24, 16);
    addOutlinedMesh(this.torsoPivot, torsoGeometry, cloth, {
      scale: [0.47, 0.56, 0.34],
      outline: 1.04,
    });

    this.skirt.position.set(0, -0.26, 0);
    this.torsoPivot.add(this.skirt);
    const skirtGeometry = new THREE.CylinderGeometry(0.25, 0.42, 0.29, 24, 1, false);
    addOutlinedMesh(this.skirt, skirtGeometry, clothAccent, {
      outline: 1.035,
    });
    const skirtBandGeometry = new THREE.TorusGeometry(0.265, 0.035, 8, 24);
    addOutlinedMesh(this.skirt, skirtBandGeometry, ribbon, {
      position: [0, 0.13, 0],
      rotation: [Math.PI / 2, 0, 0],
      outline: 1.04,
    });

    // Arms are kept deliberately readable at phone size.
    this.leftArm.position.set(-0.31, 0.2, 0);
    this.rightArm.position.set(0.31, 0.2, 0);
    this.torsoPivot.add(this.leftArm, this.rightArm);
    const armGeometry = new THREE.CapsuleGeometry(0.085, 0.35, 4, 10);
    addOutlinedMesh(this.leftArm, armGeometry, skin, {
      position: [0, -0.23, 0],
      outline: 1.05,
    });
    addOutlinedMesh(this.rightArm, armGeometry, skin, {
      position: [0, -0.23, 0],
      outline: 1.05,
    });
    const cuffGeometry = new THREE.CylinderGeometry(0.11, 0.095, 0.14, 12);
    addOutlinedMesh(this.leftArm, cuffGeometry, clothAccent, {
      position: [0, -0.05, 0],
      outline: 1.045,
    });
    addOutlinedMesh(this.rightArm, cuffGeometry, clothAccent, {
      position: [0, -0.05, 0],
      outline: 1.045,
    });
    this.racketPivot.position.set(0, -0.46, 0.02);
    this.rightArm.add(this.racketPivot);
    addOutlinedMesh(this.racketPivot, new THREE.CylinderGeometry(0.035, 0.045, 0.48, 10), dark, { position: [0, -0.2, 0], outline: 1.08 });
    addOutlinedMesh(this.racketPivot, new THREE.TorusGeometry(0.235, 0.034, 9, 28), clothAccent, { position: [0, -0.65, 0], scale: [0.82, 1.14, 1], outline: 1.07 });

    // Head: ~0.72 units tall on a ~2.18 unit figure, giving an original three-head silhouette.
    this.headPivot.position.set(0, 1.79, 0);
    this.visual.add(this.headPivot);
    const headGeometry = new THREE.SphereGeometry(0.5, 32, 22);
    addOutlinedMesh(this.headPivot, headGeometry, skin, {
      scale: [0.67, 0.72, 0.62],
      outline: 1.035,
    });

    const backHairGeometry = new THREE.SphereGeometry(0.5, 28, 20);
    addOutlinedMesh(this.headPivot, backHairGeometry, hairShadow, {
      position: [0, 0.035, -0.08],
      scale: [0.71, 0.75, 0.68],
      outline: 1.035,
    });

    // Re-add the face shell slightly forward so hair stays behind it.
    addOutlinedMesh(this.headPivot, headGeometry, skin, {
      position: [0, -0.015, 0.055],
      scale: [0.645, 0.69, 0.57],
      outline: 1.025,
    });

    const faceMaterial = new THREE.MeshBasicMaterial({
      map: faceTexture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      toneMapped: false,
    });
    const face = addPlainMesh(
      this.headPivot,
      new THREE.PlaneGeometry(0.68, 0.51),
      faceMaterial,
      [0, -0.015, 0.357],
    );
    face.renderOrder = 4;

    // Hair cap and asymmetric side ponytail keep the silhouette distinct from any existing character.
    const capGeometry = new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
    addOutlinedMesh(this.headPivot, capGeometry, hair, {
      position: [0, 0.08, 0.025],
      scale: [0.69, 0.73, 0.64],
      outline: 1.035,
    });

    const bangGeometry = new THREE.CapsuleGeometry(0.045, 0.19, 3, 8);
    const bangOffsets: Array<[number, number, number, number]> = [
      [-0.22, 0.12, 0.34, -0.42],
      [-0.11, 0.14, 0.37, -0.22],
      [0, 0.13, 0.385, 0.04],
      [0.11, 0.14, 0.37, 0.24],
      [0.22, 0.12, 0.34, 0.42],
    ];
    for (const [x, y, z, rotationZ] of bangOffsets) {
      addOutlinedMesh(this.headPivot, bangGeometry, hair, {
        position: [x, y, z],
        rotation: [0.08, 0, rotationZ],
        outline: 1.05,
      });
    }

    const lockGeometry = new THREE.CapsuleGeometry(0.065, 0.34, 4, 9);
    addOutlinedMesh(this.headPivot, lockGeometry, hair, {
      position: [-0.325, -0.08, 0.1],
      rotation: [0.08, 0, -0.08],
      outline: 1.045,
    });
    addOutlinedMesh(this.headPivot, lockGeometry, hair, {
      position: [0.325, -0.08, 0.1],
      rotation: [0.08, 0, 0.08],
      outline: 1.045,
    });

    this.ponytail.position.set(0.37, 0.17, -0.25);
    this.headPivot.add(this.ponytail);
    const tailGeometry = new THREE.SphereGeometry(0.5, 18, 14);
    addOutlinedMesh(this.ponytail, tailGeometry, hair, {
      position: [0.09, -0.05, 0],
      scale: [0.26, 0.52, 0.28],
      rotation: [0, 0, -0.34],
      outline: 1.045,
    });
    const ribbonGeometry = new THREE.ConeGeometry(0.13, 0.26, 4);
    addOutlinedMesh(this.ponytail, ribbonGeometry, ribbon, {
      position: [-0.05, 0.1, 0.01],
      rotation: [0, 0, Math.PI / 4],
      outline: 1.055,
    });

    this.bubbleAnchor.position.set(0, 2.38, 0);
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
    const strideRate = state.motion === "sandori" ? 15.8 : state.motion === "run" ? 13.4 : 2.2;
    this.stridePhase += dt * strideRate;
    const stride = Math.sin(this.stridePhase);
    const secondaryStride = Math.sin(this.stridePhase + Math.PI / 2);

    let bodyY = Math.sin(this.elapsed * 2.25) * 0.012;
    let torsoX = 0;
    let torsoZ = 0;
    let torsoYaw = 0;
    let headZ = 0;
    let leftLegX = 0;
    let rightLegX = 0;
    let leftLegZ = 0;
    let rightLegZ = 0;
    let leftArmX = 0;
    let rightArmX = 0;
    let leftArmZ = -0.04;
    let rightArmZ = 0.04;
    let racketX = 0.18;
    let racketY = 0;
    let racketZ = -0.2;
    let skirtZ = 0;

    if (state.motion === "racket-swing") {
      const t = clamp(this.motionAge / 0.43, 0, 1);
      const strike = t < 0.22 ? t / 0.22 : t < 0.62 ? (t - 0.22) / 0.4 : 1 - (t - 0.62) / 0.38;
      const p = clamp(strike, 0, 1);
      bodyY -= Math.sin(t * Math.PI) * 0.035;
      torsoYaw = (t < 0.22 ? -0.3 : 0.48) * p;
      torsoZ = -0.1 * p;
      leftArmX = -0.2 * p;
      // Positive X moves the hanging hand toward local -Z (behind); negative X moves it toward +Z (front).
      rightArmX = t < 0.22 ? 1.12 * p : -1.24 * p;
      rightArmZ = t < 0.22 ? 0.82 * p : -0.92 * p;
      racketX = t < 0.22 ? 1.0 * p : -1.2 * p;
      racketY = 0.14 * Math.sin(t * Math.PI * 2);
      racketZ = t < 0.22 ? 0.92 * p : -1.28 * p;
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
    } else {
      const idleBreath = Math.sin(this.elapsed * 2.1);
      bodyY += idleBreath * 0.012;
      torsoX = idleBreath * 0.025;
      headZ = Math.sin(this.elapsed * 1.35) * 0.025;
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

    const tailTarget =
      Math.sin(this.elapsed * 4.4 + this.stridePhase * 0.28) * (0.06 + locomotionEnergy * 0.17) -
      torsoZ * 0.4;
    this.ponytail.rotation.z = damp(this.ponytail.rotation.z, tailTarget, 11, dt);
    this.ponytail.rotation.x = damp(
      this.ponytail.rotation.x,
      0.06 + Math.abs(stride) * locomotionEnergy * 0.1,
      10,
      dt,
    );

    const shadowScale = 1 + locomotionEnergy * 0.13;
    this.shadow.scale.set(
      damp(this.shadow.scale.x, shadowScale, 10, dt),
      damp(this.shadow.scale.y, 1 - locomotionEnergy * 0.08, 10, dt),
      1,
    );
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else if (object.material !== OUTLINE_MATERIAL) {
        object.material.dispose();
      }
    });
    this.ownedTextures.forEach((texture) => texture.dispose());
  }
}
