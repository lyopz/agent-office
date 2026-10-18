---
name: graph-pow
description: Build or refresh Graph POW, the glowing file-relationship graph for this repo (docs/graph-pow/graph-pow.html). Use when asked for Graph POW, a file map, dependency graph, "neural map", or to see how files connect.
---

# Graph POW

A dark, brain-like map with one glowing node per file. Labelled links explain why files connect (imports, calls, types, tests, docs), and fast signals fire along the nerves and cascade from file to file. It has search, link-type and folder filters, 1- and 2-hop focus, and path tracing. The design is fixed in `templates/graph-pow.html`, so reuse it unchanged. `references/design.md` has the full style, layout and interaction rules.

This repo's copies:
- `docs/graph-pow/graph-pow.html`: the current graph. Open it in a browser.
- `docs/graph-pow/purposes.json`: one-line purposes for files with no leading comment.

## Refresh the graph

1. **Build the symbol graph with graphify.** It needs the `graphifyy` Python package; ask before installing it. Run graphify on the repo root (the graphify skill, `/graphify .`), or `graphify update .` when `graphify-out/` already exists. The result is `graphify-out/graph.json`. graphify-out is a local build folder, so don't commit it.
2. **Keep purposes current.** For any new file without a leading comment, add a plain one-sentence entry to `docs/graph-pow/purposes.json` saying what it does for the app. Remove entries for deleted files.
3. **Build the page:**
   ```bash
   python3 .claude/skills/graph-pow/scripts/graph_pow.py \
     --graph graphify-out/graph.json --root . \
     --purposes docs/graph-pow/purposes.json --title "Agent Office" \
     --out docs/graph-pow/graph-pow.html
   ```
   On Windows use `python` or graphify's saved interpreter (`graphify-out\.graphify_python`).
4. **Check it.** Open the page, select a busy file (store.ts, types.ts), and confirm the "Depends on" and "Used by" reasons make sense. Then tell the user the file and link counts and anything surprising, such as an import cycle.

## Show real agent work

The nerves fire on their own (simulated). To light the files an agent is actually touching, call `graphPow.fire('src/engine/ops.ts')` in the page, or post `{type: 'graph-pow:fire', file: 'src/engine/ops.ts'}` to it from a parent page.

## Use it on another project

Copy this folder into that project's `.claude/skills/`, then follow the steps above with that project's name and paths. The same design also ships with the graphify skill in degen-skill (`skills/graphify/references/graph-pow.md`).
