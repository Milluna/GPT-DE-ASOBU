import { test, expect } from "@playwright/test";

const liveUrl = process.env.LIVE_URL;
if (!liveUrl) throw new Error("LIVE_URL is required");

async function openTitle(page, suffix) {
  await page.goto(`${liveUrl}?transport=p2p&run=${suffix}`, { waitUntil: "domcontentloaded" });
  await page.locator(".title-preview--ready").waitFor({ state: "attached", timeout: 45_000 });
  await expect(page.locator(".title-preview__canvas")).toBeVisible();
}

test("beautiful 3D static production supports two-player P2P", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await openTitle(host, `host-${Date.now()}`);
  await host.locator(".entry-button--create").click();
  await host.locator(".game-screen").waitFor({ timeout: 45_000 });
  const roomCode = (await host.locator(".room-identity__code").textContent())?.trim();
  expect(roomCode).toMatch(/^\d{5}$/);

  await openTitle(guest, `guest-${Date.now()}`);
  await guest.locator('.character-card[data-character="mio"]').click();
  await guest.locator(".entry-button--join").click();
  await guest.locator(".room-code-input").fill(roomCode);
  await guest.locator(".modal-card .primary-button").click();
  await guest.locator(".game-screen").waitFor({ timeout: 45_000 });

  await expect(host.locator(".participant-card")).toHaveClass(/has-peer/, { timeout: 45_000 });
  await expect(guest.locator(".participant-card")).toHaveClass(/has-peer/, { timeout: 45_000 });
  await expect(host.locator(".participant-pill--peer")).toContainText("ミオ", { timeout: 45_000 });
  await expect(host.locator("canvas.game-canvas")).toBeVisible();
  await expect(guest.locator("canvas.game-canvas")).toBeVisible();

  await host.screenshot({ path: "static-live-artifacts/host-room.png", fullPage: true });
  await guest.screenshot({ path: "static-live-artifacts/guest-room.png", fullPage: true });

  await hostContext.close();
  await guestContext.close();
});
