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

## AI Headquarters

The sample office now includes the NEXUS-7 Headquarters wing: an executive suite, a library, finance, engineering, design, a studio and a market-intelligence room. It is staffed by eight role agents (ORION the president, CODEX the librarian, VECTOR the COO, LEDGER the CFO, SCOUT, FORGE, MUSE and BOLT), each with its own look, tools, budget and workstation.

- **Object library and placement.** Open the object library from the toolbar to browse holo-desks, archive terminals, tube stations, vaults and more. The placement ghost turns red when an object would overlap another, sit outside the room or block a door. Shift-click or shift-drag selects several objects. Dragging a group moves it as one with its spacing kept. Ctrl+D duplicates, E rotates and the arrow keys nudge. The toolbar can arrange objects in rows, align them, group them and copy a style.
- **Remodelling commands.** The console understands commands such as "Add a librarian archive terminal against the back wall", "Add a tube station beside every research desk", "Replace the executive desk with a wider black titanium desk", "Make the lighting warmer and the floor dark graphite", "Arrange the desks in two aligned rows" and "Add plants without blocking doors".
- **Characters and wardrobe.** "New agent → From role…" creates an agent from an archetype. The Wardrobe tab in a profile saves outfits, applies them to other agents, issues approved uniforms to a department and restores the default look. Changing clothes never touches identity, permissions or memory. Functional equipment, such as a ledger slate, can only be worn by an agent that has the matching tool.
- **Themes.** Settings → Theme switches between dark, light and system modes, edits colour tokens with a contrast check, and saves, exports and imports themes. Room palettes, such as the library's, are stored on the room and don't change with the global theme. Characters look the same in every theme.
- **Alerts and sounds.** The bell in the top bar opens the alert centre. Identical alerts are grouped. Repeated failures are escalated, and unacknowledged alerts climb a level over time. Settings → Alerts picks a sound per severity, previews it and fires a test alert. It also sets quiet hours, mutes categories and sets thresholds. Critical alerts always sound. Routine information never makes noise.
- **Business.** The dashboard shows projects with budgets and usage records, approvals, tube handoffs and the knowledge library. A spend above an agent's limit, an action on the owner's approval list, or a tool the agent hasn't been granted pauses the task until you approve it. Priority tasks travel between rooms in pneumatic-tube capsules, and the recipient acknowledges them on arrival.
- **Performance.** Rooms and hallways outside the view are not drawn. Collision checks use a spatial index. A drag is drawn as a temporary overlay and committed once when you let go. The gauge button shows frame and tick timings.

## Executive control, production and the arcade

The **Control** page in the top bar has four tabs. The red **Emergency pause** button next to it stops every agent after a confirmation.

### Departments

Agents belong to a department by the department name on their profile. Each department row has an on/off switch, active and paused counts, its task count, a workload bar and a state chip:

| State | Meaning |
|---|---|
| Running | Agents take new work. |
| Pausing | The department is paused, but protected work (a save, or a render under the *finish* policy) is still finishing. |
| Paused | Every non-excluded agent is frozen and its work is held. |
| Blocked | A resource policy or the department's task limit is holding new work. Running work continues. |
| Error | An agent in the department can't reach its destination. |

The header buttons pause all departments, resume the selected rows, or trigger the emergency pause. Expanding a row lets you exclude agents from bulk actions, enable or disable all of its agents, set a maximum number of simultaneous tasks, choose the render policy, mark it essential and assign a batch of tasks round-robin.

**Safe pause.** Pausing never deletes work:

- Paused agents take no new work and stop moving and animating. Their bubble shows "II".
- A task in progress is held with its progress and resumes from there.
- Saves always finish.
- Renders follow the department's render policy. *Finish* lets the render complete. *Defer* holds it at the last 25 % checkpoint. *Cancel* cancels it and logs that.
- The emergency pause holds everything, renders included, at a checkpoint. Only saves finish.

### Resources

The Resources tab shows only figures that are actually measured. In the browser that is the tab's own JS memory, the device memory class and the CPU core count. System RAM, CPU, GPU memory, GPU utilisation and Blender jobs come from the Blender bridge (below) when it is running. Otherwise they read **Unavailable**. Per-department usage is always labelled unavailable, because agent "work" is simulated and nothing measures a department's real share.

The policies (prioritise rendering, background task limit, pause non-essential departments under heavy load, auto-resume) only ever hold **new** work. They never stop a task that is already running, and every hold is logged and raised as an info alert. Executive, Operations and Finance are essential by default.

### Rooms

