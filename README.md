# Agent Office

An interactive, AI-assisted office simulator. You design a floor plan of rooms, hallways, workstations, and furniture, then populate it with configurable AI agent characters who walk the halls and work through tasks. You can do every edit by hand, or describe it in plain English in the command console.

Everything on screen is data. The room layout, hallway routes, character looks, personalities and tasks all live in one schema-validated document, and every change, whether it comes from the mouse, a form, or the AI console, goes through the same structured operations.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Runs the acceptance suite with Vitest: 15 acceptance tests plus security and parser checks. |
| `npm run typecheck` | Runs strict TypeScript checks. |
| `npm run build` | Writes a production build to `dist/`. |
| `npm run build:single` | Writes one self-contained `dist-single/index.html` that opens straight from disk. |
| `npm run proxy` | Starts the server-side AI proxy for the live model (see below). |

The app needs no account, backend, or API key. It opens with a sample office, "NEXUS-7", containing 8 rooms, 7 hallways and 6 agents.

## Using it

- **Simulate and Construct.** Press **B** to switch between the two modes. In Construct mode you can drag rooms, pull handles to resize them, and use the toolbar tools:
  - Room (R)
  - Hallway (H)
  - Door (D)
  - Workstation (K)
  - Furniture (F)
  - Agent (N)
  - Connect two rooms
- **Exact values.** The Inspector on the right edits position, size, doors, walls, flooring, lighting and capacity with typed numbers.
- **Hallways.** Hallways connect real doors and route themselves as straight right-angled paths around rooms.
  - The **Halls** setting picks the routing mode:
    - *automatic*: every hallway reroutes.
    - *manual*: hallways keep your points.
    - *hybrid*: hallways marked "main" stay manual and the rest reroute.
  - In a manual hallway you can drag individual segments. Switching it back to *auto* reroutes it.
  - **Realign** rebuilds every automatic route.
- **Validation.** The editor flags overlapping rooms, hallways that cut through rooms, broken hallways, blocked doors, furniture outside its room, and rooms nobody can reach. Each issue offers a one-click fix.
  - A change that would introduce a new error opens a dialog with three choices: cancel, apply with the suggested fix, or apply anyway.
  - Nothing is ever deleted silently.
- **History and saving.**
  - Undo and redo with Ctrl+Z and Ctrl+Shift+Z, up to 100 steps.
  - Autosave writes to this browser.
  - The **Versions** menu saves named versions and can restore one, reset to the last save, duplicate the layout, start a blank office, or reload the sample.
  - Export and import use validated `.json` files.
- **Characters.** Each agent has one appearance profile. The top-down, front, side, three-quarter and portrait views are all drawn from it.
  - Open an agent's **Profile**, then the **Appearance** tab, to edit body, hair, clothing, gear, pose, art style and shading. That tab also has presets, saved outfit templates, and uploads for custom artwork for each view.
  - The other profile tabs are Identity, Personality, Skills, AI model, Memory, Schedule and tasks, Activity, and Permissions.
