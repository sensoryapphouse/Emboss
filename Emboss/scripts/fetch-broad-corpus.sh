#!/bin/bash
set -e
mkdir -p tests/broad_corpus
cd tests/broad_corpus

echo "Downloading broad open-access corpus in parallel (8 workers)..."

cat << 'LIST' > /tmp/book_list.txt
84 frankenstein.epub
1342 pride_and_prejudice.epub
11 alice_in_wonderland.epub
1400 great_expectations.epub
98 a_tale_of_two_cities.epub
35 the_time_machine.epub
36 the_war_of_the_worlds.epub
1727 the_odyssey_homer.epub
2701 moby_dick.epub
345 dracula.epub
1513 romeo_and_juliet.epub
1533 macbeth.epub
1524 hamlet.epub
1497 the_republic_plato.epub
1232 the_prince_machiavelli.epub
1661 sherlock_holmes.epub
2852 hound_of_the_baskervilles.epub
120 treasure_island.epub
174 picture_of_dorian_gray.epub
2591 grimms_fairy_tales.epub
1952 yellow_wallpaper.epub
5200 metamorphosis_kafka.epub
17489 les_miserables_french.epub
2000 don_quijote_spanish.epub
2229 faust_german.epub
17405 art_of_war_sun_tzu.epub
3300 wealth_of_nations_smith.epub
1228 origin_of_species_darwin.epub
30155 relativity_einstein.epub
28233 principia_mathematica_newton.epub
4300 ulysses_joyce.epub
2600 war_and_peace.epub
76 huckleberry_finn.epub
16 peter_pan.epub
28054 the_brothers_karamazov.epub
215 call_of_the_wild.epub
1260 jane_eyre.epub
768 wuthering_heights.epub
160 the_awakening_chopin.epub
19942 candide_voltaire.epub
LIST

download_one() {
  id=$1
  file=$2
  if [ -f "$file" ] && [ $(wc -c < "$file") -gt 10000 ]; then
    echo "  [EXISTS] $file"
    return 0
  fi
  echo "  Downloading $file (ID: $id)..."
  curl -L -A "Mozilla/5.0" -s -o "$file" "https://www.gutenberg.org/cache/epub/${id}/pg${id}-images.epub" || \
  curl -L -A "Mozilla/5.0" -s -o "$file" "https://www.gutenberg.org/cache/epub/${id}/pg${id}.epub.images"
  echo "  Finished $file ($(du -h "$file" | cut -f1))"
}

export -f download_one
cat /tmp/book_list.txt | xargs -n 2 -P 8 bash -c 'download_one "$@"' _

echo "Broad corpus download finished!"
ls -lh tests/broad_corpus
