// The object library: every placeable object, its footprint, category and
// what it does. `fn` ties an object to a real behaviour (a tube station
// routes capsules, an approval kiosk is where requests are signed, a
// workstation is where an agent works); decorative objects have fn 'none'.
import type { FurnitureMaterial, FurnitureType, ObjectCategory, ObjectFunction, RoomAppearance, RoomType } from './types';

export interface ObjectMeta {
  label: string; w: number; h: number; blocking: boolean; color: string;
  category: ObjectCategory; fn: ObjectFunction;
  wall?: boolean;               // designed to sit against a wall
  desc: string;
}

const m = (label: string, category: ObjectCategory, w: number, h: number, fn: ObjectFunction, color: string, desc: string, opts: { blocking?: boolean; wall?: boolean } = {}): ObjectMeta =>
  ({ label, category, w, h, fn, color, desc, blocking: opts.blocking ?? true, wall: opts.wall });

export const FURNITURE_META: Record<FurnitureType, ObjectMeta> = {
  // furniture
  desk: m('Modular desk', 'furniture', 2, 1, 'workstation', '#1d3b2a', 'Standard workstation desk with a terminal.'),
  chair: m('Adjustable chair', 'furniture', 1, 1, 'seating', '#28473a', 'Task chair.', { blocking: false }),
  'exec-desk': m('Executive command desk', 'furniture', 4, 2, 'workstation', '#1a1c1f', 'Large curved command desk with an owner approval link.'),
  'holo-desk': m('Holographic desk', 'furniture', 3, 1, 'workstation', '#16263a', 'Desk with a projected holographic work surface.'),
  'standing-desk': m('Standing workstation', 'furniture', 2, 1, 'workstation', '#20302a', 'Height-adjustable desk.'),
  'conference-table': m('Conference table', 'furniture', 4, 2, 'seating', '#1f2d3b', 'Meeting table for up to eight.'),
  'strategy-table': m('Strategic planning table', 'furniture', 3, 2, 'display', '#1b2433', 'Table with a projected portfolio map.'),
  sofa: m('Lounge sofa', 'furniture', 3, 1, 'seating', '#2a2440', 'Three-seat sofa.'),
  'lounge-seat': m('Lounge seating', 'furniture', 2, 1, 'seating', '#2c2546', 'Pair of lounge chairs.'),
  cabinet: m('Storage cabinet', 'furniture', 1, 1, 'storage', '#2a2f2c', 'Lockable cabinet.'),
  locker: m('Personal locker', 'furniture', 1, 1, 'storage', '#25303a', 'Personal storage locker.', { wall: true }),
  shelf: m('Shelf', 'furniture', 2, 1, 'storage', '#2a2a22', 'Open shelving.', { wall: true }),
  container: m('Storage container', 'furniture', 2, 2, 'storage', '#33281a', 'Bulk storage.'),
  workbench: m('Workbench', 'furniture', 3, 1, 'workstation', '#3a2a14', 'Fabrication bench with tools.'),
  // computing
  computer: m('Compact computer', 'computing', 1, 1, 'display', '#16302a', 'Small computer.'),
  monitors: m('Monitor wall', 'computing', 3, 1, 'display', '#0f2a1f', 'Three-screen wall.', { wall: true }),
  'curved-monitor': m('Curved monitor', 'computing', 2, 1, 'display', '#0f2230', 'Wide curved display.'),
  'holo-display': m('Holographic display', 'computing', 2, 1, 'display', '#0e2236', 'Free-standing hologram projector.'),
  'multi-monitor': m('Multi-monitor rig', 'computing', 3, 1, 'display', '#102028', 'Six-screen trading rig.'),
  terminal: m('Compact terminal', 'computing', 1, 1, 'workstation', '#13261e', 'Single-seat terminal.'),
  'server-rack': m('Server rack', 'computing', 1, 2, 'none', '#2a1e10', 'Rack of compute nodes.'),
  'charging-station': m('Charging station', 'computing', 1, 1, 'charging', '#1d2b16', 'Restores agent energy faster than a break.'),
  'diagnostic-panel': m('Diagnostic panel', 'computing', 1, 1, 'display', '#2a2214', 'Live system diagnostics.', { wall: true }),
  'research-kiosk': m('Research kiosk', 'computing', 1, 1, 'archive', '#1a2236', 'Quick library lookups.'),
  // communication
  'tube-station': m('Pneumatic tube station', 'communication', 1, 1, 'tube', '#3a2f12', 'Sends and receives task capsules.'),
  'dispatch-terminal': m('Capsule dispatch terminal', 'communication', 1, 1, 'tube', '#2e2a14', 'Dispatches priority capsules.'),
  'message-station': m('Message receiving station', 'communication', 1, 1, 'tube', '#302a18', 'Receives capsules for a team.'),
  'routing-hub': m('Department routing hub', 'communication', 2, 2, 'tube', '#3a2c10', 'Central capsule switch.'),
  intercom: m('Holographic intercom', 'communication', 1, 1, 'none', '#14283a', 'Room-to-room voice link.', { blocking: false, wall: true }),
  'relay-panel': m('Communication relay panel', 'communication', 1, 1, 'none', '#16243a', 'Signal relay.', { blocking: false, wall: true }),
  // research
  'archive-terminal': m('Archive terminal', 'research', 2, 1, 'archive', '#1c1a3a', 'Search, file and verify knowledge.'),
  'digital-shelf': m('Digital bookshelf', 'research', 2, 1, 'archive', '#1e1838', 'Illuminated archive cabinet.', { wall: true }),
  'data-vault': m('Data vault', 'research', 2, 2, 'archive', '#191a2e', 'Restricted records storage.'),
  'evidence-station': m('Evidence review station', 'research', 2, 1, 'archive', '#1f2236', 'Source and claim verification.'),
  'market-display': m('Market research display', 'research', 2, 1, 'display', '#0f2a2e', 'Competitor and pricing charts.', { wall: true }),
  'comparison-wall': m('Product comparison wall', 'research', 3, 1, 'display', '#102a2a', 'Side-by-side product boards.', { wall: true }),
  whiteboard: m('Whiteboard', 'research', 3, 1, 'display', '#2b3a3a', 'Shared sketching wall.', { wall: true }),
  // creative
  'holo-table': m('Holographic design table', 'creative', 3, 2, 'display', '#26163a', 'Projects 3D product models.'),
  'mockup-display': m('Product mockup display', 'creative', 2, 1, 'display', '#2a1838', 'Rotating mockup plinth.'),
  'packaging-station': m('Packaging workstation', 'creative', 2, 1, 'workstation', '#2e2216', 'Packaging design bench.'),
  'material-station': m('Material selection station', 'creative', 2, 1, 'display', '#2a2420', 'Swatches and finishes.'),
  'prototype-printer': m('Prototype printer', 'creative', 2, 2, 'none', '#2a2a2a', 'Large-format 3D printer.'),
  'photo-station': m('Product photography station', 'creative', 2, 2, 'none', '#202020', 'Lit photo booth.'),
  // business
  'budget-dashboard': m('Budget dashboard', 'business', 2, 1, 'budget', '#2e2410', 'Live project spend.', { wall: true }),
  'approval-kiosk': m('Approval kiosk', 'business', 1, 1, 'approval', '#2e1e10', 'Where owner approvals are signed.'),
  'project-board': m('Project tracking board', 'business', 3, 1, 'display', '#1a2a20', 'Milestones and blockers.', { wall: true }),
  'finance-terminal': m('Financial terminal', 'business', 2, 1, 'budget', '#2a2210', 'Ledger and forecasts.'),
  'marketplace-display': m('Marketplace display', 'business', 2, 1, 'display', '#122a22', 'Storefront metrics.', { wall: true }),
  'inventory-monitor': m('Inventory monitor', 'business', 1, 1, 'display', '#1a2420', 'Stock levels.', { wall: true }),
  'analytics-wall': m('Performance analytics wall', 'business', 3, 1, 'display', '#102230', 'Company KPIs.', { wall: true }),
  // game development and 3D production
  'arcade-cabinet': m('Arcade cabinet', 'creative', 1, 1, 'arcade', '#1a1030', 'Playable arcade machine. Human use only: agents are blocked by policy.'),
  'dev-desk': m('Developer desk', 'furniture', 2, 1, 'workstation', '#141c2a', 'Dual-monitor desk with keyboard for scripting and level work.'),
  'collab-table': m('Collaboration table', 'furniture', 3, 2, 'seating', '#1a2230', 'Shared table for design reviews and pairing.'),
  'test-station': m('Playtest station', 'computing', 2, 1, 'workstation', '#1c1430', 'Build testing rig with controllers.'),
  'project-display': m('Project progress display', 'business', 3, 1, 'display', '#121a2a', 'Shows build progress, tests and blockers.', { wall: true }),
  'equipment-shelf': m('Equipment shelf', 'furniture', 2, 1, 'storage', '#22202a', 'Controllers, headsets and test devices.', { wall: true }),
  'workstation-3d': m('3D workstation', 'computing', 3, 1, 'workstation', '#141826', 'Multi-monitor modelling and sculpting desk.'),
  'reference-display': m('Reference display', 'creative', 2, 1, 'display', '#1c1a2a', 'Mood boards and reference images.', { wall: true }),
  'preview-stage': m('3D preview stage', 'creative', 2, 2, 'display', '#10202a', 'Turntable for inspecting models.'),
  'review-table': m('Asset review table', 'creative', 3, 2, 'display', '#1a1a26', 'Presentation table for quality review.'),
  'material-library': m('Material and texture library', 'creative', 2, 1, 'storage', '#24202a', 'Shaders, textures and swatches.', { wall: true }),
  'anim-station': m('Animation preview station', 'computing', 2, 1, 'workstation', '#16142a', 'Rig and animation playback.'),
  'render-wall': m('Render status wall', 'computing', 4, 1, 'render', '#0f1622', 'Queued, rendering, completed and failed jobs.', { wall: true }),
  'compact-desk': m('Compact workstation', 'furniture', 1, 1, 'workstation', '#16241e', 'Single-seat desk for routine tasks.'),
  'task-board': m('Shared task board', 'business', 3, 1, 'display', '#122218', 'Queue length and completions for the floor.', { wall: true }),
  'supply-station': m('Supply station', 'furniture', 1, 1, 'storage', '#2a2618', 'Equipment and supplies.'),
  'lane-marker': m('Walkway marking', 'atmosphere', 1, 1, 'none', '#39ff88', 'Floor marking for a movement path.', { blocking: false }),
  // atmosphere
  plant: m('Plant', 'atmosphere', 1, 1, 'none', '#1e5a32', 'Potted plant.'),
  lamp: m('Futuristic lamp', 'atmosphere', 1, 1, 'none', '#5a5a20', 'Ambient light.', { blocking: false }),
  decor: m('Decor piece', 'atmosphere', 1, 1, 'none', '#203040', 'Small decorative item.', { blocking: false }),
  sculpture: m('Sculpture', 'atmosphere', 1, 1, 'none', '#3a3a44', 'Kinetic sculpture.'),
  'floor-light': m('Floor lighting', 'atmosphere', 1, 1, 'none', '#1c2a30', 'Recessed floor light strip.', { blocking: false }),
  'wall-panel': m('Wall panel', 'atmosphere', 2, 1, 'none', '#1a2226', 'Textured acoustic panel.', { blocking: false, wall: true }),
  window: m('Window', 'atmosphere', 3, 1, 'none', '#132a3a', 'View of the city.', { blocking: false, wall: true }),
  'deco-robot': m('Decorative robot', 'atmosphere', 1, 1, 'none', '#2a3036', 'Retro robot statue.'),
  aquarium: m('Aquarium display', 'atmosphere', 2, 1, 'none', '#0c2a3a', 'Holographic aquarium.'),
  'wall-art': m('Wall art', 'atmosphere', 2, 1, 'none', '#2a1a2a', 'Framed art.', { blocking: false, wall: true }),
  'ambient-machine': m('Ambient machinery', 'atmosphere', 1, 1, 'none', '#22261e', 'Humming pipes and gauges.'),
  // royal lounge
  'briefing-board': m('Hourly briefing board', 'business', 5, 1, 'display', '#1a1430', 'Wall screen with the past hour: done, active, blocked and queued work. Click it to open the briefing.', { wall: true }),
  throne: m('Command throne', 'furniture', 2, 2, 'seating', '#2a1a3a', 'High-backed seat facing the briefing board.'),
  'lounge-sofa': m('Velvet lounge sofa', 'furniture', 3, 1, 'seating', '#2e1c46', 'Deep three-seat sofa with gold trim.'),
  'crown-chandelier': m('Crown chandelier', 'atmosphere', 2, 2, 'none', '#3a2e14', 'Ceiling-hung ring of light; agents walk beneath it.', { blocking: false }),
  'holo-fountain': m('Holographic fountain', 'atmosphere', 2, 2, 'none', '#141a30', 'Basin with a slow holographic water column.'),
  // Roblox development headquarters: every team room shows its work on its furniture
  'team-sign': m('Team sign', 'atmosphere', 3, 1, 'none', '#101420', 'Illuminated plaque naming the team and what it does.', { blocking: false, wall: true }),
  // Roblox development
  'studio-workstation': m('Game studio workstation', 'computing', 3, 1, 'workstation', '#121a2a', 'Three screens: explorer tree, 3D viewport with a play button, and a properties panel.'),
  'build-preview': m('Live build preview', 'computing', 4, 2, 'display', '#0c1424', 'Big screen running the current build, with a play-test counter.'),
  'code-wall': m('Code wall', 'computing', 4, 1, 'display', '#0b1220', 'Wall of syntax-coloured script panels and a test log.', { wall: true }),
  // research
  'evidence-board': m('Findings board', 'research', 4, 1, 'display', '#2a2014', 'Pinned findings joined by coloured strings, so connections are visible.', { wall: true }),
  'reference-stack': m('Searchable reference stack', 'research', 2, 1, 'archive', '#1c1a34', 'Indexed reference cards with a search bar.'),
  'note-wall': m('Note wall', 'research', 3, 1, 'display', '#1e2230', 'Sticky notes sorted into columns by topic.', { wall: true }),
  // game design
  'level-layout-table': m('Level layout table', 'creative', 3, 2, 'display', '#122224', 'Top-down level map with the player route, checkpoints and hazards.'),
  'mechanics-board': m('Mechanics board', 'creative', 3, 1, 'display', '#10242a', 'Gameplay loop diagram: action, reward, upgrade.', { wall: true }),
  'prototype-pod': m('Prototype pod', 'creative', 2, 2, 'display', '#142a2a', 'Play-test pod with a controller and a greybox prototype on screen.'),
  'planning-desk': m('Design planning desk', 'furniture', 2, 1, 'workstation', '#16262a', 'Desk with sketch paper, dice and a design tablet.'),
  // 3D design
  'blueprint-wall': m('Dimensional blueprint wall', 'creative', 4, 1, 'display', '#0c2440', 'Front, side and top views with dimension lines.', { wall: true }),
  'wireframe-stand': m('Wireframe stand', 'creative', 2, 2, 'display', '#1a1a24', 'Reference model shown as a glowing wireframe on a plinth.'),
  'material-swatches': m('Material swatches', 'creative', 2, 1, 'storage', '#24201a', 'Sample spheres: metal, wood, glass, neon and fabric.', { wall: true }),
  'preview-turntable': m('3D preview turntable', 'creative', 2, 2, 'display', '#101c28', 'Slowly turning holographic model for final checks.'),
  // typography
  'font-specimen-wall': m('Font specimen wall', 'creative', 4, 1, 'display', '#f1ece0', 'Side-by-side font specimens in light, regular and bold.', { wall: true }),
  'type-scale-panel': m('Type scale panel', 'creative', 2, 1, 'display', '#1a1a1e', 'Size and weight sliders over a sample line of text.', { wall: true }),
  'lettering-desk': m('Lettering desk', 'furniture', 2, 1, 'workstation', '#2a241c', 'Angled desk with a lettering sketch and pens.'),
  'game-ui-preview': m('Game interface preview', 'creative', 3, 1, 'display', '#121626', 'Fonts tried out in a game HUD: health bar, title and buttons.', { wall: true }),
  // Roblox building
  'modular-parts-rack': m('Modular parts rack', 'creative', 3, 1, 'storage', '#2a2a2e', 'Bins of bricks, wedges, cylinders and spheres.', { wall: true }),
  'terrain-table': m('Terrain table', 'creative', 3, 2, 'display', '#1a2a18', 'Terrain and structure preview: hills, water and a placed building.'),
  'scale-figure': m('Scale reference figure', 'atmosphere', 1, 1, 'none', '#3a3f46', 'Standard-height mannequin with a measuring bar for checking scale.'),
  'build-plan-board': m('Build plan board', 'business', 3, 1, 'display', '#1e2416', 'Build phases with progress: foundation, structure, detail, polish.', { wall: true }),
  // advertising and creative images
  'campaign-board': m('Campaign planning board', 'business', 3, 1, 'display', '#2a1424', 'Campaign timeline by channel with launch markers.', { wall: true }),
  'concept-review-wall': m('Concept review wall', 'creative', 4, 1, 'display', '#26162a', 'Creative concepts marked approved, revise or rejected.', { wall: true }),
  'image-draft-gallery': m('Image draft gallery', 'creative', 3, 1, 'display', '#1e1a26', 'Generated image drafts waiting for review.', { wall: true }),
  'final-asset-display': m('Final asset display', 'creative', 2, 1, 'display', '#241a10', 'Framed, approved final ad assets.'),
  // throne room
  'devil-bubble': m('Infernal throne bubble', 'atmosphere', 6, 6, 'none', '#2a0814', 'Glowing crimson and violet force bubble with horn-like spires around the throne.', { blocking: false }),
  'war-table': m('War table', 'business', 4, 2, 'display', '#1e0e16', 'Command map of every team room with live status markers.'),
  'command-display': m('Command display', 'business', 3, 1, 'display', '#180a14', 'Team status: active work, blockers and approvals.', { wall: true }),
  'dark-candelabra': m('Dark candelabra', 'atmosphere', 1, 1, 'none', '#1a1014', 'Wrought-iron candelabra with violet flames.'),
};

