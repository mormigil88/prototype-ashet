#!/usr/bin/env node
/**
 * write-design-spec.js — Claude-native design-spec generator
 *
 * Receives a design-spec JSON from Kimi's multimodal analysis via stdin or --json arg.
 * Validates against schema, writes to --output.
 * Does NOT call any Vision API — Claude IS the vision.
 *
 * Usage:
 *   node write-design-spec.js --json '<json string>' --output /tmp/design-spec.json
 *   cat spec.json | node write-design-spec.js --output /tmp/design-spec.json
 */
const fs = require('fs');
const path = require('path');

const getArg = (n, def) => {
  const i = process.argv.indexOf('--' + n);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};

const outputPath = getArg('output', null);
let rawJson = getArg('json', null);

// Read from stdin if no --json arg
if (!rawJson && !fs.existsSync(outputPath)) {
  const chunks = [];
  let chunk;
  // Read from stdin (fd 0)
  try {
    while ((chunk = fs.readFileSync('/dev/stdin', 'utf8')) !== null && chunk.length > 0) {
      chunks.push(chunk);
      break; // single read for pipe
    }
  } catch {}
  const stdin = chunks.join('');
  if (stdin.trim()) rawJson = stdin.trim();
}

if (!rawJson && !outputPath) {
  console.error('Usage: node write-design-spec.js --json <json> --output <path>');
  console.error('  Or: cat spec.json | node write-design-spec.js --output <path>');
  process.exit(1);
}

// Parse JSON
let spec;
try {
  spec = JSON.parse(rawJson);
} catch (e) {
  // Try stripping markdown code fences
  const cleaned = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    spec = JSON.parse(cleaned);
  } catch (e2) {
    console.error('[write-design-spec] FATAL: Invalid JSON:', e.message);
    process.exit(1);
  }
}

// Validate required schema fields
const requiredFields = ['canvas', 'palette', 'typography', 'compositionClass', 'components'];
const missing = requiredFields.filter(f => !spec[f]);
if (missing.length > 0) {
  console.error(`[write-design-spec] FATAL: Missing required fields: ${missing.join(', ')}`);
  console.error('Required: canvas, palette, typography, compositionClass, components');
  process.exit(1);
}

// Normalize canvas (backwards compat)
if (!spec.canvas) spec.canvas = spec.sourceCanvas || spec.targetCanvas || { width: 1080, height: 1350 };
if (!spec.targetCanvas) spec.targetCanvas = spec.canvas;
if (!spec.sourceCanvas) spec.sourceCanvas = spec.canvas;

// Default palette fields
const paletteFields = ['background', 'primary', 'secondary', 'accent', 'text', 'textSecondary'];
paletteFields.forEach(f => {
  if (!spec.palette[f]) spec.palette[f] = { value: '#000000', confidence: 0.5 };
});

// Default typography fields
if (!spec.typography.heading) spec.typography.heading = { fontFamily: 'Georgia, serif', fontSize: '52px', fontWeight: 'bold', lineHeight: '1.1' };
if (!spec.typography.body) spec.typography.body = { fontFamily: 'Arial, sans-serif', fontSize: '24px', fontWeight: 'normal', lineHeight: '1.4' };

// Normalize components: each must have type and zone
spec.components = (spec.components || []).map((c, i) => ({
  type: c.type || 'Custom',
  zone: c.zone || { x: 0, y: 0, width: 1080, height: 1350 },
  align: c.align || 'left',
  zIndex: c.zIndex ?? i,
  background: c.background || null,
  foreground: c.foreground || null,
  borderRadius: c.borderRadius ?? 0,
  opacity: c.opacity ?? 1,
  confidence: c.confidence ?? 0.7,
  notes: c.notes || '',
  unsupported: c.unsupported || false
}));

// Add metadata
spec.specVersion = '1.0';
spec.generatedBy = 'claude-native-multimodal';
spec.generatedAt = new Date().toISOString();

// Write output
if (!outputPath) {
  console.error('[write-design-spec] FATAL: --output <path> is required');
  process.exit(1);
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.error(`[write-design-spec] ✓ design-spec written: ${outputPath}`);
console.error(`  canvas: ${spec.canvas.width}x${spec.canvas.height}`);
console.error(`  composition: ${spec.compositionClass}`);
console.error(`  components: ${spec.components.length}`);
console.error(`  palette.bg: ${spec.palette.background?.value}`);
