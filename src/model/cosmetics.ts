// Cosmetic inventory, accessories and character archetypes.
// Cosmetics change only how an agent looks. Functional equipment is the one
// exception that touches capability: it names the tool it represents, and an
// agent may only wear it while holding that tool permission, so the picture
// never claims a capability the agent doesn't have.
import type { Appearance, CosmeticItem, FurnitureType, RoomType } from './types';

export interface AccessoryDef { id: string; label: string; functionalTool?: string; desc: string }

export const ACCESSORIES: AccessoryDef[] = [
  { id: 'wrist-display', label: 'Holographic wrist display', desc: 'Glowing forearm readout.' },
  { id: 'rank-insignia', label: 'Rank insignia', desc: 'Chevron on the chest.' },
  { id: 'exec-insignia', label: 'Executive insignia', desc: 'Gold crest on the lapel.' },
  { id: 'shoulder-patch', label: 'Department shoulder patch', desc: 'Department colour patch.' },
  { id: 'lapel-pin', label: 'Lapel pin', desc: 'Small emblem pin.' },
  { id: 'holo-badge', label: 'Holographic badge', desc: 'Floating ID badge.' },
  { id: 'illuminated-tie', label: 'Illuminated tie', desc: 'Tie with a light strip.' },
  { id: 'floating-assistant', label: 'Floating assistant', desc: 'Small drone orbiting the shoulder.' },
  { id: 'data-device', label: 'Personal data device', desc: 'Pocket data slate.' },
  { id: 'data-cartridges', label: 'Data-storage cartridges', desc: 'Belt of archive cartridges.' },
  // functional equipment: requires the matching tool permission
  { id: 'diagnostic-visor', label: 'Diagnostic visor', functionalTool: 'diagnostics', desc: 'Represents access to the diagnostics tool.' },
  { id: 'catalog-interface', label: 'Floating catalogue interface', functionalTool: 'library-search', desc: 'Represents access to the shared library.' },
  { id: 'drafting-rig', label: 'Drafting rig', functionalTool: 'cad', desc: 'Represents access to the CAD tool.' },
  { id: 'tool-harness', label: 'Adjustable tool harness', functionalTool: 'fabrication', desc: 'Represents access to fabrication tools.' },
  { id: 'comms-relay', label: 'Comms relay earpiece', functionalTool: 'messaging', desc: 'Represents permission to send messages.' },
  { id: 'ledger-slate', label: 'Ledger slate', functionalTool: 'ledger', desc: 'Represents access to the finance ledger.' },
];
export const ACCESSORY = Object.fromEntries(ACCESSORIES.map((a) => [a.id, a])) as Record<string, AccessoryDef>;

const item = (id: string, name: string, category: CosmeticItem['category'], slot: string, patch: Partial<Appearance>, extra: Partial<CosmeticItem> = {}): CosmeticItem =>
  ({ id: `cos_${id}`, name, category, slot, patch, rarity: 'common', ...extra });
const acc = (id: string, extra: Partial<CosmeticItem> = {}): CosmeticItem => {
  const a = ACCESSORY[id];
  return { id: `cos_${id}`, name: a.label, category: 'accessory', slot: 'accessories', accessoryId: id, rarity: 'common', functionalTool: a.functionalTool, ...extra };
};

/**
 * The built-in wardrobe: sci-fi only, four items per wearable slot. Functional
 * equipment stays as its own group because it mirrors tool permissions.
 */
export const WARDROBE_SLOTS = ['headwear', 'glasses', 'top', 'bottom', 'gloves', 'belt', 'shoes', 'accessories', 'equipment', 'robotic', 'effects'] as const;
export const ITEMS_PER_SLOT = 4;