export const CATEGORY_LABEL: Record<ObjectCategory, string> = {
  furniture: 'Furniture', computing: 'Computing', communication: 'Communication', research: 'Research',
  creative: 'Creative', business: 'Business', atmosphere: 'Atmosphere',
};

export const MATERIAL_COLOR: Record<FurnitureMaterial, string | null> = {
  default: null, graphite: '#2a2d31', titanium: '#5b6268', 'black-titanium': '#16181b', walnut: '#4a3222', 'white-composite': '#d8dcdf', brass: '#8a6a2a',
};

export interface RoomMeta { label: string; accent: string; floor: RoomAppearance['floor']; purpose: string }
export const ROOM_META: Record<RoomType, RoomMeta> = {
  operations: { label: 'Main operations', accent: '#39ff88', floor: 'grid', purpose: 'Coordinate day-to-day operations.' },
  office: { label: 'Agent office', accent: '#4cc9ff', floor: 'carpet', purpose: 'Private workspace.' },
  research: { label: 'Research lab', accent: '#b57bff', floor: 'tile', purpose: 'Investigations and experiments.' },
  server: { label: 'Server room', accent: '#ff9f43', floor: 'metal', purpose: 'Compute infrastructure.' },
  meeting: { label: 'Meeting room', accent: '#4cc9ff', floor: 'wood', purpose: 'Meetings and reviews.' },
  workshop: { label: 'Workshop', accent: '#ff9f43', floor: 'metal', purpose: 'Repairs and fabrication.' },
  storage: { label: 'Storage', accent: '#8a9a8f', floor: 'plain', purpose: 'Supplies.' },
  break: { label: 'Lounge', accent: '#ffd166', floor: 'wood', purpose: 'Rest and informal talk; restores energy.' },
  security: { label: 'Security', accent: '#ff5d73', floor: 'metal', purpose: 'Access control and monitoring.' },
  reception: { label: 'Reception', accent: '#39ff88', floor: 'tile', purpose: 'Visitors and inbound requests.' },
  custom: { label: 'Custom', accent: '#39ff88', floor: 'plain', purpose: '' },
  executive: { label: 'Executive suite', accent: '#d4a84a', floor: 'carpet', purpose: 'Strategy, portfolio review and owner approvals.' },
  library: { label: 'Research library', accent: '#5ad1ff', floor: 'tile', purpose: 'Institutional knowledge: search, filing and verification.' },
  finance: { label: 'Finance office', accent: '#f2b544', floor: 'carpet', purpose: 'Budgets, spend tracking and approvals.' },
  engineering: { label: 'Engineering lab', accent: '#ff9f43', floor: 'metal', purpose: 'Integrations, automations and infrastructure.' },
  design: { label: 'Product design lab', accent: '#b57bff', floor: 'tile', purpose: 'Specifications, prototypes and packaging.' },
  studio: { label: 'Creative studio', accent: '#ff6fb5', floor: 'wood', purpose: 'Brand, imagery and marketing assets.' },
  market: { label: 'Market intelligence', accent: '#39d0c8', floor: 'grid', purpose: 'Competitor and customer analysis.' },
  'ops-floor': { label: 'Operations floor', accent: '#39ff88', floor: 'grid', purpose: 'High-capacity floor for simple, repetitive tasks.' },
  arcade: { label: 'Game development arcade', accent: '#ff6fb5', floor: 'carpet', purpose: 'Roblox game development and playtesting; arcade machines are for the owner.' },
  'blender-studio': { label: 'Blender design studio', accent: '#ff9f43', floor: 'tile', purpose: 'Modelling, rigging, animation and asset export.' },
  'royal-lounge': { label: 'Royal lounge', accent: '#e0b84a', floor: 'carpet', purpose: 'Rest between tasks and review the hourly briefing board.' },
  'roblox-dev': { label: 'Roblox development', accent: '#4cc9ff', floor: 'grid', purpose: 'Scripting, gameplay systems and live builds.' },
  'game-design': { label: 'Game design', accent: '#39d0c8', floor: 'wood', purpose: 'Level layouts, mechanics and playable prototypes.' },
  '3d-design': { label: '3D design studio', accent: '#ff9f43', floor: 'tile', purpose: 'Modelling, blueprints, materials and 3D previews.' },
  typography: { label: 'Type studio', accent: '#f4e7c8', floor: 'wood', purpose: 'Fonts, lettering and readable game interfaces.' },
  'roblox-build': { label: 'Building workshop', accent: '#f2c230', floor: 'metal', purpose: 'Modular parts, terrain and structures, built to plan and to scale.' },
  'ad-studio': { label: 'Campaign studio', accent: '#ff6fb5', floor: 'wood', purpose: 'Ad campaigns, creative concepts, image drafts and final assets.' },
  'throne-room': { label: 'Throne room', accent: '#ff3b5c', floor: 'carpet', purpose: 'The command centre: the ruler oversees every team from the throne.' },
};

