// Tactile drawing tool (W14): plain-English descriptions of shapes, for the layers list and for what a screen reader is told.
import { KIND_NAMES, bbox } from './model.mjs';
import { lineStyle, textureById, symbolById } from './tactile.mjs';

const mm = (v) => String(Math.round(v * 10) / 10);

/** "Rectangle 2" - the shape's own name, or its kind and its number among shapes of that kind. */
export function shapeName(doc, s) {
  if (s.name) return s.name;
  if (s.kind === 'text') return s.text ? `Label "${s.text}"` : 'Label';
  const same = doc.all().filter((x) => x.kind === s.kind && !x.name);
  const n = same.indexOf(s) + 1;
  return `${KIND_NAMES[s.kind] || s.kind} ${n || 1}`;
}

/** A longer description: name, styles, size and place. */
export function describeShape(doc, s) {
  const parts = [shapeName(doc, s)];
  if (s.kind === 'symbol') parts.push(symbolById(s.symbol).name);
  if (s.line && s.line !== 'none') parts.push(`${lineStyle(s.line).name.toLowerCase()} line`);
  if (s.kind === 'text') parts.push(`${Array.from(s.braille || '').length} braille cells`);
  if (s.texture && s.texture !== 'none' && textureById(s.texture)) parts.push(`${textureById(s.texture).name.toLowerCase()} texture`);
  const b = bbox(s);
  parts.push(`${mm(b.width)} by ${mm(b.height)} millimetres at ${mm(b.x)}, ${mm(b.y)}`);
  if (s.locked) parts.push('locked');
  return parts.join(', ');
}

export const cellAt = (p, MM) => `cell ${Math.floor(p.x / MM.cell) + 1}, line ${Math.floor(p.y / MM.line) + 1}`;