export const BUILTIN_COSMETICS: CosmeticItem[] = [
  // headwear
  item('comm-headset', 'Comms headset', 'head', 'headwear', { headwear: 'headset' }),
  item('flight-helmet', 'Flight helmet', 'head', 'headwear', { headwear: 'helmet', headwearColor: '#2a3440' }, { rarity: 'uncommon' }),
  item('breather-mask', 'Breather mask', 'head', 'headwear', { headwear: 'mask' }, { rarity: 'uncommon' }),
  item('full-helmet', 'Sealed void helmet', 'head', 'headwear', { headwear: 'full-helmet' }, { rarity: 'rare' }),
  // eyewear
  item('ar-glasses', 'Augmented-reality glasses', 'head', 'glasses', { glasses: 'ar-glasses' }),
  item('data-visor', 'Data visor', 'head', 'glasses', { glasses: 'visor' }),
  item('tactical-lenses', 'Tactical lenses', 'head', 'glasses', { glasses: 'square' }),
  item('scan-monocles', 'Scanner lenses', 'head', 'glasses', { glasses: 'round' }, { rarity: 'uncommon' }),
  // tops
  item('command-suit', 'Command suit', 'clothing', 'top', { top: 'suit', shoulders: 'metallic' }, { rarity: 'rare' }),
  item('flight-jacket', 'Flight jacket', 'clothing', 'top', { top: 'jacket', shoulders: 'pads' }),
  item('archive-coat', 'High-collar long coat', 'clothing', 'top', { top: 'longcoat' }, { rarity: 'uncommon' }),
  item('exo-armor', 'Exo-armor plating', 'clothing', 'top', { top: 'armor', shoulders: 'armored' }, { rarity: 'rare' }),
  // bottoms
  item('flight-trousers', 'Flight trousers', 'clothing', 'bottom', { bottom: 'pants', bottomColor: '#1c2128' }),
  item('armored-greaves', 'Armored greaves', 'clothing', 'bottom', { bottom: 'pants', bottomColor: '#3a3f46' }, { rarity: 'uncommon' }),
  item('tech-skirt', 'Tech-weave skirt', 'clothing', 'bottom', { bottom: 'skirt', bottomColor: '#14161c' }),
  item('zero-g-shorts', 'Zero-G shorts', 'clothing', 'bottom', { bottom: 'shorts', bottomColor: '#24303a' }),
  // gloves
  item('tech-gloves', 'Tech gloves', 'clothing', 'gloves', { gloves: 'tech' }),
  item('holo-gloves', 'Holo-touch gloves', 'clothing', 'gloves', { gloves: 'tech', gloveColor: '#4cc9ff' }, { rarity: 'uncommon' }),
  item('power-gloves', 'Power gloves', 'clothing', 'gloves', { gloves: 'work', gloveColor: '#3a2a14' }),
  item('command-gloves', 'Command gloves', 'clothing', 'gloves', { gloves: 'formal', gloveColor: '#e8e8e8' }),
  // belts
  item('utility-belt', 'Utility belt', 'clothing', 'belt', { belt: 'utility' }),
  item('tool-rig', 'Tool rig harness', 'clothing', 'belt', { belt: 'harness' }),
  item('command-belt', 'Command belt', 'clothing', 'belt', { belt: 'belt' }),
  item('cartridge-belt', 'Cartridge belt', 'clothing', 'belt', { belt: 'utility' }, { accessoryId: 'data-cartridges', rarity: 'uncommon' }),
  // footwear
  item('mag-boots', 'Mag boots', 'clothing', 'shoes', { shoes: 'boots', shoeColor: '#111316' }),
  item('grav-boots', 'Grav boots', 'clothing', 'shoes', { shoes: 'boots', shoeColor: '#2a3440' }, { rarity: 'uncommon' }),
  item('deck-shoes', 'Polished deck shoes', 'clothing', 'shoes', { shoes: 'dress', shoeColor: '#0b0c0e' }),
  item('runner-sneakers', 'Station runners', 'clothing', 'shoes', { shoes: 'sneakers', shoeColor: '#e8ecef' }),
  // accessories (decorative)
  acc('wrist-display'), acc('holo-badge', { rarity: 'uncommon' }), acc('rank-insignia'), acc('floating-assistant', { rarity: 'legendary' }),
  // hand-held equipment
  item('tablet', 'Data slate', 'accessory', 'equipment', { equipment: 'tablet' }),
  item('holo-catalog', 'Holographic tablet', 'accessory', 'equipment', { equipment: 'holo-catalog' }, { rarity: 'uncommon' }),
  item('drafting-tablet', 'Drafting tablet', 'accessory', 'equipment', { equipment: 'drafting-tablet' }),
  item('field-laptop', 'Field laptop', 'accessory', 'equipment', { equipment: 'laptop' }),
  // cybernetics
  item('robot-eyepiece', 'Robotic eyepiece', 'head', 'robotic', { robotic: 'eyepiece' }, { rarity: 'uncommon' }),
  item('robot-jaw', 'Robotic jaw', 'head', 'robotic', { robotic: 'jaw' }, { rarity: 'rare' }),
  item('half-face', 'Half-face plating', 'head', 'robotic', { robotic: 'half-face' }, { rarity: 'rare' }),
  item('android-shell', 'Full android shell', 'head', 'robotic', { robotic: 'full' }, { rarity: 'legendary' }),
  // effects (restrained by default)
  item('holo-outline', 'Holographic outline', 'effect', 'effects', { effects: { holoOutline: true } as Appearance['effects'] }, { rarity: 'uncommon' }),
  item('eye-glow', 'Eye glow', 'effect', 'effects', { effects: { eyeGlow: true } as Appearance['effects'] }),
  item('energy-accents', 'Energy accents', 'effect', 'effects', { effects: { energyAccents: true } as Appearance['effects'] }),
  item('aura', 'Subtle aura', 'effect', 'effects', { effects: { aura: true } as Appearance['effects'] }),
  // functional equipment: mirrors a tool permission, so it isn't part of the wardrobe count
  acc('diagnostic-visor', { rarity: 'uncommon', tags: ['equipment'] }), acc('catalog-interface', { tags: ['equipment'] }), acc('drafting-rig', { tags: ['equipment'] }),
  acc('tool-harness', { tags: ['equipment'] }), acc('comms-relay', { tags: ['equipment'] }), acc('ledger-slate', { tags: ['equipment'] }),
];

