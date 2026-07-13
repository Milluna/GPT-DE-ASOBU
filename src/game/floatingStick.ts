import type { StickInput } from "./locomotion";

const INTERACTIVE_SELECTOR = "button, input, textarea, select, a, [data-no-stick]";

export interface FloatingStickOptions {
  radius?: number;
  activationDistance?: number;
  onPress?: () => void;
  onMoveStart?: () => void;
}

export class FloatingStick {
  readonly element: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly surface: HTMLElement;
  private readonly radius: number;
  private readonly activationDistance: number;
  private readonly onPress: (() => void) | undefined;
  private readonly onMoveStart: (() => void) | undefined;
  private activePointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private movementActivated = false;
  private input: StickInput = { x: 0, y: 0 };

  constructor(surface: HTMLElement, overlay: HTMLElement, options: FloatingStickOptions = {}) {
    this.surface = surface;
    this.radius = options.radius ?? 64;
    this.activationDistance = options.activationDistance ?? 9;
    this.onPress = options.onPress;
    this.onMoveStart = options.onMoveStart;
    this.element = document.createElement("div");
    this.element.className = "floating-stick";
    this.element.setAttribute("aria-hidden", "true");
    this.knob = document.createElement("div");
    this.knob.className = "floating-stick__knob";
    this.element.append(this.knob);
    overlay.append(this.element);
    surface.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    surface.addEventListener("pointermove", this.onPointerMove, { passive: false });
    surface.addEventListener("pointerup", this.onPointerEnd, { passive: false });
    surface.addEventListener("pointercancel", this.onPointerEnd, { passive: false });
    surface.addEventListener("lostpointercapture", this.onPointerEnd);
  }

  get value(): StickInput { return this.input; }

  destroy(): void {
    this.surface.removeEventListener("pointerdown", this.onPointerDown);
    this.surface.removeEventListener("pointermove", this.onPointerMove);
    this.surface.removeEventListener("pointerup", this.onPointerEnd);
    this.surface.removeEventListener("pointercancel", this.onPointerEnd);
    this.surface.removeEventListener("lostpointercapture", this.onPointerEnd);
    this.element.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.movementActivated = false;
    this.input = { x: 0, y: 0 };
    this.surface.setPointerCapture(event.pointerId);
    this.element.style.left = this.originX + "px";
    this.element.style.top = this.originY + "px";
    this.element.classList.add("is-active");
    this.knob.style.transform = "translate3d(0, 0, 0)";
    this.onPress?.();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > this.radius ? this.radius / distance : 1;
    const x = dx * scale;
    const y = dy * scale;
    if (!this.movementActivated && distance >= this.activationDistance) {
      this.movementActivated = true;
      this.onMoveStart?.();
    }
    this.input = this.movementActivated ? { x: x / this.radius, y: -y / this.radius } : { x: 0, y: 0 };
    this.knob.style.transform = "translate3d(" + x + "px, " + y + "px, 0)";
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    if (this.surface.hasPointerCapture(event.pointerId)) this.surface.releasePointerCapture(event.pointerId);
    this.activePointerId = null;
    this.movementActivated = false;
    this.input = { x: 0, y: 0 };
    this.element.classList.remove("is-active");
    this.knob.style.transform = "translate3d(0, 0, 0)";
  };
}
