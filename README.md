# The Brain

The Brain is ed's agent workspace. Its main screen is a 3D brain with one main agent, ORIGIN, at the core. Every agent ORIGIN grows is a nerve branch off it: ORIGIN starts **ventures** (one business or project each), and each venture adds **skill agents** for its own work. Nothing grows, runs or spends without ed's approval.

The old office simulator (rooms, hallways, furniture, characters, arcade, Graph POW and the Blender tools) has been removed. Saves from it still load: their agents, tasks, knowledge, projects and settings are kept and the office parts are dropped.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest suite. |
| `npm run typecheck` | Runs strict TypeScript checks. |
| `npm run build` | Writes a production build to `dist/`. |
| `npm run build:single` | Writes one self-contained `dist-single/index.html` that opens straight from disk. |
| `npm run origin` | Starts ORIGIN's runner on a live model (see [ORIGIN live runs](#origin-live-runs)). |
| `npm run desktop` | Builds the app and opens it in the desktop app (Electron). |
| `npm run desktop:dev` | Opens the desktop app on the running dev server. Run `npm run dev` first. |
| `npm run desktop:dist` | Builds installers for this platform into `release/` with electron-builder. |

A fresh brain holds ORIGIN alone. The app needs no account; ORIGIN only runs live when its runner is started with your key.

## Using it

