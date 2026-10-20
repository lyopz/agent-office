// The avatar's movement and camera: WASD/arrow keys, Shift to run, drag or
// pointer-lock to look, first/third person, a little hop on Space, and the
// fast-travel glide through the tubes. Movement math is pure (no DOM); the
// view component feeds it keys and pointer deltas.
import type * as THREE from 'three';
import type { NavGraph } from '../engine/navigation';
import { inTube, moveWithCollision, PLAYER_RADIUS } from './collision';
import type { XZ } from './layout';
import { glideSpeed, sampleRoute, type TravelRoute } from './travel';

export type CameraMode = 'first' | 'third';

export const WALK_SPEED = 4.2;
export const RUN_SPEED = 7.6;
export const TUBE_BOOST = 1.5;

export interface MoveInput { forward: number; right: number; turn: number; run: boolean }

export function inputFromKeys(keys: Set<string>): MoveInput {
  const has = (...k: string[]) => k.some((x) => keys.has(x));
  return {
    forward: (has('KeyW', 'ArrowUp', 'pad-up') ? 1 : 0) - (has('KeyS', 'ArrowDown', 'pad-down') ? 1 : 0),
    right: (has('KeyD', 'pad-right') ? 1 : 0) - (has('KeyA', 'pad-left') ? 1 : 0),
    turn: (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0),
    run: has('ShiftLeft', 'ShiftRight'),
  };
}

/** Forward and right vectors for a yaw angle (yaw 0 looks north, towards -z). */
export const forwardOf = (yaw: number): XZ => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const rightOf = (yaw: number): XZ => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

export interface Glide { route: TravelRoute; d: number; speed: number; onDone?: () => void }

export class PlayerController {
  pos: XZ; y = 0; vy = 0;
  vel: XZ = { x: 0, z: 0 };
  yaw = 0; pitchFirst = 0; pitchThird = 0.32; dist = 4.6;
  facing = 0;                     // avatar body yaw
  mode: CameraMode;
  glide: Glide | null = null;
  moving = false; running = false; tube = false;
  private camPos: { x: number; y: number; z: number } | null = null;

  constructor(pos: XZ, mode: CameraMode, yaw = 0) { this.pos = { ...pos }; this.mode = mode; this.yaw = yaw; this.facing = yaw + Math.PI; }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0042;
    if (this.mode === 'first') this.pitchFirst = Math.max(-1.35, Math.min(1.35, this.pitchFirst - dy * 0.0036));
    else this.pitchThird = Math.max(-0.15, Math.min(1.25, this.pitchThird + dy * 0.0036));
  }
  zoom(delta: number) { this.dist = Math.max(2.4, Math.min(10, this.dist * (1 + delta * 0.001))); }
  jump() { if (this.y <= 0.001 && !this.glide) this.vy = 4.2; }

  startGlide(route: TravelRoute, cut: boolean, onDone?: () => void) {
    if (cut) {
      this.pos = { ...route.target }; this.vel = { x: 0, z: 0 }; this.glide = null; this.camPos = null;
      const s = sampleRoute(route.points, route.length);
      if (Math.hypot(s.dir.x, s.dir.z) > 0.1) { this.yaw = Math.atan2(-s.dir.x, -s.dir.z); this.facing = Math.atan2(s.dir.x, s.dir.z); }
      onDone?.();
      return;
    }
    this.glide = { route, d: 0, speed: glideSpeed(route.length), onDone };
  }
  cancelGlide() { if (this.glide) { const g = this.glide; this.glide = null; g.onDone?.(); } }

  /** Advance one frame. Returns true when the avatar moved. */
  update(dt: number, nav: NavGraph, input: MoveInput): boolean {
    const before = { ...this.pos };
    this.yaw -= input.turn * dt * 2.2;
    if (this.glide) {
      if (input.forward || input.right) { this.cancelGlide(); }
      else {
        const g = this.glide;
        g.d += g.speed * dt;
        const s = sampleRoute(g.route.points, g.d);
        this.pos = s.p;
        const targetYaw = Math.atan2(-s.dir.x, -s.dir.z);
        this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-dt * 5));
        this.facing = Math.atan2(s.dir.x, s.dir.z);
        this.tube = inTube(nav, this.pos);
        this.moving = true; this.running = true;
        if (s.done) { this.glide = null; this.moving = false; g.onDone?.(); }
        return true;
      }
    }
    this.tube = inTube(nav, this.pos);
    const f = forwardOf(this.yaw), r = rightOf(this.yaw);
    let dx = f.x * input.forward + r.x * input.right, dz = f.z * input.forward + r.z * input.right;
    const len = Math.hypot(dx, dz);
    const speed = (input.run ? RUN_SPEED : WALK_SPEED) * (this.tube ? TUBE_BOOST : 1);
    if (len > 0) { dx = (dx / len) * speed; dz = (dz / len) * speed; }
    const k = 1 - Math.exp(-dt * (len > 0 ? 10 : 14));
    this.vel.x += (dx - this.vel.x) * k; this.vel.z += (dz - this.vel.z) * k;
    if (Math.abs(this.vel.x) < 1e-3 && Math.abs(this.vel.z) < 1e-3 && !len) { this.vel.x = this.vel.z = 0; }
    const m = moveWithCollision(nav, this.pos, this.vel.x * dt, this.vel.z * dt, PLAYER_RADIUS);
    this.pos = { x: m.x, z: m.z };
    // jump
    if (this.vy || this.y > 0) { this.vy -= 12 * dt; this.y = Math.max(0, this.y + this.vy * dt); if (this.y === 0) this.vy = 0; }
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.moving = moved > 0.15 * dt;
    this.running = this.moving && input.run;
    if (this.moving) this.facing = lerpAngle(this.facing, Math.atan2(this.pos.x - before.x, this.pos.z - before.z), 1 - Math.exp(-dt * 12));
    return moved > 0;
  }

  /** Place the camera. `eye` is the avatar's eye height; bob adds a gentle step bounce unless reduced. */
  applyCamera(cam: THREE.PerspectiveCamera, eye: number, dt: number, t: number, reduced: boolean) {
    if (this.mode === 'first') {
      const bob = !reduced && this.moving && !this.tube ? Math.sin(t * (this.running ? 13 : 9)) * 0.035 : 0;
      cam.position.set(this.pos.x, eye + this.y + bob, this.pos.z);
      cam.rotation.set(this.pitchFirst, this.yaw, 0, 'YXZ');
      this.camPos = null;
      return;
    }
    const f = forwardOf(this.yaw);
    const tx = this.pos.x, ty = eye * 0.86 + this.y, tz = this.pos.z;
    // inside a tube the camera tucks in close and low so it stays within the glass
    const pitch = this.tube ? Math.min(this.pitchThird, 0.16) : this.pitchThird;
    const dist = this.tube ? Math.min(this.dist, 3.2) : this.dist;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const want = { x: tx - f.x * dist * cp, y: ty + dist * sp + (this.tube ? 0.15 : 0.3), z: tz - f.z * dist * cp };
    if (!this.camPos || reduced) this.camPos = want;
    else {
      const k = 1 - Math.exp(-dt * 12);
      this.camPos = { x: this.camPos.x + (want.x - this.camPos.x) * k, y: this.camPos.y + (want.y - this.camPos.y) * k, z: this.camPos.z + (want.z - this.camPos.z) * k };
    }
    cam.position.set(this.camPos.x, Math.max(0.35, this.camPos.y), this.camPos.z);
    cam.lookAt(tx, ty, tz);
  }
}

export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
