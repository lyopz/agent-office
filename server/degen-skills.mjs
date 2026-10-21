// The owner's skill library, lyopz/degen-skill: Claude Code skills, each a folder with a SKILL.md
// (name and description in front matter, then the playbook). JARVIS hands them out to the agents
// whose job they fit, design skills first, through the owner's skill bank: a skill given to an
// agent lands in the bank and on that agent's prompt, like a skill JARVIS wrote. The library is
// read from a clone on this PC when there is one, else from GitHub; it is never written to.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEGEN_REPO = 'lyopz/degen-skill';
const RAW = `https://raw.githubusercontent.com/${DEGEN_REPO}/main/skills`;
const API = `https://api.github.com/repos/${DEGEN_REPO}/contents/skills`;
const UA = 'the-brain/1.0 (the owner reading their own skill library)';
const CACHE_MS = 60 * 60 * 1000;
const MAX_BODY = 60_000;
const NAME = /^[a-z0-9][a-z0-9-]{0,60}$/;

/**
 * Which skills fit which work, matched on an agent's name and title. Design comes first because
 * the owner said so; the engineering and tooling skills go only to agents that build software.
 */
export const DEGEN_ROLES = [
  { role: 'design', test: /design|mockup|mock-up|graphic|artwork|illustrat|art director|canva|brand|logo|visual/i, skills: ['design', 'brand', 'banner-design', 'design-system'] },
  { role: 'ads', test: /\bads?\b|advertis|marketing|promot|campaign|social media|content/i, skills: ['brand', 'banner-design'] },
  { role: 'research', test: /research|scout|trend|strateg|idea|opportunit|analys/i, skills: ['idea-refine', 'llm-council'] },
  { role: 'product', test: /\bproduct\b|\bapp\b|game|prototype|\bux\b|\bui\b/i, skills: ['idea-refine', 'prototype', 'ui-ux-pro-max'] },
  { role: 'engineering', test: /engineer|develop|\bcode\b|software|website|frontend|backend|programm/i, skills: ['frontend-ui-engineering', 'debugging-and-error-recovery', 'security-and-hardening', 'optimization'] },
];

/** The library skills a role should carry, from its words, design skills first; empty for JARVIS and for roles nothing fits. */
export function degenSkillsForRole(text) {
  const out = [];
  for (const r of DEGEN_ROLES) if (r.test.test(String(text || ''))) for (const k of r.skills) if (!out.includes(k)) out.push(k);
  return out;
}
/** The roles a skill is handed to, for the catalogue. */
export const degenRolesOf = (name) => DEGEN_ROLES.filter((r) => r.skills.includes(name)).map((r) => r.role);

/** name, description and body from a SKILL.md with YAML front matter (description may be a | or > block). */
export function parseFrontmatter(md) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { name: '', description: '', body: text.trim() };
  const lines = m[1].split('\n');
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[|>]-?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      v = block.join(v.startsWith('|') ? '\n' : ' ');
    }
    fm[kv[1]] = v.replace(/^["']|["']$/g, '');
  }
  const body = text.slice(m[0].length).replace(/^\s*<!--[\s\S]*?-->\s*/, '').trim();
  return { name: fm.name || '', description: (fm.description || '').replace(/\s+/g, ' ').trim(), body };
}

/** The folder of a clone on this PC: DEGEN_SKILLS_DIR, or degen-skill next to the app or in the home folder. */
export function degenDir(env = process.env) {
  const picks = [env.DEGEN_SKILLS_DIR, path.resolve(process.cwd(), '..', 'degen-skill'), path.join(os.homedir(), 'degen-skill'), path.join(os.homedir(), 'Documents', 'degen-skill'), path.join(os.homedir(), 'Desktop', 'degen-skill')].filter(Boolean);
  for (const p of picks) { try { if (fs.statSync(path.join(p, 'skills')).isDirectory()) return p; } catch { /* not here */ } }
  return null;
}

let cache = null;
/** Every skill in the library: name, description (local clones only), size and the roles it fits. */
export async function degenCatalog(deps = {}) {
  const now = Date.now();
  if (!deps.fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  const dir = 'dir' in deps ? deps.dir : degenDir();
  let value;
  if (dir) {
    const skills = [];
    for (const name of fs.readdirSync(path.join(dir, 'skills')).sort()) {
      if (!NAME.test(name)) continue;
      let md; try { md = fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf8'); } catch { continue; }
      const p = parseFrontmatter(md);
      skills.push({ name, description: p.description.slice(0, 240), chars: md.length, roles: degenRolesOf(name) });
    }
    value = { from: 'local', dir, skills };
  } else {
    const f = deps.fetch ?? globalThis.fetch;
    const r = await f(API, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for the skill library`);
    const list = await r.json();
    value = { from: 'github', dir: null, skills: (Array.isArray(list) ? list : []).filter((e) => e.type === 'dir' && NAME.test(e.name)).map((e) => ({ name: e.name, description: '', chars: 0, roles: degenRolesOf(e.name) })) };
  }
  cache = { at: now, value };
  return value;
}

/** One skill in full (its body is capped at 60,000 characters). */
export async function degenSkill(name, deps = {}) {
  if (!NAME.test(String(name || ''))) throw new Error('Give a skill name from the list (lowercase letters, digits and dashes).');
  const dir = 'dir' in deps ? deps.dir : degenDir();
  let md;
  if (dir) { try { md = fs.readFileSync(path.join(dir, 'skills', name, 'SKILL.md'), 'utf8'); } catch { throw new Error(`No skill named ${name} in the library at ${dir}.`); } }
  else {
    const f = deps.fetch ?? globalThis.fetch;
    const r = await f(`${RAW}/${name}/SKILL.md`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(r.status === 404 ? `No skill named ${name} in the library.` : `GitHub answered ${r.status} for ${name}.`);
    md = await r.text();
  }
  const p = parseFrontmatter(md);
  return { name, title: p.name || name, description: p.description, body: p.body.slice(0, MAX_BODY), chars: p.body.length, roles: degenRolesOf(name), from: dir ? 'local' : 'github' };
}

/** A library skill as a bank skill for the app: a readable name and tags that say where it came from. */
export function degenBankSkill(skill) {
  const words = skill.name.replace(/-/g, ' ');
  return { skillKey: `degen_${skill.name.replace(/-/g, '_')}`, skillName: `${words[0].toUpperCase()}${words.slice(1)} (degen)`, name: skill.title || skill.name, description: (skill.description || `From the owner's skill library: ${skill.name}.`).slice(0, 400), body: skill.body, tags: ['degen-skill', `degen:${skill.name}`, ...skill.roles] };
}

export const DEGEN_TOOL = {
  name: 'skills_degen',
  description: "The owner's skill library (lyopz/degen-skill): ready-made playbooks you can hand to agents. list shows every skill with the roles it fits; read shows one in full; give puts a skill in the owner's skill bank and on the agents you name, so it is part of their instructions from their next run. Design skills (design, brand, banner-design, design-system) belong on every agent that designs; give an agent only skills that fit its job (a store agent never needs the engineering or CLI tooling skills). Free.",
  input_schema: { type: 'object', properties: {
    action: { type: 'string', enum: ['list', 'read', 'give'] },
    skill: { type: 'string', description: 'the skill name, for read and give' },
    agents: { type: 'array', items: { type: 'string' }, description: 'for give: agent names (or "STORE team" for a venture and its agents)' },
  }, required: ['action'] },
};