- **Brain.** The 3D brain, the Branches menu on the left and the Creator desk. See [The agent brain](#the-agent-brain).
- **Brain picker.** The menu at the top left switches between the **Main Brain** (ORIGIN and every branch it grew), **specialist brains** and single-agent brains. Specialist brains, such as Engineering, stay empty until ORIGIN creates an agent with that skill; each new skill adds its own tab.
- **Dashboard.** Agent activity, task queues, approvals, budgets, alerts and the knowledge library.
- **Settings.** General (autosave) and theme.
- **Notifications are off.** No pop-ups, sounds, desktop notices or alert bell. Results show where the work is: ORIGIN runs, the agent's profile and the Dashboard.
- **Nothing is simulated.** Tasks exist only when you give one. **Give a task** (in the Branches menu or an agent's profile) sends it to ORIGIN's runner; a task for another agent is done by ORIGIN as that agent, with its SKILL.md. Tasks made up by the old in-browser loop are cleared when a save loads.
- **Console.** Press **/** to ask ORIGIN a question.
- **Profiles.** Click an agent to open its profile: Identity, **SKILL.md** (the playbook ORIGIN wrote for it, with a download button), Personality, Skills, AI model, Memory, Schedule and tasks, Activity, and Permissions.
- **History.** Undo and redo with Ctrl+Z and Ctrl+Shift+Z. The **Versions** menu saves named versions, restores one, or starts a fresh brain. Export and import use validated `.json` files.

## The agent brain
The main screen is a 3D brain built in three.js (`src/brain/BrainScene.tsx`). The brain itself is generated in code (`src/brain/brainMesh.ts`): two folded hemispheres with a central and Sylvian sulcus, a cerebellum with folia and a brainstem. No model file is needed. Use **Glass** for a see-through brain that shows the nerves inside, or **Tissue** for a solid, realistic surface. Drag to turn it and scroll to zoom; it slowly turns on its own after 9 seconds of no input.

- **Nerves are agents.** The main agent (ORIGIN) sits at the core, fed by a trunk that rises from the brainstem. Every agent is a bundle of nerve fibres that branches off the agent that made it (its supervisor), so when an agent creates another agent, a new bundle grows out of the creator's branch towards the cortex. Bundles are thicker the more agents they carry, and end in a tuft of fine dendrites. The tree is built in `src/brain/nerveTree.ts` from a fixed seed, so the same agents always give the same brain.
- **Growth.** On load the nerves grow outward from the core, one level at a time. A newly created agent grows its own branch while the rest stays in place.
- **Ideas grow the brain.** Every open idea is a glowing bud on a short nerve off the main agent: gold for your ideas, cyan for ones the main agent suggests. Add one under **Ideas** in the **Branches** menu, or press **Ask** for a suggestion (simulated from starter patterns until a live model is connected, and labelled that way). Click a bud, or **Grow** in the menu, and after you confirm, the main agent creates an idea lead for it and the bud becomes a full branch (`src/brain/ideas.ts`).
- **Look.** Thin, tight nerve bundles so new branches stay clean, a soft glow, faint neural dust, signal heads with trails, and a small flash when a signal reaches an agent.
- **Live, not simulated.** The brain only moves for ORIGIN's live runs. The top bar shows ORIGIN's runner (live, working, no key or offline) with its spend. **Ask** queues an idea request for ORIGIN's next run.
- **Regions.** The brain is coloured like an anatomy atlas: frontal lobe blue, parietal yellow, temporal green, occipital orange, cerebellum purple and brainstem grey, with a legend. **Regions** turns the colours off.
- **Branches menu.** On the left, the agent tree as a menu: the main agent at the top, each agent it made underneath, nested by who made whom, with team counts, work in progress and the ideas list. **Teams** switches back to the team grouping.
- **Signals.** Pulses run from the core out to agents that are working, along the shortest path between two agents when one hands work to another, and back to the core when a task finishes.
- **Focus.** Hover a node for its name, team and status; click it to open the agent profile. Hovering or choosing an agent in the menu lights its path back to the main agent and every agent below it, and dims the rest. Choosing a sector lights that team.
- Motion stops when the system asks for reduced motion.

**Teams tab.** Every agent is listed by team with its reporting line, status, current task, a progress bar and how many tasks are queued. Hovering a team or an agent lights up its part of the brain and its information nodes and dims the rest. Click an agent to open the profile, use its button to pause or resume it, search by name, title or team, and use **Give a task** at the bottom (pick an agent, type the task, press Enter).

## Opportunity agent and growing branches

ORIGIN, the main agent at the core of the brain, is the owner's **Opportunity Research & Builder Agent** (`src/brain/opportunity.ts`). Its instructions are the owner's operating prompt word for word, plus two notes: how branches work, and that each branch gets its own work window. Its starting memory lives in the library under the `opportunity-agent` tag (status, backlog, approvals, costs and revenue, rejected ideas) and starts honest: no allowance, no sources, no schedule, costs unknown.

- **Branch rules** (`branchKind`, `growKind` in `opportunity.ts`). Only ORIGIN starts branches, and each one is a **venture**: one business or project, such as Roblox development (Creator desk → Start a venture). A venture can add only **skill agents** for itself, such as research, 3D modelling, design or ads (use the branch button beside the venture in the side menu). Skill agents can't add agents, so a Roblox branch can't spin off an Amazon business. ORIGIN's starter staff (no `branch` record) don't grow branches. Each venture and skill appears as a new nerve bundle off its creator in the 3D brain.
- **Teaching agents to create agents.** ORIGIN and every venture carry `AGENT_BLUEPRINT` (how to design an agent). Ventures also carry `VENTURE_REVIEW`; skill agents carry `SKILL_REQUESTS` instead and can't create agents.
- **Skill requests** (`doc.skillRequests`, ops `skillRequest.create/review/decide`, Creator desk → Skill requests, or the request button beside a skill agent). A skill agent asks its venture for a new skill agent. The venture marks it relevant or not relevant with a reason, and only a relevant request reaches the owner. Approving it adds the skill agent under that venture. Until a model is connected, the venture's review is recorded by hand.
- **Work windows** (`agent.schedule.runWindow`): ORIGIN works 10 minutes every 2 hours (ed's choice), with a **Run 10 min** button on its row in the Branches menu for an extra run; each specialist gets a window sized to its team (research 10 min every 5 hours, design 5 min every hour, finance once a day…), editable on its profile. These are plans. The app does not wake agents by itself, and nothing runs or spends until a scheduler and an allowance are approved.
- Older saves get a **Set up Opportunity agent** button that applies the prompt and memory to the existing ORIGIN without overwriting anything it already recorded.

## ORIGIN live runs

`server/origin-runner.mjs` runs ORIGIN on a live model. The defaults are ed's choices: **Claude Haiku 5.5**, a **$15 monthly cap**, and **10 minutes every 2 hours**. You can also start a run with **Run 10 min** on ORIGIN's row in the Branches menu.

```powershell
# Windows PowerShell, in the app folder
$env:ANTHROPIC_API_KEY = "sk-ant-..."     # your key; it stays in this window only
npm.cmd run origin                         # listens on 127.0.0.1:8788
npm.cmd run dev                            # in a second window; /api/origin is forwarded
```

- **Approval is the spending limit.** ORIGIN works only on tasks you approve (Creator desk → ORIGIN runs). With none approved, a run only proposes tasks. It does no web searches and costs a fraction of a cent.
- **The cap is hard.** Before every model call, the runner checks that a worst-case call ($0.20) still fits under both the run's $0.50 limit and what's left of the month. When it doesn't, the run stops. Costs come from each response's token usage and search count at list price; a model without a known price is recorded as unknown, never as $0.
- **The window is enforced.** Every call has a deadline at the end of the window.
- **Scheduled runs only happen while the runner is on.** Stop them by closing it, or set `ORIGIN_SCHEDULE=off` to allow manual runs only. Other settings: `ORIGIN_MODEL`, `ORIGIN_MONTHLY_CAP_USD`, `ORIGIN_EVERY_MIN`, `ORIGIN_MAX_MIN`, `ORIGIN_RUN_LIMIT_USD`.
- **State** (ORIGIN's rules synced from the app, tasks, notes, runs, the ledger) is saved in `origin-data/state.json`, which is git-ignored. The key is never written to disk or logged.
- **One task at a time.** Each run works on the oldest approved task only, and continues it next run until it's done. ORIGIN proposes at most one task or agent per run, and nothing new while you still have one to decide.
- **Budget watch.** Spend is tracked per agent and per task, all on the one key and cap. Each task gets a budget (a tenth of the cap, `ORIGIN_TASK_BUDGET_USD`). ORIGIN stops a task on its own when its spend pattern shows it will cost far more than it's worth. The runner also stops any task that passes its budget, or whose average cost per run would pass twice its budget by the end of the month. You get one notice, and you can restart a stopped task with a fresh budget.
- **Ask ORIGIN.** The console at the bottom sends your question straight to ORIGIN. It answers at any time, with no approval and no tools, as one short call on the same cap (usually well under a cent).
- **Skill bank.** Creator desk → Skill bank holds the skills your agents use. Add them by hand or import `SKILL.md` files. ORIGIN and ventures pick from the bank when they create agents, and every skill ORIGIN has goes into its runs. ORIGIN can propose a new agent with bank skills, and it waits for your approval in ORIGIN runs.
- Without the runner, nothing runs, and the app says so.

## Saving

Saves stay on your machine. The browser version uses this browser's `localStorage`, and the desktop app writes files on disk. Nothing is sent over the network.

- **Autosave** runs every 60 seconds, and once more when the tab is hidden or closed. If the brain (agents, tasks and settings) hashes the same as at the last successful save, it skips the write entirely. You can turn it off under Settings → *Autosave*.
- **Save now** in the top bar (or Ctrl+S) saves straight away. Next to it, the status shows one of:
  - the last save time, such as "Saved 14:02 · 3 min ago"
  - an amber **Unsaved changes** dot after an edit
  - **Save failed** or **Saving paused** in red

  Hover over the status for details.

**The save format.** Each save is an envelope around the brain:

```json
{ "format": "agent-office-save", "version": 1, "savedAt": "2026-10-19T14:02:11.000Z",
  "checksum": "fnv1a32-1c9e04d2-48211", "doc": { … }, "runtime": { … } }
```

The checksum is FNV-1a over `{"doc":…,"runtime":…}` exactly as it is serialized, followed by its length. It catches saves that are cut short or corrupted. It is not a security feature. Autosave uses the same hash to tell whether anything changed. Saves from before the envelope still load, and the next save rewrites them in the envelope.

**Atomic writes.** A save never touches the good copy until the new one has been checked:

1. The new save goes to a separate slot. In the browser that is the `agent-office:pending` key. On desktop it is `current.json.tmp`, flushed to disk with fsync.
2. The save is read back and checked byte for byte and against its checksum. If the check fails, the save stops, and the previous save and the backup are untouched.
3. Only then does the previous save become the backup (`agent-office:backup` or `backup.json`). A good backup is never replaced by a previous save that is itself damaged.
4. The new save replaces the current one (`agent-office:current`, or an atomic rename over `current.json`), and the pending copy is removed.

**When a save is damaged.** Sometimes the current save can't be read: the JSON is bad, the checksum doesn't match, or the brain fails validation. The app never discards a damaged save, and it never quietly loads the sample over it. Instead it:

1. Keeps a copy under `damaged-<time>`. In the browser this is an `agent-office:damaged-…` key, and the last three are kept. On desktop it is a `damaged-….json` file next to the saves.
2. Pauses all saving.
3. Asks you to choose:
   - **Restore backup** is offered when the backup is valid, and shows when it was saved.
   - **Download damaged save** exports the raw text as a file.
   - **Start fresh** starts a fresh brain with only ORIGIN after you confirm.

Named versions and preferences stay in the browser's storage. In the desktop app, that storage is part of the app's data folder.

## Desktop app

| Command | What it does |
|---|---|
| `npm run desktop` | Builds the app and opens it in Electron. |
| `npm run desktop:dist` | Makes an installer named **Neural Command Campus** in `release/`: NSIS on Windows, DMG on macOS, AppImage on Linux. electron-builder is configured in the `build` field of `package.json` and uses the icons in `build/`. |
| `npm run desktop:dev` | Opens the desktop shell on the Vite dev server at `http://localhost:5173`, or on the local URL in `OFFICE_DEV_SERVER_URL`. |

- **Saves** live in `<userData>/saves/` as `current.json`, `backup.json` and any `damaged-*.json` files. `userData` is the app's data folder for your user account:

  | System | Folder |
  |---|---|
  | Windows | `%APPDATA%\Neural Command Campus` |
  | macOS | `~/Library/Application Support/Neural Command Campus` |
  | Linux | `~/.config/Neural Command Campus` |

- **Bridge.** `desktop/preload.cjs` exposes one object, `window.officeDesktop`, with five calls: `saves.read()`, `saves.readBackup()`, `saves.write(text)`, `saves.keepDamaged(text)` and `saves.info()`.
  - The main process (`desktop/main.cjs` and `desktop/saveStore.cjs`) does all the file work, with fixed file names.
  - The page can't pass a path, read any other file, or see environment variables.
  - When the bridge is there, the app saves to files (`FileRepository`). Otherwise it uses `localStorage`.
- **Security.**
  - The window runs with `contextIsolation` and `sandbox` on, and `nodeIntegration` off.
  - The built app is served from a private `app://campus/` scheme with a strict Content-Security-Policy. Only the app's own scripts run, and no remote content loads, so the web fonts fall back to fonts on your computer. Network access is limited to `localhost`, for ORIGIN's runner.
  - Navigation away from the app is blocked, new windows are refused, and http(s) links open in your browser.
  - Every permission request except notifications is denied.
  - Launching the app a second time focuses the window that is already open.

## Logo

The Neural Command Campus logo shows an agent's head inside a rounded badge. The head has a visor, an antenna node, a neural link between the eyes and a circuit-trace mouth. It uses three colours from the app palette:

- panel black, `#050a08`
- signal green, `#39ff88` (`--green-5`)
- data blue, `#4cc9ff` (`--blue-5`)

| File | Use |
|---|---|
| `src/brand/Logo.tsx` | `LogoMark`, the logo on its own (pass `simple` below about 24 px), and `LogoLockup`, the logo with "Neural Command Campus" as used in the top bar. |
| `public/logo.svg` | The full logo. |
| `public/favicon.svg` | A simpler version for 16–32 px: no thin lines, and larger eyes and antenna node. |
| `build/icon.png` | The 512 px app icon, rendered from `logo.svg`. |
| `build/icon.ico` | The Windows icon, with PNG images at 16 and 32 px (from `favicon.svg`) and at 48 and 256 px (from `logo.svg`). |

To change the logo:

1. Edit both SVG files and `Logo.tsx`.
2. Re-render the PNGs with any SVG rasterizer. The current ones were rendered with headless Chromium.
3. Pack the 16, 32, 48 and 256 px images into the `.ico`.

## Credentials

- ORIGIN's API key lives only in the runner's environment (`server/origin-runner.mjs`). It never reaches the browser and is never written to disk or logged.
- Saves, exports, saved versions and agent exports pass through `stripSecrets`, which removes any field named like `apiKey`, `secret`, `token`, `password`, `authorization` or `credential`.

## Architecture

```
src/
  model/        types, defaults, the fresh brain (sample.ts), zod schema,
                migrations from old office saves, secret stripping, themes
  engine/       ops (every change) · simulation (task loop) · governance (usage,
                budgets, approvals) · alerts · library (knowledge search)
  store/        zustand store: undoable document, runtime state, UI state
  persistence/  save envelope, atomic save backends (localStorage or desktop files)
  brain/        3D brain (BrainScene, brainMesh, nerveTree), brain picker,
                Branches menu, Creator desk, ORIGIN link, skill bank and requests
  ui/           top bar, dashboard, settings, profile drawer, console, alerts
  brand/        logo
server/origin-runner.mjs   ORIGIN's live runner (the key lives here)
desktop/                   Electron main process, preload bridge and save-file store
tests/                     Vitest suite
examples/                  sample-brain.json (valid) and malformed-brain.json (rejected)
```

**Data flow.** Every change is a `DocOp[]` passed to `commit`, which applies it atomically with `applyOps` and records it in history. There are three layers of state: **doc** (agents, projects, library, settings; undoable and saved), **runtime** (tasks, events, usage, approvals; saved but not undoable) and **ui** (never saved).

**Schema.** `schemaVersion` is 8. Any older office save (v1 to v7) is converted into a brain on load.

## Tests

`npm test` runs the suite in `tests/`: the brain's agents and task loop, the nerve tree, ideas, ORIGIN's opportunity setup, the skill bank, the runner, runner notices, and saving.

## Extending

- **New operations.** Add a member to the `DocOp` union and a case in `applyOne` in `src/engine/ops.ts`.
- **Server storage.** Implement `OfficeRepository` from `src/persistence/repository.ts`.
