// Curated Tactile SVG Library Catalog for Emboss
// Provides foundational STEM, Geography, Biology, and Geometry vector diagrams
// ready for 1-click insertion and instant tactile transpilation.

export const TACTILE_SVG_CATEGORIES = [
  { id: 'math', name: '📐 Geometry & Math' },
  { id: 'biology', name: '🔬 Biology & Anatomy' },
  { id: 'physics', name: '⚡ Physics & Circuits' },
  { id: 'geography', name: '🌍 Geography & Maps' },
  { id: 'charts', name: '📊 Charts & Diagrams' },
];

export const TACTILE_SVG_LIBRARY = [
  // 1. Right-Angled Triangle
  {
    id: 'geom_right_triangle',
    category: 'math',
    title: 'Right-Angled Triangle',
    desc: '3-4-5 right triangle with right-angle indicator and labeled vertices A, B, C',
    keywords: ['triangle', 'right angle', 'pythagoras', 'geometry', 'math', 'trigonometry'],
    svg: `<svg viewBox="0 0 300 200" width="300" height="200" xmlns="http://www.w3.org/2000/svg">
      <polygon points="50,170 250,170 50,40" fill="#e0f2fe" stroke="#000000" stroke-width="3" />
      <rect x="50" y="150" width="20" height="20" fill="none" stroke="#000000" stroke-width="2" />
      <text x="30" y="180" font-size="16" fill="#000000">A</text>
      <text x="260" y="180" font-size="16" fill="#000000">B</text>
      <text x="30" y="35" font-size="16" fill="#000000">C</text>
      <text x="140" y="190" font-size="14" fill="#000000">b = 4</text>
      <text x="15" y="110" font-size="14" fill="#000000">a = 3</text>
      <text x="160" y="95" font-size="14" fill="#000000">c = 5</text>
    </svg>`
  },
  // 2. Cartesian Coordinate Grid
  {
    id: 'math_cartesian_grid',
    category: 'math',
    title: 'Cartesian Coordinate Axes (X & Y)',
    desc: 'Four-quadrant coordinate plane with origin O and labeled X and Y axes',
    keywords: ['graph', 'axes', 'cartesian', 'quadrant', 'coordinate', 'x-axis', 'y-axis'],
    svg: `<svg viewBox="0 0 260 260" width="260" height="260" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="240" height="240" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,4" />
      <line x1="20" y1="130" x2="240" y2="130" stroke="#000000" stroke-width="3" />
      <polyline points="232,125 242,130 232,135" fill="#000000" />
      <line x1="130" y1="240" x2="130" y2="20" stroke="#000000" stroke-width="3" />
      <polyline points="125,28 130,18 135,28" fill="#000000" />
      <text x="245" y="135" font-size="16" fill="#000000">x</text>
      <text x="125" y="15" font-size="16" fill="#000000">y</text>
      <text x="115" y="145" font-size="14" fill="#000000">O</text>
      <circle cx="180" cy="80" r="5" fill="#ef4444" stroke="#000000" stroke-width="1.5" />
      <text x="190" y="75" font-size="14" fill="#000000">P (2, 3)</text>
    </svg>`
  },
  // 3. Circle with Radius & Tangent
  {
    id: 'geom_circle_radius',
    category: 'math',
    title: 'Circle with Radius and Tangent Line',
    desc: 'Circle with center O, radius r, and perpendicular tangent line T',
    keywords: ['circle', 'radius', 'tangent', 'diameter', 'geometry', 'pi'],
    svg: `<svg viewBox="0 0 280 220" width="280" height="220" xmlns="http://www.w3.org/2000/svg">
      <circle cx="120" cy="110" r="70" fill="#fef3c7" stroke="#000000" stroke-width="3" />
      <circle cx="120" cy="110" r="4" fill="#000000" />
      <line x1="120" y1="110" x2="190" y2="110" stroke="#000000" stroke-width="2.5" />
      <line x1="190" y1="20" x2="190" y2="200" stroke="#000000" stroke-width="3" />
      <text x="105" y="115" font-size="15" fill="#000000">O</text>
      <text x="150" y="100" font-size="14" fill="#000000">r</text>
      <text x="200" y="30" font-size="15" fill="#000000">T</text>
    </svg>`
  },
  // 4. Animal / Plant Cell Structure
  {
    id: 'bio_plant_cell',
    category: 'biology',
    title: 'Plant Cell Structure',
    desc: 'Cell diagram with cell wall, membrane, nucleus, vacuole, and chloroplast',
    keywords: ['cell', 'biology', 'plant cell', 'nucleus', 'membrane', 'vacuole', 'chloroplast'],
    svg: `<svg viewBox="0 0 320 220" width="320" height="220" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="20" width="280" height="180" rx="25" fill="#dcfce7" stroke="#000000" stroke-width="4" />
      <rect x="28" y="28" width="264" height="164" rx="20" fill="#f0fdf4" stroke="#166534" stroke-width="2" />
      <circle cx="90" cy="110" r="38" fill="#fbcfe8" stroke="#000000" stroke-width="2.5" />
      <circle cx="90" cy="110" r="14" fill="#be185d" stroke="#000000" stroke-width="2" />
      <ellipse cx="200" cy="110" rx="55" ry="38" fill="#dbeafe" stroke="#000000" stroke-width="2" />
      <ellipse cx="140" cy="55" rx="18" ry="10" fill="#86efac" stroke="#000000" stroke-width="1.5" />
      <ellipse cx="170" cy="165" rx="18" ry="10" fill="#86efac" stroke="#000000" stroke-width="1.5" />
      <text x="65" y="170" font-size="14" fill="#000000">Nucleus</text>
      <text x="180" y="115" font-size="14" fill="#000000">Vacuole</text>
      <text x="210" y="195" font-size="14" fill="#000000">Cell Wall</text>
    </svg>`
  },
  // 5. Electrical Circuit (Series)
  {
    id: 'phys_series_circuit',
    category: 'physics',
    title: 'Series Electric Circuit',
    desc: 'Basic electrical circuit with battery, switch, resistor, and lamp',
    keywords: ['circuit', 'physics', 'electricity', 'resistor', 'battery', 'switch', 'current'],
    svg: `<svg viewBox="0 0 300 200" width="300" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="30" width="240" height="140" fill="none" stroke="#000000" stroke-width="3" />
      <!-- Battery -->
      <rect x="25" y="85" width="10" height="30" fill="#ffffff" stroke="none" />
      <line x1="20" y1="90" x2="40" y2="90" stroke="#000000" stroke-width="3.5" />
      <line x1="25" y1="110" x2="35" y2="110" stroke="#000000" stroke-width="2" />
      <!-- Resistor -->
      <rect x="110" y="20" width="60" height="20" fill="#fed7aa" stroke="#000000" stroke-width="2.5" />
      <!-- Lamp -->
      <circle cx="270" cy="100" r="16" fill="#fef08a" stroke="#000000" stroke-width="2.5" />
      <line x1="259" y1="89" x2="281" y2="111" stroke="#000000" stroke-width="2" />
      <line x1="259" y1="111" x2="281" y2="89" stroke="#000000" stroke-width="2" />
      <text x="125" y="65" font-size="14" fill="#000000">R</text>
      <text x="5" y="105" font-size="14" fill="#000000">V</text>
      <text x="215" y="105" font-size="14" fill="#000000">Lamp</text>
    </svg>`
  },
  // 6. Compass Rose / Cardinal Directions
  {
    id: 'geo_compass_rose',
    category: 'geography',
    title: 'Compass Rose (Cardinal Directions)',
    desc: 'Navigation compass indicating North, South, East, and West',
    keywords: ['compass', 'navigation', 'map', 'north', 'south', 'east', 'west', 'geography'],
    svg: `<svg viewBox="0 0 240 240" width="240" height="240" xmlns="http://www.w3.org/2000/svg">
      <circle cx="120" cy="120" r="95" fill="#f1f5f9" stroke="#000000" stroke-width="2.5" />
      <!-- North point -->
      <polygon points="120,30 112,120 120,120" fill="#000000" stroke="#000000" stroke-width="1.5" />
      <polygon points="120,30 128,120 120,120" fill="#e2e8f0" stroke="#000000" stroke-width="1.5" />
      <!-- South point -->
      <polygon points="120,210 112,120 120,120" fill="#e2e8f0" stroke="#000000" stroke-width="1.5" />
      <polygon points="120,210 128,120 120,120" fill="#000000" stroke="#000000" stroke-width="1.5" />
      <!-- East point -->
      <polygon points="210,120 120,112 120,120" fill="#000000" stroke="#000000" stroke-width="1.5" />
      <polygon points="210,120 120,128 120,120" fill="#e2e8f0" stroke="#000000" stroke-width="1.5" />
      <!-- West point -->
      <polygon points="30,120 120,112 120,120" fill="#e2e8f0" stroke="#000000" stroke-width="1.5" />
      <polygon points="30,120 120,128 120,120" fill="#000000" stroke="#000000" stroke-width="1.5" />
      <text x="115" y="22" font-size="18" font-weight="bold" fill="#000000">N</text>
      <text x="115" y="235" font-size="18" font-weight="bold" fill="#000000">S</text>
      <text x="222" y="126" font-size="18" font-weight="bold" fill="#000000">E</text>
      <text x="8" y="126" font-size="18" font-weight="bold" fill="#000000">W</text>
    </svg>`
  },
  // 7. Pie Chart / Proportions
  {
    id: 'chart_pie_fractions',
    category: 'charts',
    title: 'Pie Chart (3 Categories)',
    desc: 'Circular slice chart showing 50%, 25%, and 25% proportions with distinct sector fills',
    keywords: ['chart', 'pie chart', 'fractions', 'percentage', 'statistics', 'graph'],
    svg: `<svg viewBox="0 0 260 220" width="260" height="220" xmlns="http://www.w3.org/2000/svg">
      <!-- Sector 1: 50% (Left Half) -->
      <path d="M 120 110 L 120 30 A 80 80 0 0 0 120 190 Z" fill="#93c5fd" stroke="#000000" stroke-width="3" />
      <!-- Sector 2: 25% (Top Right) -->
      <path d="M 120 110 L 200 110 A 80 80 0 0 0 120 30 Z" fill="#fca5a5" stroke="#000000" stroke-width="3" />
      <!-- Sector 3: 25% (Bottom Right) -->
      <path d="M 120 110 L 120 190 A 80 80 0 0 0 200 110 Z" fill="#86efac" stroke="#000000" stroke-width="3" />
      <text x="50" y="115" font-size="15" fill="#000000">50%</text>
      <text x="145" y="75" font-size="15" fill="#000000">25%</text>
      <text x="145" y="155" font-size="15" fill="#000000">25%</text>
    </svg>`
  }
];

if (typeof window !== 'undefined') {
  window.TACTILE_SVG_LIBRARY = TACTILE_SVG_LIBRARY;
  window.TACTILE_SVG_CATEGORIES = TACTILE_SVG_CATEGORIES;
}
