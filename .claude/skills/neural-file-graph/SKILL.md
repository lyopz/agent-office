---
name: neural-file-graph
description: Build or refresh the glowing "neural" file-relationship graph for this repo (docs/file-graph/neural-graph.html). Use when asked for a file map, dependency graph, "neural map", or to see how files connect.
---

# Neural file graph

A dark, brain-like map with one glowing node per file. Labelled links explain why files connect (imports, calls, types, tests, docs). It has search, link-type and folder filters, 1- and 2-hop focus, and path tracing. The design is fixed in `templates/neural-graph.html`, so reuse it unchanged. `references/design.md` has the full style, layout and interaction rules.

This repo's copies:
- `docs/file-graph/neural-graph.html`: the current graph. Open it in a browser.
- `docs/file-graph/purposes.json`: one-line purposes for files with no leading comment.

## Refresh the graph

1. **Build the symbol graph with graphify.** It needs the `graphifyy` Python package; ask before installing it. Run graphify on the repo root (the graphify skill, `/graphify .`), or `graphify update .` when `graphify-out/` already exists. The result is `graphify-out/graph.json`. graphify-out is a local build folder, so don't commit it.
2. **Keep purposes current.** For any new file without a leading comment, add a plain one-sentence entry to `docs/file-graph/purposes.json` saying what it does for the app. Remove entries for deleted files.
3. **Build the page:**
   ```bash
   python3 .claude/skills/neural-file-graph/scripts/neural_graph.py \
     --graph graphify-out/graph.json --root . \
     --purposes docs/file-graph/purposes.json --title "Agent Office" \
     --out docs/file-graph/neural-graph.html
   ```
   On Windows use `python` or graphify's saved interpreter (`graphify-out\.graphify_python`).
4. **Check it.** Open the page, select a busy file (store.ts, types.ts), and confirm the "Depends on" and "Used by" reasons make sense. Then tell the user the file and link counts and anything surprising, such as an import cycle.

## Use it on another project

Copy this folder into that project's `.claude/skills/`, then follow the steps above with that project's name and paths. The same design also ships with the graphify skill in degen-skill (`skills/graphify/references/neural-graph.md`).
