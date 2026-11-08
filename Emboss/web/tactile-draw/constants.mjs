// Tactile drawing tool (W14): the physical sizes everything is measured in. All drawing units are millimetres on the embossed page.
// Sources: BANA "Guidelines and Standards for Tactile Graphics" (2010 web edition, brailleauthority.org/tg/web-manual/tgmanual.html; the 2022
// PDF was too large to read here, so numbers from it are NOT verified) - section numbers are given beside each value.
// The braille cell pitch (6.2 mm) and line pitch (10 mm) are the usual embosser values; BANA 3.4.1 gives no figures ("varies by embosser"),
// and the dot pitch (2.5 mm) is the standard dot-to-dot distance in a cell. These three are conventions, not BANA numbers.
export const MM = {
  dot: 2.5,            // distance between dots in a cell: the snap grid
  cell: 6.2,           // width of one braille cell, cell to cell
  line: 10,            // height of one braille line
  labelH: 5,           // height of a one-line braille label: three dot rows 2.5 mm apart
  inch: 25.4,
  minArea: 6.35 * 6.35,      // 3.4.3.1: "minimum size 1/4 square inch (6 square millimeters)". BANA's two figures disagree (1/4 sq in is 161 mm2,
  minAreaSide: 6.35,         // 6 mm2 is far smaller); the smaller reading is used: an area at least 1/4 inch (6.35 mm) square, so no false alarms.
  minLine: 12.7,       // 3.4.3.2: a primary line is at least 1/2 inch (1.25 cm) long
  minSymbol: 6.35,     // 3.4.3.11: a point symbol is at least 1/4 inch (6 mm) across
  labelGap: 3,         // 3.4.3.12: a label sits at least 1/8 inch (3 mm) from other components (and at most 1/4 inch, 6 mm, away)
  labelGapMax: 6,
  haloGap: 3,          // 3.4.3.13: a label inside an area texture has 1/8 inch (3 mm) of blank space on all sides
  dashMin: 6.35, dashMax: 9.5,   // 3.4.3.3: each dash 1/4 to 3/8 inch, gaps about half that
  keyAreaW: 25.4, keyAreaH: 12.7, // 3.4.3.14 / 5.9.1: an area sample in the key is 1 inch wide, 1/2 inch high
  keyLine: 25.4,       // 5.9.2: a line sample in the key is 1 inch long
  maxCells: 40, maxLines: 25,    // 3.4.2.1 / 3.4.2.2: at most 40 cells wide and 25 lines long
};
export const LIMITS = { textures: 5, lines: 5, symbols: 5 };   // 3.2.2: no more than five of each in one graphic
