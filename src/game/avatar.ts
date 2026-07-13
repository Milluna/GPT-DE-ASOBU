import * as THREE from "three";
import type { CharacterId } from "../characters";
import type { MotionName, PlayerRole, PlayerState } from "../types";
import {
  AvatarRig as BeautifulAvatarRig,
  BEAUTIFUL_AVATAR_VERSION,
} from "./beautifulAvatar";
import {
  computeTauntMotionOverlay,
  TAUNT_MOTION_PROFILE_VERSION,
  type TauntMotionOverlay,
} from "./tauntMotionOverlay";

export { BEAUTIFUL_AVATAR_VERSION, TAUNT_MOTION_PROFILE_VERSION };

type BeautifulRigInternals = {
  visual: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  skirt: THREE.Group;
  racketPivot: THREE.Group;
};

export class AvatarRig {
  readonly root: THREE.Group;
  readonly bubbleAnchor: THREE.Object3D;
  readonly visualVersion = BEAUTIFUL_AVATAR_VERSION;
  readonly tauntMotionProfile = TAUNT_MOTION_PROFILE_VERSION;

  private readonly delegate: BeautifulAvatarRig;
  private readonly internals: BeautifulRigInternals;
  private appliedOverlay = computeTauntMotionOverlay("idle", 0);
  private motionAge = 0;
  private previousMotion: MotionName = "idle";
  private previousSequence = -1;

  constructor(role: PlayerRole, characterId: CharacterId) {
    this.delegate = new BeautifulAvatarRig(role, characterId);
    this.root = this.delegate.root;
    this.bubbleAnchor = this.delegate.bubbleAnchor;
    this.internals = this.delegate as unknown as BeautifulRigInternals;
  }

  update(dtSeconds: number, state: PlayerState): void {
    const dt = Math.min(Math.max(dtSeconds, 0), 0.05);
    const changed =
      state.motion !== this.previousMotion || state.motionSequence !== this.previousSequence;

    if (changed) {
      this.motionAge = 0;
      this.previousMotion = state.motion;
      this.previousSequence = state.motionSequence;
    } else {
      this.motionAge += dt;
    }

    this.removeOverlay(this.appliedOverlay);
    this.delegate.update(dt, state);
    this.appliedOverlay = computeTauntMotionOverlay(state.motion, this.motionAge);
    this.applyOverlay(this.appliedOverlay);
  }

  dispose(): void {
    this.removeOverlay(this.appliedOverlay);
    this.delegate.dispose();
  }

  private applyOverlay(overlay: TauntMotionOverlay): void {
    const rig = this.internals;
    rig.visual.position.x += overlay.visualX;
    rig.visual.position.y += overlay.visualY;
    rig.torsoPivot.rotation.x += overlay.torsoX;
    rig.torsoPivot.rotation.y += overlay.torsoY;
    rig.torsoPivot.rotation.z += overlay.torsoZ;
    rig.headPivot.rotation.y += overlay.headY;
    rig.headPivot.rotation.z += overlay.headZ;
    rig.leftLeg.rotation.x += overlay.leftLegX;
    rig.rightLeg.rotation.x += overlay.rightLegX;
    rig.leftLeg.rotation.z += overlay.leftLegZ;
    rig.rightLeg.rotation.z += overlay.rightLegZ;
    rig.leftArm.rotation.x += overlay.leftArmX;
    rig.rightArm.rotation.x += overlay.rightArmX;
    rig.leftArm.rotation.z += overlay.leftArmZ;
    rig.rightArm.rotation.z += overlay.rightArmZ;
    rig.racketPivot.rotation.x += overlay.racketX;
    rig.racketPivot.rotation.y += overlay.racketY;
    rig.racketPivot.rotation.z += overlay.racketZ;
    rig.skirt.rotation.x += overlay.skirtX;
    rig.skirt.rotation.z += overlay.skirtZ;
  }

  private removeOverlay(overlay: TauntMotionOverlay): void {
    const rig = this.internals;
    rig.visual.position.x -= overlay.visualX;
    rig.visual.position.y -= overlay.visualY;
    rig.torsoPivot.rotation.x -= overlay.torsoX;
    rig.torsoPivot.rotation.y -= overlay.torsoY;
    rig.torsoPivot.rotation.z -= overlay.torsoZ;
    rig.headPivot.rotation.y -= overlay.headY;
    rig.headPivot.rotation.z -= overlay.headZ;
    rig.leftLeg.rotation.x -= overlay.leftLegX;
    rig.rightLeg.rotation.x -= overlay.rightLegX;
    rig.leftLeg.rotation.z -= overlay.leftLegZ;
    rig.rightLeg.rotation.z -= overlay.rightLegZ;
    rig.leftArm.rotation.x -= overlay.leftArmX;
    rig.rightArm.rotation.x -= overlay.rightArmX;
    rig.leftArm.rotation.z -= overlay.leftArmZ;
    rig.rightArm.rotation.z -= overlay.rightArmZ;
    rig.racketPivot.rotation.x -= overlay.racketX;
    rig.racketPivot.rotation.y -= overlay.racketY;
    rig.racketPivot.rotation.z -= overlay.racketZ;
    rig.skirt.rotation.x -= overlay.skirtX;
    rig.skirt.rotation.z -= overlay.skirtZ;
  }
}