/** Distinct looks for the headquarters team rooms (consistent language: dark floor, one accent, tinted light). */
export const ROOM_LOOK: Partial<Record<RoomType, Partial<RoomAppearance>>> = {
  'roblox-dev': { floorColor: '#0a1426', wallColor: '#24405e', lightTemp: 6000, lighting: 0.65, displayColor: '#4cc9ff', doorColor: '#4cc9ff', effect: 'scanlines' },
  'game-design': { floorColor: '#0c1e1e', wallColor: '#24504c', lightTemp: 5000, lighting: 0.65, displayColor: '#39d0c8', doorColor: '#39d0c8', effect: 'none' },
  '3d-design': { floorColor: '#1c140c', wallColor: '#5a3a1e', lightTemp: 4400, lighting: 0.6, displayColor: '#ffb36a', doorColor: '#ff9f43', effect: 'none' },
  typography: { floorColor: '#1c1812', wallColor: '#5a5040', lightTemp: 3400, lighting: 0.6, displayColor: '#f4e7c8', doorColor: '#f4e7c8', effect: 'none' },
  'roblox-build': { floorColor: '#18160c', wallColor: '#5a4a1a', lightTemp: 4800, lighting: 0.7, displayColor: '#f2c230', doorColor: '#f2c230', effect: 'none' },
  'ad-studio': { floorColor: '#1e0e1a', wallColor: '#5a2a4a', lightTemp: 4200, lighting: 0.6, displayColor: '#ff8fc8', doorColor: '#ff6fb5', effect: 'particles' },
  'throne-room': { floorColor: '#16060c', wallColor: '#4a1424', lightTemp: 2600, lighting: 0.45, displayColor: '#ff3b5c', doorColor: '#b86bff', effect: 'ambient-glow' },
};
