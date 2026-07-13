import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const avatarFacade = read("src/game/avatar.ts");
const avatar = read("src/game/beautifulAvatar.ts");
const tauntMotion = read("src/game/tauntMotionOverlay.ts");
const preview = read("src/titlePreview.ts");
const main = read("src/main.ts");
const styles = read("src/beautiful3d.css");

assert.match(avatarFacade, /beautifulAvatar/);
assert.match(avatarFacade, /computeTauntMotionOverlay/);
assert.match(avatarFacade, /TAUNT_MOTION_PROFILE_VERSION/);
assert.match(avatar, /BEAUTIFUL_AVATAR_VERSION\s*=\s*"beautiful-3d-v3"/);
assert.match(avatar, /class AvatarRig/);
assert.match(avatar, /MeshPhysicalMaterial/);
assert.match(avatar, /createEye/);
assert.match(avatar, /hairSprings/);
assert.match(tauntMotion, /low-stance-taunts-v1/);
assert.match(tauntMotion, /Start on the low, wide endpoint pose of a shuttle run/);
assert.match(tauntMotion, /Begin already coiled and low/);
assert.match(preview, /class TitleCharacterPreview/);
assert.match(preview, /title-preview--ready/);
assert.match(preview, /new AvatarRig/);
assert.match(main, /installTitlePreview\(\)/);
assert.match(main, /beautiful3d\.css/);
assert.match(styles, /\.title-preview__canvas/);
assert.match(styles, /LIVE 3D/);

console.log("beautiful 3D visual contract: ok");
