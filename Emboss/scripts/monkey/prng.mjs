// Seeded random numbers for the monkey test (Emboss/scripts/monkey-test.mjs). Every random choice in a run comes from here,
// so a run is exactly reproducible from its seed.

// xmur3: turns any list of strings/numbers into one 32-bit seed.
export function hashSeed(...parts) {
  const str = parts.map(String).join('\u0001');
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32 with helpers.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),                          // 0 .. n-1
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),  // lo .. hi inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // weighted([[weight, value], ...]) -> value
    weighted: (pairs) => {
      let total = 0;
      for (const [w] of pairs) total += w;
      let x = next() * total;
      for (const [w, v] of pairs) { x -= w; if (x < 0) return v; }
      return pairs[pairs.length - 1][1];
    },
    // a fraction in [0,1), rounded so it prints short in the replay files
    frac: () => Math.round(next() * 10000) / 10000,
  };
}
