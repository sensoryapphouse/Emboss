import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'tests/broad_corpus');

if (!fs.existsSync(CORPUS_DIR)) {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
}

console.log('Fetching diverse open-access textbooks and documents for broad comparative test...');

const sources = [
  // 1. Project Gutenberg & Standard Ebooks Accessible EPUBs / HTMLs
  {
    name: 'pride_and_prejudice.epub',
    url: 'https://www.gutenberg.org/ebooks/1342.epub3.images'
  },
  {
    name: 'frankenstein.epub',
    url: 'https://www.gutenberg.org/ebooks/84.epub3.images'
  },
  {
    name: 'alice_in_wonderland.epub',
    url: 'https://www.gutenberg.org/ebooks/11.epub3.images'
  },
  {
    name: 'great_expectations.epub',
    url: 'https://www.gutenberg.org/ebooks/1400.epub3.images'
  },
  {
    name: 'a_tale_of_two_cities.epub',
    url: 'https://www.gutenberg.org/ebooks/98.epub3.images'
  },
  {
    name: 'the_time_machine.epub',
    url: 'https://www.gutenberg.org/ebooks/35.epub3.images'
  },
  {
    name: 'the_war_of_the_worlds.epub',
    url: 'https://www.gutenberg.org/ebooks/36.epub3.images'
  },
  {
    name: 'the_odyssey.epub',
    url: 'https://www.gutenberg.org/ebooks/1727.epub3.images'
  },
  {
    name: 'moby_dick.epub',
    url: 'https://www.gutenberg.org/ebooks/2701.epub3.images'
  },
  {
    name: 'dracula.epub',
    url: 'https://www.gutenberg.org/ebooks/345.epub3.images'
  },
  {
    name: 'romeo_and_juliet.epub',
    url: 'https://www.gutenberg.org/ebooks/1513.epub3.images'
  },
  {
    name: 'macbeth.epub',
    url: 'https://www.gutenberg.org/ebooks/1533.epub3.images'
  },
  {
    name: 'hamlet.epub',
    url: 'https://www.gutenberg.org/ebooks/1524.epub3.images'
  },
  {
    name: 'the_republic_plato.epub',
    url: 'https://www.gutenberg.org/ebooks/1497.epub3.images'
  },
  {
    name: 'the_prince_machiavelli.epub',
    url: 'https://www.gutenberg.org/ebooks/1232.epub3.images'
  },
  {
    name: 'the_adventures_of_sherlock_holmes.epub',
    url: 'https://www.gutenberg.org/ebooks/1661.epub3.images'
  },
  {
    name: 'the_hound_of_the_baskervilles.epub',
    url: 'https://www.gutenberg.org/ebooks/2852.epub3.images'
  },
  {
    name: 'treasure_island.epub',
    url: 'https://www.gutenberg.org/ebooks/120.epub3.images'
  },
  {
    name: 'the_picture_of_dorian_gray.epub',
    url: 'https://www.gutenberg.org/ebooks/174.epub3.images'
  },
  {
    name: 'grimms_fairy_tales.epub',
    url: 'https://www.gutenberg.org/ebooks/2591.epub3.images'
  },
  {
    name: 'the_yellow_wallpaper.epub',
    url: 'https://www.gutenberg.org/ebooks/1952.epub3.images'
  },
  {
    name: 'metamorphosis_kafka.epub',
    url: 'https://www.gutenberg.org/ebooks/5200.epub3.images'
  },
  {
    name: 'les_miserables_french.epub',
    url: 'https://www.gutenberg.org/ebooks/17489.epub3.images'
  },
  {
    name: 'don_quijote_spanish.epub',
    url: 'https://www.gutenberg.org/ebooks/2000.epub3.images'
  },
  {
    name: 'faust_german.epub',
    url: 'https://www.gutenberg.org/ebooks/2229.epub3.images'
  },
  {
    name: 'the_art_of_war_sun_tzu.epub',
    url: 'https://www.gutenberg.org/ebooks/17405.epub3.images'
  },
  {
    name: 'wealth_of_nations_adam_smith.epub',
    url: 'https://www.gutenberg.org/ebooks/3300.epub3.images'
  },
  {
    name: 'origin_of_species_darwin.epub',
    url: 'https://www.gutenberg.org/ebooks/1228.epub3.images'
  },
  {
    name: 'relativity_einstein.epub',
    url: 'https://www.gutenberg.org/ebooks/30155.epub3.images'
  },
  {
    name: 'principia_mathematica_newton.epub',
    url: 'https://www.gutenberg.org/ebooks/28233.epub3.images'
  }
];

async function downloadFile(url, dest) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (EmbossBrailleTest/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buf));
    return { ok: true, size: buf.byteLength };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  let downloaded = 0;
  for (const src of sources) {
    const dest = path.join(CORPUS_DIR, src.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`[EXISTS] ${src.name} (${(fs.statSync(dest).size / 1024).toFixed(1)} KB)`);
      downloaded++;
      continue;
    }
    process.stdout.write(`Fetching ${src.name}... `);
    const res = await downloadFile(src.url, dest);
    if (res.ok) {
      console.log(`OK (${(res.size / 1024).toFixed(1)} KB)`);
      downloaded++;
    } else {
      console.log(`FAILED: ${res.error}`);
    }
  }
  console.log(`\nCompleted: ${downloaded} / ${sources.length} documents ready in ${CORPUS_DIR}`);
}

main();