/** Fields an outfit may change. Body, face and identity-defining traits are never part of an outfit. */
export const OUTFIT_FIELDS: (keyof Appearance)[] = [
  'top', 'topColor', 'trimColor', 'bottom', 'bottomColor', 'shoes', 'shoeColor', 'headwear', 'headwearColor', 'glasses', 'jewelry',
  'equipment', 'shoulders', 'gloves', 'gloveColor', 'belt', 'accessories', 'accent', 'effects',
];

export function outfitFrom(a: Appearance): Partial<Appearance> {
  const out: Partial<Appearance> = {};
  for (const k of OUTFIT_FIELDS) (out as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(a[k]));
  return out;
}

export interface Archetype {
  id: string; label: string; title: string; department: string; roomType: RoomType;
  workstation: FurnitureType; workstationName: string;
  roleDescription: string; responsibilities: string[];
  appearance: Partial<Appearance>;
  tools: string[]; skills: string[];
  traits: string[]; communicationStyle: 'concise' | 'detailed' | 'friendly' | 'formal' | 'technical';
  requireApprovalFor: string[]; monthlyCredits: number; approvalAbove: number;
}

const fx = (p: Partial<Appearance['effects']>): Appearance['effects'] => ({ aura: false, holoOutline: false, eyeGlow: false, particles: false, energyAccents: false, robotics: false, intensity: 0.35, ...p });