- **Operations floor.** Built for 20 to 40 agents, with compact desks in rows and a central walkway. When more agents are visible than Settings → *Simplify above* (30 by default), agents are drawn as simple markers. Agents outside the view are not drawn. Batch assignment spreads tasks across the department's enabled agents.
- **Game Development Arcade.** Home of the Roblox and Blender production team (LUAU, QUEST, PROBE) and the three arcade cabinets.
- **Blender Design Studio.** 3D workstations, a render wall, a preview turntable, a review table and a material library, staffed by MESH and RIG.

### Production pipeline

Production items move through *assigned → creating → preview → review → approved → exported → integrated*. Agents do the creation, preview and export stages; integration is done by the QA integrator. Review is yours: **Approve** or **Request changes** on the Production tab.

Every stage reached by simulation is marked simulated, and each card says "Simulated progress only: no Blender or Roblox file has been produced". A card only shows a real file once the bridge has produced one and it has been attached. Roblox publishing is not connected.

**Planning mode.** Without the bridge, the studio runs in planning mode: the pipeline, reviews and render wall all work, but nothing is rendered. To render and export for real, run the bridge on the machine that has Blender:

```bash
BLENDER_PROJECT_DIR=~/blender-projects npm run blender-bridge   # listens on 127.0.0.1:8790
```

Then enter `http://127.0.0.1:8790` under Control → Resources. The bridge only accepts `.blend` files inside `BLENDER_PROJECT_DIR` and writes output to its `exports/` folder. `tools/blender/export_glb.py` exports GLB. Optional variables are `BLENDER_BIN`, `BRIDGE_PORT`, `BRIDGE_ORIGIN` and `BRIDGE_MAX_JOBS`. Blender is a content-creation tool only. The app never needs it to run.

### Arcade

Click a cabinet in Simulate mode, or use the Arcade tab, to play **Sky Hopper** (Flappy Bird style), **Maze Muncher** (Pac-Man style) or **Classic Pong** (first to 11). Your games have no caps and are recorded separately from any agent limits.

The arcade policy is **Human only** by default and is enforced in the engine, not just the interface. Agents can't be assigned an arcade machine as a workstation, sent to one, or given a task at one; every attempt is rejected and logged as a policy warning. *Agent play disabled* is the same for agents. *Token-free* agent play is locked off by a code constant (`TOKEN_FREE_VERIFIED = false` in `src/model/control.ts`). Settings, imports and AI commands can't switch it on.

The per-game caps (Flappy 100 points or 3 minutes, Pac-Man 10,000 points or 5 minutes, Pong 11 points or 5 minutes) and the matches-per-day limit are editable on the Arcade tab. They are kept in the saved session history, so a reload doesn't reset the daily count.

### Characters and wardrobe

Characters are still drawn as SVG at the same size. They now sit at a desk (with a chair) while working, gesture while talking, turn briefly to face front when changing direction, and glide smoothly between cells. Cosmetics stay attached in every pose.

**Wardrobe.** The built-in wardrobe is sci-fi only, with four items in each slot: headwear, eyewear, tops, bottoms, gloves, belts, footwear, accessories, hand-held equipment, cybernetics and effects. Functional equipment (diagnostic visor, ledger slate and so on) is listed separately because it mirrors a tool permission.

**Locked role uniforms.** Every role has a fixed uniform, and agents created from a role start in it. While it is on, cosmetics can't be added to it or removed from it, and its clothing can't be edited piece by piece, in the app, through the AI console or by import. Face, hair and body stay editable. "Take off uniform" unlocks the agent without changing the look; wearing a different outfit also takes it off. The uniforms themselves can't be edited or deleted, but "Duplicate" makes an editable copy.

**Rendered characters in the office.** The office draws each agent from a Blender-rendered sprite sheet (idle, a four-frame walk, sitting at a desk, talking and working) whenever one matches the agent's exact look. The sample cast's sheets ship with the app in `src/characters/renders/`, named by a hash of the look. Change an agent's look and it goes back to the drawn character until it is rendered again, so the office never shows an out-of-date picture. **Characters** in the office toolbar switches between *Rendered (Blender)* and *Drawn*; the explicit *Top-down* view always uses the drawn characters.

**Blender renders.** With the bridge running, Control → Production → *Character renders* sends the characters' appearance (nothing else) to Blender, which builds each one in 3D from `tools/blender/build_characters.py`. You get a 3/4 portrait PNG, a GLB and an office sprite sheet per character, a labelled lineup and `characters.blend` with the whole cast. The new sprite sheets are brought into the office automatically when the job finishes. "Open in Blender" opens that scene on your computer. Files land in `exports/characters/<job>/` in your Blender projects folder. The script also runs on its own:

