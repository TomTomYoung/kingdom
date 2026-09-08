export class Hex {
  constructor(q, r, s = -q - r) {
    if (![q, r, s].every(Number.isFinite) || Math.abs(q + r + s) > 1e-9) {
      throw new TypeError('Hex cube coordinates must be finite and sum to zero');
    }
    this.q = q;
    this.r = r;
    this.s = s;
    Object.freeze(this);
  }

  get key() { return `${this.q},${this.r},${this.s}`; }
  add(other) { return new Hex(this.q + other.q, this.r + other.r, this.s + other.s); }
  neighbor(direction) { return this.add(HEX_DIRECTIONS[direction]); }
  distance(other) { return Math.max(Math.abs(this.q - other.q), Math.abs(this.r - other.r), Math.abs(this.s - other.s)); }
  equals(other) { return this.q === other.q && this.r === other.r && this.s === other.s; }

  static fromKey(key) {
    const values = key.split(',').map(Number);
    if (values.length !== 3) throw new TypeError(`Invalid hex key: ${key}`);
    return new Hex(...values);
  }

  static round(q, r, s = -q - r) {
    let rq = Math.round(q); let rr = Math.round(r); let rs = Math.round(s);
    const dq = Math.abs(rq - q); const dr = Math.abs(rr - r); const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    else rs = -rq - rr;
    return new Hex(Object.is(rq, -0) ? 0 : rq, Object.is(rr, -0) ? 0 : rr, Object.is(rs, -0) ? 0 : rs);
  }

  static range(center, radius) {
    const result = [];
    for (let q = -radius; q <= radius; q += 1) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r += 1) {
        result.push(center.add(new Hex(q, r, -q - r)));
      }
    }
    return result;
  }
}

export const HEX_DIRECTIONS = Object.freeze([
  new Hex(1, -1, 0), new Hex(1, 0, -1), new Hex(0, 1, -1),
  new Hex(-1, 1, 0), new Hex(-1, 0, 1), new Hex(0, -1, 1),
]);

export function edgeKey(a, b) {
  if (a.distance(b) !== 1) throw new TypeError('An edge requires adjacent hexes');
  return [a.key, b.key].sort().join('|');
}
