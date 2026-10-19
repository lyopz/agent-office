// Builds public/graph-pow.html (Graph POW, the glowing file map) for the app's
// "Graph POW" button. With no arguments it rebuilds from graphify-out/graph.json
// using graph_pow.py; with --from <file> it installs an existing graph-pow.html.
//   npm run graph:pow
//   npm run graph:pow -- --from path/to/graph-pow.html
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'public', 'graph-pow.html');
const args = process.argv.slice(2);
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;

let body;
if (from) {
  body = fs.readFileSync(path.resolve(from), 'utf8');
} else {
  const graph = path.join(root, 'graphify-out', 'graph.json');
  if (!fs.existsSync(graph)) { console.error('No graphify-out/graph.json. Run graphify on this folder first, or pass --from <graph-pow.html>.'); process.exit(1); }
  const tmp = path.join(root, 'graphify-out', 'graph-pow.html');
  const py = ['python3', 'python', 'py'].find((c) => spawnSync(c, ['--version']).status === 0);
  if (!py) { console.error('Python 3 is needed to build Graph POW.'); process.exit(1); }
  const purposes = path.join(root, 'docs', 'graph-pow', 'purposes.json');
  const r = spawnSync(py, [path.join(here, 'graph_pow.py'), '--graph', graph, '--root', root, '--template', path.join(here, 'template.html'), '--title', 'Agent Office', '--out', tmp, ...(fs.existsSync(purposes) ? ['--purposes', purposes] : [])], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  body = fs.readFileSync(tmp, 'utf8');
}
// graph_pow writes an artifact body; give it a document shell so browsers use standards mode
if (!/^\s*<!doctype/i.test(body)) body = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n${body}\n</html>\n`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`Graph POW written to ${path.relative(root, out)} (${Math.round(body.length / 1024)} KB)`);
