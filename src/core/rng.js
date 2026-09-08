export class SeededRng {
  constructor(seed = 1, state = seed) {
    this.seed = seed >>> 0;
    this.state = state >>> 0;
  }
  next() {
    let value = this.state;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }
  integer(maxExclusive) { return Math.floor(this.next() * maxExclusive); }
  pick(values) { return values.length ? values[this.integer(values.length)] : undefined; }
  toJSON() { return { seed: this.seed, state: this.state }; }
  static fromJSON(value) { return new SeededRng(value.seed, value.state); }
}