```bash
blender --background --factory-startup --python tools/blender/build_characters.py -- roster.json out/            # add --sprites or --sprites-only for office sprite sheets
```

### Graph POW

The **Graph POW** button in the top bar opens Graph POW, the glowing map of how this app's files connect, in a new tab. It appears only when the local app serves `public/graph-pow.html`; the published single-file build doesn't include it. To refresh the map after code changes, run graphify on this folder (it writes `graphify-out/graph.json`), then:

```bash
npm run graph:pow                                  # rebuild from graphify-out/graph.json
npm run graph:pow -- --from path/to/graph-pow.html # or install a Graph POW page you already have
```

The page loads d3 from cdnjs, so it needs an internet connection.

### Royal Lounge and the hourly briefing

The **King's Lounge** (room type `royal-lounge`, south-east of the Blender studio, reached by the Royal Walk and Court Hall) is a lounge for resting between tasks: like the break room, it restores energy. It has a throne and velvet sofas (seating objects), a crown chandelier, a holographic fountain and a **briefing board** on the north wall. You can add more lounges from the *Royal lounge* room template, or with an AI command such as "add a throne room".

**Opening the board.** Click the briefing board in Simulate mode, or use **Briefing** in the office toolbar. The board covers the last hour of work:

- A summary strip counts **Done**, **Active**, **Blocked** and **Queued** work. Each has its own colour, icon and label, and clicking one filters the list to it.
- Every item shows the agent, the task and its status, with the completion time, or for active work an ETA (from its progress so far, or estimated from its work units).
- You can filter by team, project and status, and group by team (the agent's department) or by project.
- Select an item to see its details: the agent, team, project, priority and progress, its timestamps, the reason it is blocked, handoff notes, and its history (approvals and log lines).
- With nothing selected, the side panel shows **Needs attention** (blockers, overdue work and stuck agents) and **Idle agents**.

The board shows "Last refreshed hh:mm". It refreshes every 60 seconds while it is open, and **Refresh** updates it straight away. Esc closes the selected item first, then the board. Office shortcuts are off while the board is open, and the fountain's ripple respects *reduce motion*.

**Buckets** (`src/engine/briefing.ts`, `buildBriefing(doc, runtime, now, { windowMinutes = 60, msPerTick })`):

- *Done* means tasks completed inside the window.
- *Active* means active tasks, and tasks in transit through a tube.
- *Blocked* means tasks waiting for approval, paused or held, failed inside the window, queued behind a failed or cancelled dependency, or active while their agent is in an error state.
- *Queued* means everything else that is waiting.

Cancelled tasks are left out. `buildBriefing` is a pure function. It returns `generatedAt`, the window, the totals, the items, `byTeam`, `byProject`, `attention` and `idleAgents`. `taskHistory(runtime, taskId)` builds the timeline for one task.

### Schema version 5

Version 4 added `departments`, `control` and `arcade`; version 3 files migrate with every department running, no emergency stop and the arcade set to human only. Version 5 adds locked uniforms. Migrating replaces only the built-in wardrobe (custom items and saved outfits are kept), adds the role uniforms, and locks an agent only if it is already dressed exactly in its role uniform, so nobody's look changes.

## What is simulated and what is live

| Area | Status |
|---|---|
| Floor-plan editing, hallway routing, validation, undo, saving, import and export | **Real.** This is the actual engine, and the tests run against it. |
| Agent pathfinding and rerouting around blocked hallways | **Real.** Paths are computed on the current layout. |
| Agent "work": task progress, demo tasks, messages between agents, CPU and memory figures | **Simulated.** Labelled "sim" throughout the interface. No model runs for agents. |
| AI console with the default **Simulated AI** provider | **Simulated.** A local rule-based interpreter. No model is called and no key is needed. |
| AI console with the **Live model** provider | **Live.** Sends commands to a model through `server/ai-proxy.mjs`. The model's reply is checked against the schema, applied to a draft, and validated before you see a preview. |
| Budgets, usage records and spend alerts | **Simulated.** Usage comes from simulated task work and every record is marked `simulated`. |
| Alert delivery | In-app and sound are **real**. Sound reports "permission needed" until you click once to enable audio. Desktop notifications are real once you allow them. Email, messaging and push say **not connected**, because they need a server-side service, and nothing is ever reported as sent when it wasn't. |
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
  engine/       … plus spatial (object index, placement checks) · alerts (dedupe,
                escalation, delivery) · governance (usage, budgets, approvals) ·
                tubes (capsule network) · library (knowledge search)
  ai/remodel.ts object-level remodelling commands
  ui/           panels, inspector, profile drawer, appearance editor, console,
                dashboard, settings, shared form primitives, object library,
                wardrobe, theme editor, alert centre, alert settings, business
                panels, sound (WebAudio), perf panel
server/ai-proxy.mjs   server-side model proxy (key lives here)
tests/                acceptance suite
examples/             sample-office.json (valid) and malformed-office.json (rejected)
```

**Data flow.** The UI and the AI both produce a `DocOp[]`. That list goes to `applyOps`, which applies it atomically with immer, then clamps doors and furniture to their rooms, then reroutes hallways. Next, `validate` compares the issues against the state before the change, and new errors open a conflict dialog. Finally the change is committed to history and `reconcileLayout` moves agents along with their rooms and recalculates their paths.

There are three layers of state:
- **doc**: the layout and the agents. It is undoable and saved.
- **runtime**: positions, tasks and events. It is saved but not undoable.
- **ui**: never saved.

**Schema.** `schemaVersion` is currently 3. Version-1 and version-2 files migrate automatically. Imports check both the shape of the data and references between objects, such as a hallway pointing at a room that doesn't exist.

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

### AI Headquarters tests

The 15 tests from the headquarters specification live in `tests/hq.acceptance.test.ts`:

| # | Requirement | Test |
|---|---|---|
| 1 | Librarian and president differ | Archetype, title, role, outfit, tools, workstation type, room type and rendered drawing all differ. |
| 2 | Outfit change keeps identity | Identity, permissions, memory, skills, AI settings and budget are unchanged, and the default look can be restored. |
| 3 | Reuse an outfit | An outfit saved from ORION applied to SCOUT copies the look and leaves SCOUT's identity alone. |
| 4 | Add HQ objects | A holo-desk, an archive terminal and a tube station are placed with no errors or overlaps. |
| 5 | Move a group | Relative spacing and the group are kept. |
| 6 | Dark to light | Theme variables change; agents and their rendered drawings are identical. |
| 7 | Library palette | The room's colours survive mode and theme changes, and other rooms are untouched. |
| 8 | Sound and test alert | The chosen sound is delivered. Before audio is allowed it reports "permission needed", and email, messaging and push report "not connected". |
| 9 | Budget warning | The alert carries the project id and links to that project's usage records. |
| 10 | Tube delivery | A critical task travels from the executive suite to the library and CODEX acknowledges it. |
| 11 | Approval | An over-limit spend waits for approval; approving queues the task and resolves the alert. |
| 12 | Remodel while active | A remodel commits mid-simulation in under 1.5 s, and agents and tasks are preserved. |
| 13 | Save and reload | Object positions, theme, room palette, appearance, sounds, quiet hours and thresholds round-trip, and the saved file has no secrets. |
| 14 | Repeated failure | Repeats group into one alert that is escalated to high. |
| 15 | No overwhelm | 600 ticks of routine work produce at most 3 audible alerts. Info never sounds, and critical still sounds through quiet hours and mute. |

A performance test builds an office of 48 rooms, more than 570 objects and 60 agents, and checks the timing of placement checks, a group move with validation, and simulation ticks.

### Executive control tests

`tests/departments.test.ts` covers safe pause and resume with progress kept, the three render policies and saves, exclusions and the emergency pause, pause all and resume selected, enabling agents and batch assignment, task limits and resource policies, save and migration, 40 agents on the operations floor (under 15 ms per tick, no errors, no two agents on one cell), the production pipeline and its simulated labels, the human-only arcade lock and logging, and the character poses. `tests/arcade.test.ts` covers the three games, their caps and the daily limits. `tests/wardrobe.test.ts` covers the four-per-slot wardrobe, the uniform lock in every path that could change it, and the v4 → v5 migration.

`tests/briefing.test.ts` covers the briefing: bucket assignment for every task status, the one-hour window, grouping and filters, blockers, attention and idle agents, ETAs, task history, the lounge in the sample (reachable on foot), the lounge template, save and reload, the furniture drawings, and rendering the board.

## Extending

- **New room or furniture types.** Add the name to `ROOM_TYPES` or `FURNITURE_TYPES` in `src/model/types.ts`, then add its metadata in `src/model/defaults.ts`.
- **New operations.** Add a member to the `DocOp` union and a case in `applyOne` in `src/engine/ops.ts`. The AI layer can then emit it; add it to `DOC_OPS` in `src/ai/providers.ts`.
- **New AI provider.** Implement the `AIProvider` interface (`plan(command, ctx) → Plan`) in `src/ai/providers.ts`.
- **Server storage.** Implement `OfficeRepository` from `src/persistence/repository.ts`.