- **AI console.** Press **/** to focus it. Here are some commands it understands:
  - "Move the server room beside the research laboratory, extend the hallway between them, and move the research agent to the new workstation"
  - "Make the hallway wider and align it with the conference room entrance"
  - "Create a private office for the lead agent"
  - "Make RUSTY a rugged mechanic in a side view with olive work clothes, a cap and a tool belt"
  - "Block the east wing" (agents reroute, or report "no route")
  - "Move every idle agent to an available workstation"
  - "Undo the last layout change"

  Every command becomes a list of structured operations. Each list is applied to a draft copy and validated before anything changes. Layout changes are drawn in blue as a preview and wait for **Apply**. When a command is ambiguous, the console asks a question with clickable answers.
- **Dashboard.** Shows agent activity, the task queues, communications, errors, room occupancy and system health. Everything on this page comes from the simulation and is labelled that way.

The full shortcut list is under **Settings**.

## What is simulated and what is live

| Area | Status |
|---|---|
| Floor-plan editing, hallway routing, validation, undo, saving, import and export | **Real.** This is the actual engine, and the tests run against it. |
| Agent pathfinding and rerouting around blocked hallways | **Real.** Paths are computed on the current layout. |
| Agent "work": task progress, demo tasks, messages between agents, CPU and memory figures | **Simulated.** Labelled "sim" throughout the interface. No model runs for agents. |
| AI console with the default **Simulated AI** provider | **Simulated.** A local rule-based interpreter. No model is called and no key is needed. |
| AI console with the **Live model** provider | **Live.** Sends commands to a model through `server/ai-proxy.mjs`. The model's reply is checked against the schema, applied to a draft, and validated before you see a preview. |
| Personality and AI-model settings | Saved with the agent, and sent to the live provider as instructions. They have no effect on the simulation. |

### Connecting a live model

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run proxy    # listens on :8787
npm run dev                                   # Vite forwards /api/ai to the proxy
```

Then go to **Settings → AI integration** and choose **Live model via server proxy**.

Optional environment variables:

| Variable | Default |
|---|---|
| `AI_MODEL` | `claude-sonnet-5-5` |
| `AI_PROXY_PORT` | 8787 |
| `RATE_LIMIT_PER_MIN` | 20 |

If the proxy is down or returns something invalid, the console says so and nothing changes. Manual editing keeps working with the AI off.

### Credentials

- API keys stay in the proxy's environment and never reach the browser.
- Exports, saved layouts, saved versions, agent config exports, and the context sent to the model all pass through `stripSecrets`. That function removes any field whose name looks like `apiKey`, `secret`, `token`, `password`, `authorization` or `credential`.
- The proxy logs only error classes. It never logs headers or request bodies.

## Architecture

```
src/
  model/        types, defaults (rooms, furniture, outfits, presets), sample office,
                zod schema + migrations + secret stripping
  engine/       geometry · ops (all mutations) · routing (orthogonal A*) ·
                navigation (walkable grid, A*) · validate · simulation (tick loop)
  store/        zustand store: undoable document, runtime state, UI state,
                commit (dry-run → validate → conflict) / undo / redo / autosave
  persistence/  repository interface (localStorage now; swap in a server DB),
                IndexedDB for uploaded character art
  characters/   procedural SVG character: front / ¾ / side / top / portrait,
                idle / walk / work poses, flat / neon / realistic / pixel styles
  viewport/     floor plan canvas, rooms, corridors, agents, minimap, context menu
  ai/           rule-based interpreter (parser.ts), provider layer (mock / remote / off)
  ui/           panels, inspector, profile drawer, appearance editor, console,
                dashboard, settings, shared form primitives
server/ai-proxy.mjs   server-side model proxy (key lives here)
tests/                acceptance suite
examples/             sample-office.json (valid) and malformed-office.json (rejected)
```

**Data flow.** The UI and the AI both produce a `DocOp[]`. That list goes to `applyOps`, which applies it atomically with immer, then clamps doors and furniture to their rooms, then reroutes hallways. Next, `validate` compares the issues against the state before the change, and new errors open a conflict dialog. Finally the change is committed to history and `reconcileLayout` moves agents along with their rooms and recalculates their paths.

There are three layers of state:
- **doc**: the layout and the agents. It is undoable and saved.
- **runtime**: positions, tasks and events. It is saved but not undoable.
- **ui**: never saved.

**Schema.** `schemaVersion` is currently 2. Version-1 files migrate automatically. Imports check both the shape of the data and references between objects, such as a hallway pointing at a room that doesn't exist.

## Acceptance tests

All 15 required tests live in `tests/acceptance.test.ts` and run against the real engine and store.

| # | Requirement | Test |
|---|---|---|
| 1 | Three rooms connected by a hallway | Routes reach the door anchors, there are 0 errors, and an agent path exists from the first room to the last. |
| 2 | Move the middle room | Both hallways reroute and stay attached to their doors. |
| 3 | Resize a room | Doors and furniture are clamped inside the new size, and the hallways stay valid. |
| 4 | Manual hallway, then auto | A custom detour is kept and stays pinned when a room moves. Switching back to auto reroutes it. |
| 5 | Switch character views | The store's view changes, and the five views render five different drawings from one profile. |
| 6 | Change outfit only | Identity, personality and memory are unchanged. |
| 7 | Save a profile | The profile is written to storage, read back, and validated. |
| 8 | AI moves a room | The geometry changes, the room ends up left of Main Operations, and there are 0 errors. |
| 9 | AI changes appearance | Art style becomes realistic, the view becomes side, the top changes, and the name is unchanged. |
| 10 | Undo and redo a room move | Workstation and room assignments are identical after each step. |
| 11 | Save and reload | The document matches exactly, and runtime tasks survive. |
| 12 | Overlap | A warning with a fix appears, no room is deleted, and the store refuses to commit until you choose. |
| 13 | Blocked hallway | Agents take a longer detour. With every route blocked, the agent goes into an error state with "No route". |
| 14 | AI disconnected | The console declines the command, and manual room creation still commits. |
| 15 | Import | A valid export loads. Broken JSON, the wrong shape, a bad field type, and a dangling reference are each rejected, and the current office is left untouched. |

The suite also checks secret stripping and runs the 11 example commands from the brief through the interpreter.

## Extending

- **New room or furniture types.** Add the name to `ROOM_TYPES` or `FURNITURE_TYPES` in `src/model/types.ts`, then add its metadata in `src/model/defaults.ts`.
- **New operations.** Add a member to the `DocOp` union and a case in `applyOne` in `src/engine/ops.ts`. The AI layer can then emit it; add it to `DOC_OPS` in `src/ai/providers.ts`.
- **New AI provider.** Implement the `AIProvider` interface (`plan(command, ctx) → Plan`) in `src/ai/providers.ts`.
- **Server storage.** Implement `OfficeRepository` from `src/persistence/repository.ts`.