export const ARCHETYPES: Archetype[] = [
  {
    id: 'president', label: 'Sci-fi president', title: 'President', department: 'Executive', roomType: 'executive',
    workstation: 'exec-desk', workstationName: 'Command Desk',
    roleDescription: 'Coordinates strategy, summarises company performance and presents proposals for owner approval.',
    responsibilities: ['Summarise company performance', 'Coordinate priorities', 'Present investment and project proposals', 'Identify blocked initiatives', 'Recommend resource allocation'],
    appearance: { top: 'suit', topColor: '#14161c', trimColor: '#d4a84a', bottomColor: '#14161c', shoulders: 'metallic', shoes: 'boots', shoeColor: '#0b0c0e', accessories: ['exec-insignia', 'illuminated-tie', 'holo-badge'], accent: '#d4a84a', hairStyle: 'short', hairColor: '#cfcfcf', build: 'broad', effects: fx({ energyAccents: true }) },
    tools: ['terminal', 'reports', 'messaging'], skills: ['strategy', 'portfolio review', 'negotiation'], traits: ['decisive', 'strategic', 'calm'], communicationStyle: 'formal',
    requireApprovalFor: ['spend', 'hire', 'external-message', 'delete'], monthlyCredits: 400, approvalAbove: 50,
  },
  {
    id: 'coo', label: 'Chief operations officer', title: 'Chief Operations Officer', department: 'Operations', roomType: 'operations',
    workstation: 'holo-desk', workstationName: 'Operations Command',
    roleDescription: 'Distributes tasks, resolves scheduling conflicts and prevents duplicated work.',
    responsibilities: ['Coordinate task distribution', 'Resolve scheduling conflicts', 'Prevent duplicate work'],
    appearance: { top: 'jacket', topColor: '#24303a', trimColor: '#39ff88', accessories: ['wrist-display', 'rank-insignia'], accent: '#39ff88', hairStyle: 'buzz', hairColor: '#2a1d14', shoes: 'boots' },
    tools: ['terminal', 'scheduler', 'messaging'], skills: ['scheduling', 'workload balancing'], traits: ['organised', 'pragmatic'], communicationStyle: 'concise',
    requireApprovalFor: ['spend', 'delete'], monthlyCredits: 300, approvalAbove: 40,
  },
  {
    id: 'cfo', label: 'Chief financial officer', title: 'Chief Financial Officer', department: 'Finance', roomType: 'finance',
    workstation: 'finance-terminal', workstationName: 'Financial Control',
    roleDescription: 'Tracks spending, validates financial assumptions and flags unprofitable projects.',
    responsibilities: ['Track spending', 'Validate financial assumptions', 'Monitor credit efficiency', 'Flag unprofitable projects'],
    appearance: { top: 'suit', topColor: '#2a2d33', trimColor: '#f2b544', bottomColor: '#24272c', accessories: ['lapel-pin', 'ledger-slate'], accent: '#f2b544', glasses: 'square', hairStyle: 'bun', hairColor: '#3a2618', shoes: 'dress' },
    tools: ['terminal', 'ledger', 'reports'], skills: ['budgeting', 'forecasting', 'unit economics'], traits: ['careful', 'precise'], communicationStyle: 'detailed',
    requireApprovalFor: ['spend', 'delete'], monthlyCredits: 250, approvalAbove: 30,
  },
  {
    id: 'librarian', label: 'Sci-fi librarian', title: 'Librarian', department: 'Research', roomType: 'library',
    workstation: 'archive-terminal', workstationName: 'Archive Terminal',
    roleDescription: 'Custodian of shared knowledge: searches existing records first, detects duplicates and keeps sources and verification status.',
    responsibilities: ['Maintain the shared library', 'Search records before new research', 'Detect duplicate findings', 'Preserve source links and evidence quality', 'Alert agents when useful knowledge arrives'],
    appearance: { top: 'longcoat', topColor: '#2a1f4a', trimColor: '#c9d6e8', bottomColor: '#1c1838', glasses: 'ar-glasses', accessories: ['catalog-interface', 'data-cartridges'], equipment: 'holo-catalog', accent: '#5ad1ff', hairStyle: 'long', hairColor: '#c9d6e8', effects: fx({ holoOutline: true }) },
    tools: ['terminal', 'library-search', 'messaging'], skills: ['cataloguing', 'source verification', 'deduplication'], traits: ['meticulous', 'patient'], communicationStyle: 'detailed',
    requireApprovalFor: ['spend', 'delete', 'external-message'], monthlyCredits: 150, approvalAbove: 20,
  },
  {
    id: 'market-analyst', label: 'Market intelligence analyst', title: 'Market Intelligence Analyst', department: 'Research', roomType: 'market',
    workstation: 'multi-monitor', workstationName: 'Market Analysis Station',
    roleDescription: 'Finds opportunities, analyses evidence and prepares concise market reports.',
    responsibilities: ['Find opportunities', 'Analyse evidence', 'Prepare market intelligence reports'],
    appearance: { top: 'jacket', topColor: '#103a3a', trimColor: '#39d0c8', glasses: 'visor', shoulders: 'pads', accessories: ['shoulder-patch'], accent: '#39d0c8', hairStyle: 'ponytail', hairColor: '#1a1410' },
    tools: ['terminal', 'library-search', 'web-research'], skills: ['competitive analysis', 'pricing', 'customer research'], traits: ['curious', 'sharp'], communicationStyle: 'concise',
    requireApprovalFor: ['spend', 'external-message'], monthlyCredits: 200, approvalAbove: 25,
  },
  {
    id: 'product-architect', label: 'Product architect', title: 'Product Architect', department: 'Product', roomType: 'design',
    workstation: 'holo-table', workstationName: 'Design Table',
    roleDescription: 'Creates product specifications, prototypes, packaging concepts and design revisions.',
    responsibilities: ['Write product specifications', 'Build prototypes', 'Design packaging concepts'],
    appearance: { top: 'coverall', topColor: '#3a3f46', trimColor: '#b57bff', belt: 'harness', accessories: ['drafting-rig', 'tool-harness'], equipment: 'drafting-tablet', accent: '#b57bff', hairStyle: 'curly', hairColor: '#2a1d14' },
    tools: ['terminal', 'cad', 'fabrication'], skills: ['product design', 'prototyping', 'packaging'], traits: ['inventive', 'hands-on'], communicationStyle: 'technical',
    requireApprovalFor: ['spend', 'delete'], monthlyCredits: 250, approvalAbove: 40,
  },
  {
    id: 'creative-director', label: 'Creative director', title: 'Creative Director', department: 'Creative', roomType: 'studio',
    workstation: 'curved-monitor', workstationName: 'Creative Workstation',
    roleDescription: 'Owns brand identity, visual consistency, product imagery and marketing assets.',
    responsibilities: ['Manage brand identity', 'Keep visuals consistent', 'Produce product imagery and campaigns'],
    appearance: { top: 'jacket', topColor: '#3a1030', trimColor: '#ff6fb5', bottom: 'skirt', bottomColor: '#1a1a1a', hairStyle: 'mohawk', hairColor: '#ff6fb5', jewelry: 'earrings', accessories: ['floating-assistant'], accent: '#ff6fb5', artStyle: 'neon', effects: fx({ aura: true }) },
    tools: ['terminal', 'image-tools'], skills: ['branding', 'art direction', 'campaigns'], traits: ['bold', 'expressive'], communicationStyle: 'friendly',
    requireApprovalFor: ['spend', 'external-message'], monthlyCredits: 220, approvalAbove: 30,
  },
  {
    id: 'chief-engineer', label: 'Chief engineer', title: 'Chief Engineer', department: 'Engineering', roomType: 'engineering',
    workstation: 'workbench', workstationName: 'Engineering Bench',
    roleDescription: 'Maintains integrations, automations, applications and internal infrastructure.',
    responsibilities: ['Maintain integrations', 'Build automations', 'Keep internal infrastructure healthy'],
    appearance: { top: 'armor', topColor: '#3a2a14', trimColor: '#ff9f43', belt: 'utility', gloves: 'work', gloveColor: '#5a4020', accessories: ['diagnostic-visor'], equipment: 'wrench', accent: '#ff9f43', hairStyle: 'short', hairColor: '#1a1410', facialHair: 'stubble', shoes: 'boots', shoeColor: '#2a1a0c' },
    tools: ['terminal', 'diagnostics', 'ssh', 'fabrication'], skills: ['integrations', 'automation', 'infrastructure'], traits: ['methodical', 'reliable'], communicationStyle: 'technical',
    requireApprovalFor: ['spend', 'deploy', 'delete'], monthlyCredits: 300, approvalAbove: 40,
  },
  {
    id: 'android', label: 'Minimalist android', title: 'Operations Android', department: 'Operations', roomType: 'office',
    workstation: 'terminal', workstationName: 'Android Terminal',
    roleDescription: 'General-purpose automation agent.',
    responsibilities: ['Run routine automations'],
    appearance: { robotic: 'full', skinTone: '#c8d0d8', hairStyle: 'bald', top: 'uniform', topColor: '#e8ecef', trimColor: '#4cc9ff', eyeColor: '#4cc9ff', accent: '#4cc9ff', effects: fx({ eyeGlow: true, robotics: true }) },
    tools: ['terminal'], skills: ['automation'], traits: ['precise'], communicationStyle: 'concise',
    requireApprovalFor: ['spend', 'delete', 'external-message'], monthlyCredits: 100, approvalAbove: 10,
  },
  {
    id: 'roblox-dev', label: 'Roblox developer', title: 'Roblox Developer', department: 'Game Development', roomType: 'arcade',
    workstation: 'dev-desk', workstationName: 'Dev Desk',
    roleDescription: 'Builds Roblox experiences: gameplay systems, Luau scripts, levels and UI.',
    responsibilities: ['Write and debug Luau scripts', 'Build levels and worlds', 'Balance and optimise gameplay', 'Prepare versions for publishing'],
    appearance: { top: 'hoodie', topColor: '#2a1440', trimColor: '#ff6fb5', headwear: 'headset', headwearColor: '#1a1a1a', accent: '#ff6fb5', hairStyle: 'curly', hairColor: '#3a2414', equipment: 'laptop' },
    tools: ['terminal', 'roblox-studio', 'git'], skills: ['luau', 'level design', 'game balance'], traits: ['playful', 'iterative'], communicationStyle: 'friendly',
    requireApprovalFor: ['spend', 'publish', 'delete'], monthlyCredits: 160, approvalAbove: 25,
  },
  {
    id: 'blender-artist', label: '3D artist (Blender)', title: '3D Artist', department: '3D Design', roomType: 'blender-studio',
    workstation: 'workstation-3d', workstationName: '3D Workstation',
    roleDescription: 'Models, textures, rigs and animates characters, props and environments in Blender.',
    responsibilities: ['Model characters, props and cosmetics', 'Texture and light assets', 'Rig and animate', 'Export to Roblox and app formats'],
    appearance: { top: 'jacket', topColor: '#2a1c10', trimColor: '#ff9f43', glasses: 'square', accent: '#ff9f43', hairStyle: 'bun', hairColor: '#1a1410', equipment: 'drafting-tablet', accessories: ['drafting-rig'] },
    tools: ['terminal', 'blender', 'cad'], skills: ['modelling', 'rigging', 'texturing'], traits: ['meticulous', 'visual'], communicationStyle: 'detailed',
    requireApprovalFor: ['spend', 'overwrite-asset'], monthlyCredits: 220, approvalAbove: 30,
  },
  {
    id: 'qa-integrator', label: 'Integration and QA', title: 'Integration Engineer', department: 'Game Development', roomType: 'arcade',
    workstation: 'test-station', workstationName: 'Playtest Station',
    roleDescription: 'Checks that exported assets import correctly and that models, animations and scripts work together.',
    responsibilities: ['Verify asset imports', 'Track bugs', 'Keep versioned backups', 'Gate publishing on approval'],
    appearance: { top: 'vest', topColor: '#14202a', trimColor: '#4cc9ff', glasses: 'ar-glasses', accent: '#4cc9ff', hairStyle: 'short', hairColor: '#2a1d14', equipment: 'clipboard' },
    tools: ['terminal', 'roblox-studio', 'git'], skills: ['testing', 'version control'], traits: ['thorough', 'sceptical'], communicationStyle: 'technical',
    requireApprovalFor: ['publish', 'overwrite-asset', 'delete'], monthlyCredits: 120, approvalAbove: 20,
  },
  {
    id: 'ecommerce', label: 'E-commerce operator', title: 'Store Operator', department: 'E-commerce', roomType: 'market',
    workstation: 'standing-desk', workstationName: 'Store Desk',
    roleDescription: 'Runs the online store: listings, inventory, orders and promotions.',
    responsibilities: ['Maintain product listings', 'Watch inventory and orders', 'Prepare promotions for approval'],
    appearance: { top: 'tshirt', topColor: '#0f2a22', trimColor: '#39d0c8', accent: '#39d0c8', hairStyle: 'ponytail', hairColor: '#5a3a1a', equipment: 'tablet' },
    tools: ['terminal', 'store-admin'], skills: ['merchandising', 'inventory'], traits: ['organised'], communicationStyle: 'concise',
    requireApprovalFor: ['spend', 'publish', 'external-message', 'delete'], monthlyCredits: 140, approvalAbove: 20,
  },
  {
    id: 'ops-worker', label: 'Operations floor agent', title: 'Operations Agent', department: 'Operations Floor', roomType: 'ops-floor',
    workstation: 'compact-desk', workstationName: 'Floor Desk',
    roleDescription: 'Handles simple, repetitive tasks from the shared queue.',
    responsibilities: ['Process routine tasks in batches'],
    appearance: { top: 'uniform', topColor: '#1a2420', trimColor: '#39ff88', accent: '#39ff88', hairStyle: 'buzz', hairColor: '#2a1d14', accessories: ['shoulder-patch'] },
    tools: ['terminal'], skills: ['data entry', 'triage'], traits: ['steady'], communicationStyle: 'concise',
    requireApprovalFor: ['spend', 'delete', 'external-message'], monthlyCredits: 40, approvalAbove: 5,
  },
  {
    id: 'custom', label: 'Blank (custom)', title: 'Generalist', department: 'Operations', roomType: 'office',
    workstation: 'desk', workstationName: 'Desk', roleDescription: 'Configure this agent from scratch.', responsibilities: [],
    appearance: {}, tools: ['terminal'], skills: [], traits: ['focused'], communicationStyle: 'concise',
    requireApprovalFor: ['spend', 'delete', 'external-message'], monthlyCredits: 100, approvalAbove: 20,
  },
];
export const ARCHETYPE = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a])) as Record<string, Archetype>;
