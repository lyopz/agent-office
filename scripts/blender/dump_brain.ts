// Writes the app's procedural brain as a PLY for scripts/blender/brain_lowpoly.py:
// region tint in RGB, fold (1 = crown of a gyrus, 0 = groove) in alpha.
//   npx vite-node scripts/blender/dump_brain.ts out/brain_hi.ply
import fs from 'node:fs';
import { buildBrainGeometry } from '../../src/brain/brainMesh';

const out = process.argv[2] ?? 'brain_hi.ply';
const g = buildBrainGeometry(64);
const p = g.attributes.position.array as Float32Array, f = g.attributes.fold.array as Float32Array, t = g.attributes.tint.array as Float32Array;
const idx = g.index!.array;
const n = p.length / 3, m = idx.length / 3;
const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
const lines = [`ply\nformat ascii 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\nelement face ${m}\nproperty list uchar int vertex_indices\nend_header\n`];
for (let i = 0; i < n; i++) lines.push(`${p[i * 3].toFixed(5)} ${p[i * 3 + 1].toFixed(5)} ${p[i * 3 + 2].toFixed(5)} ${c(t[i * 3])} ${c(t[i * 3 + 1])} ${c(t[i * 3 + 2])} ${c(f[i])}\n`);
for (let i = 0; i < m; i++) lines.push(`3 ${idx[i * 3]} ${idx[i * 3 + 1]} ${idx[i * 3 + 2]}\n`);
fs.writeFileSync(out, lines.join(''));
console.log(`wrote ${out}: ${n} vertices, ${m} triangles`);
