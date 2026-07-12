import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "app";
const pathOf = (file) => join(root, file);
const read = (file) => readFileSync(pathOf(file), "utf8");
const write = (file, content) => writeFileSync(pathOf(file), content);

function replaceOnce(file, from, to) {
  const source = read(file);
  if (!source.includes(from)) throw new Error(`v1.2 patch anchor missing: ${file}`);
  write(file, source.replace(from, to));
}

// Slightly narrower playable width. The camera adjustment below does most of the work.
replaceOnce(
  "src/game/locomotion.ts",
  "boundaryX: 4.35, boundaryZ: 4.85,",
  "boundaryX: 4.12, boundaryZ: 4.85,",
);

// The old acceleration test drove directly into the new net and correctly stopped at it.
// Keep acceleration coverage independent from collision by testing a lateral run instead.
replaceOnce(
  "tests/locomotion.test.ts",
  `    let now = step(controller, { x: 0, y: 1 }, 30);
    expect(controller.speed).toBeGreaterThan(4);
    expect(controller.z).toBeLessThan(1.65);`,
  `    let now = step(controller, { x: 1, y: 0 }, 30);
    expect(controller.speed).toBeGreaterThan(4);
    expect(controller.x).toBeGreaterThan(1);`,
);

// Add a short solid collision strip at z=0, leaving generous passages at both sides.
replaceOnce(
  "src/game/locomotion.ts",
  "    this.x += this.velocityX * dt; this.z += this.velocityZ * dt;",
  `    const oldX = this.x;
    const oldZ = this.z;
    let nextX = oldX + this.velocityX * dt;
    let nextZ = oldZ + this.velocityZ * dt;
    const netHalfWidth = 2.15;
    const netHalfDepth = 0.10;
    const playerRadius = 0.24;
    const blockedHalfWidth = netHalfWidth + playerRadius;
    const blockedHalfDepth = netHalfDepth + playerRadius;
    const entersNetBand =
      (oldZ < -blockedHalfDepth && nextZ >= -blockedHalfDepth) ||
      (oldZ > blockedHalfDepth && nextZ <= blockedHalfDepth) ||
      (Math.abs(oldZ) <= blockedHalfDepth && Math.abs(nextZ) <= blockedHalfDepth);
    if (entersNetBand && Math.abs(nextX) < blockedHalfWidth) {
      nextZ = oldZ < 0 ? -blockedHalfDepth : blockedHalfDepth;
      this.velocityZ = 0;
    }
    this.x = nextX;
    this.z = nextZ;`,
);

// Regression coverage for the center wall and its intentionally open side passages.
replaceOnce(
  "tests/locomotion.test.ts",
  `  it("keeps the player inside the stage boundary", () => {`,
  `  it("blocks a straight crossing through the middle of the net", () => {
    const controller = new LocomotionController();
    step(controller, { x: 0, y: 1 }, 120);
    expect(controller.z).toBeGreaterThanOrEqual(0.34 - 1e-6);
    expect(controller.z).toBeLessThanOrEqual(0.34 + 1e-6);
  });

  it("allows crossing through an open side of the net", () => {
    const controller = new LocomotionController();
    controller.reset(3.1, 1.65, Math.PI);
    step(controller, { x: 0, y: 1 }, 120);
    expect(controller.z).toBeLessThan(-0.5);
  });

  it("keeps the player inside the stage boundary", () => {`,
);

// Add a transparent, abbreviated center net with visible frame and open side passages.
replaceOnce(
  "src/game/game.ts",
  "  // Soft decorative floating motes. These are intentionally sparse for mobile GPUs.",
  `  // Short transparent center net. The sides are intentionally open for circling taunts.
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

  // Soft decorative floating motes. These are intentionally sparse for mobile GPUs.`,
);

// Portrait phones have a much narrower horizontal field of view. Back the camera up adaptively.
replaceOnce(
  "src/game/game.ts",
  `    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);`,
  `    this.camera.aspect = width / height;
    const cameraSign = this.role === "host" ? 1 : -1;
    const portraitPenalty = Math.max(0, 0.72 - this.camera.aspect);
    const distance = 10.35 + portraitPenalty * 9.5;
    const cameraHeight = 6.65 + portraitPenalty * 2.2;
    this.camera.position.set(0, cameraHeight, distance * cameraSign);
    this.camera.lookAt(0, 0.82, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);`,
);

// Correct the racket swing front/back direction. The avatar faces local +Z.
replaceOnce(
  "src/game/avatar.ts",
  `      torsoYaw = (t < 0.22 ? 0.25 : -0.42) * p;
      torsoZ = (t < 0.22 ? 0.08 : -0.12) * p;
      leftArmX = 0.2 * p;
      rightArmX = t < 0.22 ? -0.95 * p : 1.15 * p;
      rightArmZ = t < 0.22 ? -0.88 * p : 0.84 * p;
      racketX = t < 0.22 ? -0.25 * p : 1.1 * p;
      racketY = 0.16 * Math.sin(t * Math.PI * 2);
      racketZ = t < 0.22 ? -1.0 * p : 1.25 * p;`,
  `      torsoYaw = (t < 0.22 ? -0.3 : 0.48) * p;
      torsoZ = -0.1 * p;
      leftArmX = -0.2 * p;
      rightArmX = t < 0.22 ? -1.12 * p : 1.24 * p;
      rightArmZ = t < 0.22 ? 0.82 * p : -0.92 * p;
      racketX = t < 0.22 ? -1.0 * p : 1.2 * p;
      racketY = 0.14 * Math.sin(t * Math.PI * 2);
      racketZ = t < 0.22 ? 0.92 * p : -1.28 * p;`,
);

console.log("Applied AORI ROOM v1.2 camera, net, collision, swing, and regression-test patch");
