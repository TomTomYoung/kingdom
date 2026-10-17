import { Hex } from '../world/hex.js';

export const HEX_SIZE = 38;
export function hexPosition(hex) { return { x: HEX_SIZE * Math.sqrt(3) * (hex.q + hex.r / 2), y: HEX_SIZE * 1.5 * hex.r }; }

export class MapCamera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; }
  centerOn(hex) { Object.assign(this, hexPosition(hex)); }
  project(hex, width, height) {
    const p = hexPosition(hex);
    return { x: width / 2 + (p.x - this.x) * this.zoom, y: height / 2 + (p.y - this.y) * this.zoom };
  }
  worldAt(x, y, width, height) { return { x: this.x + (x - width / 2) / this.zoom, y: this.y + (y - height / 2) / this.zoom }; }
  hexAt(x, y, width, height) {
    const p = this.worldAt(x, y, width, height);
    const q = (Math.sqrt(3) / 3 * p.x - p.y / 3) / HEX_SIZE, r = 2 / 3 * p.y / HEX_SIZE;
    return Hex.round(q, r, -q - r);
  }
  setZoom(value, width, height, anchor = { x: width / 2, y: height / 2 }) {
    const before = this.worldAt(anchor.x, anchor.y, width, height);
    this.zoom = Math.max(1, Math.min(3, Math.round(value)));
    this.x = before.x - (anchor.x - width / 2) / this.zoom;
    this.y = before.y - (anchor.y - height / 2) / this.zoom;
  }
  clamp(radius, width, height) {
    const x = Math.max(0, (radius + 1) * Math.sqrt(3) * HEX_SIZE - width / (2 * this.zoom));
    const y = Math.max(0, (radius * 1.5 + 1.5) * HEX_SIZE - height / (2 * this.zoom));
    this.x = x ? Math.max(-x, Math.min(x, this.x)) : 0; this.y = y ? Math.max(-y, Math.min(y, this.y)) : 0;
  }
}
