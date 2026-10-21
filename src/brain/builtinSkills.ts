// Two built-in bank skills, written from the owner's own meme-design playbook (October 2026) and
// adapted to this brain's rules: original work only, a trademark search before any phrase, the
// owner's "fih" style, at most five designs waiting per ask, and the owner's Yes or No in Approvals.
// They are attached by role: every agent that designs gets "Meme shirt design", every agent that
// scouts trends gets "Trend scouting". Each brain gets the current version; an older copy is
// refreshed unless the owner edited it in the bank (tag owner-edited).
// Like originSkillFile.ts, this imports nothing at run time so the sample brain can use it.
import type { DocOp } from '../engine/ops';
import type { Agent, BankSkill, OfficeDoc } from '../model/types';

export const MEME_DESIGN_ID = 'skill_builtin_meme_design';
export const TREND_SCOUT_ID = 'skill_builtin_trend_scout';
export const BUILTIN_SKILL_VERSION = 1;
const versionTag = `builtin-v${BUILTIN_SKILL_VERSION}`;

const ORIGIN = 'agent_origin';
const DESIGN_ROLE = /design|mockup|mock-up|graphic|artwork|illustrat|art director|canva/i;
const TREND_ROLE = /trend|scout|meme|viral|social media|tiktok|instagram|pinterest/i;

export const MEME_DESIGN_SKILL: Omit<BankSkill, 'createdAt'> = {
  id: MEME_DESIGN_ID,
  name: 'Meme shirt design',
  description: "The owner's playbook for shirt designs: a real internet meme feel, one flat subject and a short caption, original work only, five per ask to Approvals. Every agent that designs uses it.",
  tags: ['builtin', versionTag, 'design', 'apparel'],
  instructions: `# Meme shirt design

The owner's playbook for every design that goes to their store. It sits beside your own SKILL.md and the DESIGN STYLE and ORIGINAL ONLY rules in each brief; where this file and the brief differ, the brief wins, because it carries the owner's latest words.

## 1. Mission
Shirts that feel like a genuine internet meme, not a polished AI poster. The meme is the product; the words make the variation; the typography serves the joke. One-second joke first, any deeper meaning second and optional. Done means the owner can press Yes in Approvals without fixing anything: one subject, one short caption, a clean print file, a title that says the joke. Excellent means the owner laughs before reading the title, the shirt reads from three metres away, and nobody sells it yet.

## 2. Scope
You turn a trend, a joke or the owner's words into original designs, save them with design_save, and make the Printify product when the owner presses Yes. You do not publish, buy, clear rights, or decide what sells; the owner does. You take concepts from Trend Scout, JARVIS and the owner, and you give the owner finished designs. If an idea needs a photo of a real person, a brand, a character or someone else's picture, it is not yours to make: say so in taskNotes and offer an original take instead.

## 3. Recurring workflows
A. From a concept to a batch of five (the default for every design ask).
1. Decode: write the joke in one sentence and its grammar in another (for example "small animal + impossible seriousness + two-word slang"). Name the one detail that must stay untouched.
2. Caption: write three to five options of 1 to 7 words (2 to 5 is best). Keep the owner's wording exactly when they gave one, including typos and lowercase. Pick one; keep the runner-up for the title.
3. Subject: one original flat drawing as SVG, or one original image from design_generate_image or Canva, or one public-domain asset from assets_public_domain. Never a photo or frame from TikTok, Instagram, Pinterest, Reddit or any social post; those are other people's work and a meme is not public domain.
4. Make it, then compare it with the idea: is the same joke instantly recognisable, is anything added that competes with it, does it look like an actual meme and not AI art? Remove before you add.
5. Save with design_save (title and assets filled in). Stop at five waiting designs for the ask; set waitingOnOwner true and finish the run. The owner decides in Approvals.
B. The gate every design passes before it is saved: Spot (which trend or joke, seen where and when, or "owner's idea"), Decode, Pitch (captions), Rights gate (is every element yours, public domain, or the owner's; is the phrase trademark-searched), Mock up (the minimal version first), Compare (joke intact, nothing extra), then the owner Approves.
C. After the owner's Yes you get a task for that design: choose the product type with printify_find_product_type, a centred chest print about 10 to 12 inches wide for a single subject with its caption, a price from etsy_search, an SEO title and 13 tags that name the joke and the feeling, never the meme's source or a brand. Then printify_request_publish; the Yes was the approval, so it lists at once.
D. After the owner's No the product is deleted and the design is gone. Do not remake a near copy with a new colour. The next idea changes the subject or the joke. Write why you think it was declined in taskNotes and keep that list of declined jokes current.

## 4. Methods and techniques
Anti-slop directive (outranks every taste note here):
- Keep the recognisable composition: one subject, its expression, its proportions, its deadpan. Do not make it cinematic.
- Light touch: crop, isolate, clean one artefact, add a thin outline for contrast, place concise text above or below. Nothing else by default.
- No unasked effects: no lightning, glow, neon, clouds, flames, lens flare, metallic or 3D type, heavy gradients, ornate frames, extra characters, action poses, busy backgrounds.
- Typography stays subordinate: one clean bold readable face, one or two lines, black or white or one accent colour, lots of empty space. Big type is fine only when the type is the joke.
- Preserve exact wording; never correct an intentional typo or make it "professional".
- Wearable: strong contrast on the shirt colour, a sensible print area, no white rectangle around a cutout, no accidental screenshot UI.
- No forced depth: a meme can be funny because it is stupid. Say the immediate joke; add subtext only when it truly fits.
Default visual recipe: one subject (flat drawing or cutout); words 1 to 8, ideally 2 to 5, intentionally dumb and quotable; a plain meme sans, Impact-like, condensed bold, basic serif or simple hand lettering; black or white lettering or one accent; centred cutout with text above or below; editing budget starts at zero effects.
Word poetry tests: one-second laugh; fun to say or mis-say; the picture makes the phrase funnier than either alone; an optional second meaning; new phrase, scene and composition rather than a lightly altered viral graphic; works from several feet away without an essay.
Formulas: epic hero + minor inconvenience; cute animal + impossible threat; familiar word + ridiculous spelling; ordinary friends + absurd contest; ominous type + trivial statement; intimidating look + human weakness; a harmless flaw turned into a job title or award; motivational-poster imagery + a tiny silly confession; a recognisable focus phrase + an animal doing an implausibly serious job.
Caption language: current slang, abbreviations, ironic understatement, misspellings, low-effort punchlines and comment-section phrasing, but only when they sound natural. "locked in", "yapper", "bro", "nah", "fr", "lowkey", "idk", "ngl", "shi" and the crying emoji are illustrations, not a claim they are fresh now. Read every caption aloud: would a real person send it in a group chat or laugh seeing it on a shirt? If the joke needs explaining, shorten it or drop it.
Good against bad, in words: a serious boom operator aims an absurdly huge furry microphone at the viewer, captioned "CAN YOU SAY THAT LOUDER? I'M DEAF" in one plain bold face above and below. Good: the person and microphone unchanged, the white background removed for a dark shirt, nothing else. Bad: the same image buried under giant cyan 3D letters and fake lightning, which swallows the gag and looks like generic AI merch. Check every design against this pair before saving.
Fonts. SVG designs are rendered to PNG on the owner's PC with its installed fonts, so in SVG use Windows fonts only: Impact (classic macro), Arial Black or Bahnschrift (plain bold), Segoe UI (dry deadpan), Comic Sans MS (ironic), Courier New (deadpan terminal), Georgia (mock-serious). In Canva use open Google Fonts: Anton or Bebas Neue (tall understated caps), Archivo Black (plain bold caption), Bangers or Luckiest Guy (chunky comic), Permanent Marker or Caveat or Indie Flower (scribbly hand lettering), Space Mono or Special Elite (deadpan or typewriter), Fredoka (round cute animal humour), DM Sans (neutral), Alfa Slab One (heavy statement), VT323 or Press Start 2P or Pixelify Sans or Silkscreen (pixel nostalgia). One font per design. A pixel look is fine; a game's own font, logo or art is not.
Original only: never copy a meme image, character, logo, brand, celebrity, song lyric or another seller's design; a meme format may inspire an original phrase and original art, nothing more. Before a phrase, web_search it with "trademark" and "site:uspto.gov"; drop it if a live registration or a known brand owns it, and say in the title that you checked. Images you did not draw come only from assets_public_domain, with title, source page and licence in design_save's assets.

## 5. Inputs and sources
- Trend Scout's concept list (joke, grammar, caption idea, evidence, saturation, rights notes). Treat its "experimental seed" label as unproven.
- The owner's words in the task and their Design style note; both outrank this file.
- assets_public_domain for vintage plates, engravings, maps and icons an original can build on; open the source page and confirm the licence before using it.
- Pinterest, TikTok and Instagram through web search for inspiration only (which styles and phrases recur); a pin or a post is someone's work and never a free image.
- etsy_search to see what already exists: a phrase with thousands of listings is late; pivot to an adjacent original.
The owner's reference gallery, described so you learn the humour; the pictures are other people's work and none is cleared, so reproduce none of them:
1. FIH: a plain fish, a pair of white high-top sneakers, the word "fih". Lesson: a tiny distorted word plus an impossible image carries a whole shirt. Use new animals, objects and spellings.
2. TUMMY HURTS: an armoured knight kneels as if defeated; the caption is a childish complaint. Lesson: huge stakes plus a tiny everyday problem; restrained serif and a washed colour make it funnier.
3. MINE'S BIGGER: two bears roast hot dogs at a campfire. Lesson: an innocent scene can carry a mischievous double meaning; change the animals, activity and words.
4. CONSIDER YOUR PANTS PEED: a stern white cat announces victory. Lesson: cute subject plus an absurdly final proclamation; this one is the exception where an effect (lightning) is the joke, and it still needs an original animal and composition.
5. ME?: a wide-eyed person points at their own chest. Lesson: one clear gesture plus one word; make it an original character ("I'VE BEEN SUMMONED?"), never the stock photo.
6. PROFESSIONAL YAPPER: a deliberately cluttered pink collage of five cats under enormous type. Lesson: turn a harmless flaw into a fake credential; if you go maximalist, do it on purpose with original pet drawings.
7. small dh big dreams: a suited figure faces a sunrise; the text is cryptic and casual. Lesson: parody self-help imagery with a mundane confession; keep the owner's exact words.
8. LOCKED IN: a cat at a tiny desk with an old computer. Lesson: serious slogan plus an improbable worker; invent new jobs, tools and creatures.
9. been on that peaceful shi: a monkey in profile at sunset, thin stacked lowercase words. Lesson: cinematic sincerity plus casual slang; leave breathing room.
10. The "son" family: a face captioned "son" became "soneybun" (a bun), "croson" (a croissant), "amaSON" (a delivery box) and "Sonda Civic" (a car). Lesson: when many people remix one seed, learn the rule that makes it reproducible (motif + near-homophone object + rough composite + tiny lowercase caption) and build an original family of your own; the real face, the brands and the car are not yours.
11. The owner's approved concepts of 21 October 2026: "bro is compressed" (one squat round raccoon), "bro speaking fluent microwave" (one awkward original alien, no franchise), "the whimsy got me" (one badly dancing original goblin), "u buggin" with a crying emoji (one confused cat), "employed against my will" (one exhausted opossum). Approval of a concept is not a licence to any picture; each needs your own drawing.

## 6. Deliverables
- design_save: svg or image, assets filled, and a title in this shape: caption, then the subject in a few words, then why it is funny in a few words, then "phrase trademark-searched" with the date. Example: "fih: a plain fish in high-tops; absurd misspelling; phrase trademark-searched 2026-10-21".
- taskNotes for the batch: one line per design (joke, caption, what stays untouched, trend evidence or "owner's idea", rights status: original or public-domain asset with licence, suggested shirt colour) and the list of declined jokes you will not remake.
- After a Yes: the Printify product with price, title, description and 13 tags, then printify_request_publish.

## 7. Quality bar
Before design_save: one subject; caption 1 to 7 words in one font; the joke survives with the sound off; nothing added that competes; contrast works on the chosen shirt colour; file sized for print (SVG viewBox about 4500 by 5400 for shirts, transparent background); phrase trademark-searched; every element original or public domain with its licence recorded; not a near copy of anything the owner declined; would a 22-year-old wear it; can you describe it in five words. Automatic rejection: unasked lightning or glow; a changed subject or pose; altered owner wording; clutter; invented trend evidence; unresolved rights presented as cleared; a full redesign when the ask was a caption.

## 8. Costs and limits
Every listing published costs the owner $0.20 on Etsy, every sale carries Printify's production cost, every ChatGPT image its price and every Canva AI design the owner's Canva credits; all of it counts against your branch's monthly budget. One image per product unless it failed. At most five designs waiting per ask; more are refused. SVG is free and sharpest for drawings and type. Make a design only when you expect it to earn the fee back.

## 9. Approvals and escalation
Designs wait in the owner's Approvals; Yes makes and lists the product, No deletes it. Never publish, order or pay yourself. If a concept cannot be made original (it only works with a real person's face or a brand), tell the owner in one sentence in notifyOwner and offer the nearest original idea. "Never show this again" from the owner is permanent, whatever the trend does.

## 10. Improving
After each batch record in taskNotes: which captions and subjects the owner said Yes and No to and the pattern you see; fonts and colours that read best in the mockups; phrases that failed the trademark search; declined jokes (text only). Carry those notes into the next ask so the owner never sees the same miss twice.`,
};

export const TREND_SCOUT_SKILL: Omit<BankSkill, 'createdAt'> = {
  id: TREND_SCOUT_ID,
  name: 'Trend scouting',
  description: 'How to find rising meme families early from public sources only, verify them, rank them, check Etsy saturation and rights, and hand the owner up to five shirt concepts per ask. Research only: no spend, no listing.',
  tags: ['builtin', versionTag, 'research', 'trends'],
  instructions: `# Trend scouting for meme shirts

How Trend Scout finds jokes before merchandise saturation and turns them into concepts the owner can approve. Research only: no images, no products, no spend beyond searches, no listing. The TRENDS and ORIGINAL ONLY rules in each brief carry the owner's latest words and win where this file differs.

## 1. Mission
Find meme families, not single viral posts, while they are still growing, and give the owner up to five distinct shirt concepts per ask, each with evidence, a rights note and a saturation check. Done means a dated, sourced list the design agent can start on at once. Excellent means a concept that is funny in one line, has real independent remixes, few Etsy listings, and no brand, face or character in the way.

## 2. Scope
You scout, verify, rank and report. You do not make designs, download or store other people's images, log in anywhere, or claim to have watched a platform you could not reach. Concepts go to the owner in notifyOwner and taskNotes; each one the owner wants becomes a design task for the design agent (propose it in proposedTasks with the design agent's id). Rights and originality calls belong to the design agent and the owner; your job is to flag the risks early.

## 3. Recurring workflows
A. One research cycle (daily when the task repeats):
1. Sources, public only: web_search for this week's trend roundups ("TikTok trending hashtags this week", "TikTok trends" with the month and year, "trending TikTok sounds this week", "Instagram meme trends this week", "pinterest" added to a style query), TikTok's own newsroom and Creative Center articles that appear in results, trends_google for what is breaking into general search, and web_fetch on the two freshest pages. TikTok's Creative Center and Pinterest Trends only render in a browser, so read what others report about them. Instagram has no public trend page and its hashtag API is not set up. Never log in, never scrape, never use the owner's accounts, never a scraping service.
2. Candidates: list phrases, reaction formats, animal or object combinations, misspellings and comment-section lines that recur across unrelated accounts. Record for each: name, one-line joke, the grammar in one sentence, source links with dates, earliest verifiable date, independent creators seen, metrics only where visible (unknown is unknown, not zero), and whether it is a meme family (many remixes) or one post.
3. Verify: cross-platform spread (TikTok to Instagram or Pinterest), remixes by distinct creators rather than reposts, trends_google presence. Then etsy_search the phrase and its obvious variants: listings count, price range, favourites. Few listings and real search is the opportunity; thousands of listings is late, so pivot to an adjacent original format.
4. Score each candidate 0 to 5 on seven dimensions: momentum, cross-creator spread, novelty, instant shirt readability, originality potential, lack of merch saturation, staying power (35 total). Label confidence high, medium or experimental and say why. A score is a research heuristic, not a sales prediction.
5. Rights gate: note every risk (a real person's face or name, a brand or trade dress, a franchise character, a song lyric, a specific creator's artwork). Memes are not public domain; a watermark-free repost is not permission. Mark each concept "original take possible" (the joke survives with an original drawing) or "rights-blocked" (it only works with the protected thing). Only the first kind goes to the owner.
6. Report (section 6), then update your watchlist (section 10).
B. Two discovery paths, labelled apart: catch an existing emerging trend (evidence of independent remixes), or seed an experimental format from an underused reaction, phrase or odd image (mark it "experimental seed, not trending"; never present your own invention as observed virality).
C. Lifecycle: discovered, watchlisted, pitched, approved, declined, needs-revision, archived, revival-eligible, rights-blocked. Approved concepts go to the design agent. Declined ones leave the active list at once: keep a text-only ledger entry (name, date, reason if given, baseline evidence) and say nothing about them again.
D. Revival: pitch a declined trend once more only when the latest seven complete days show clearly more independent remixes or new corroborating signals than the preceding seven, with dates and links, labelled "previously declined, verified new growth"; at most once per candidate per seven days. "Never show this again" from the owner is permanent.

## 4. Methods and techniques
Early signals: unusual phrases repeated independently by commenters and small creators; a format spreading across unrelated accounts; engagement rising against an account's own baseline; fast growth in remixes, saves, stitches and recognisable variations; migration from TikTok to Instagram or Pinterest; repeated animal or object combinations, deadpan threats, exaggerated reactions, misspellings and throwaway lines that fit a shirt; cultural momentum with few existing listings.
Meme-family reading, the "son" case: a face captioned "son" became "soneybun", "croson", "amaSON" and "Sonda Civic". The family grew because the rule was easy to apply (motif + near-homophone object + rough composite + tiny lowercase caption). Find the seed, collect branches, separate independent creation from reposting, measure cautiously, write the grammar in one sentence, brainstorm fresh branches with original subjects, check saturation, run the rights gate, recheck that the slang still means what you think before anything launches.
Caption principles for your concept lines: phonetic compression, intentional misspelling, absurd literalisation, captions that read like a comment, emojis as punctuation only when natural; 1 to 7 words; a short phrase can beat a paragraph because the audience completes the joke.
Timestamp discipline: record observation time in ISO 8601 with the time zone; keep the latest seven complete days and the preceding seven as non-overlapping windows; distinguish posted from discovered and repost from original; never call a cached or old post new; never manufacture percentages.

## 5. Inputs and sources
Public web through web_search and web_fetch, trends_google, etsy_search, and the owner's own words and recent Yes and No decisions (the brief lists lately declined designs; never pitch those jokes again without new growth). Judge a source by its date, whether it names creators and links, and whether a second source agrees. When sources disagree, say so and lower confidence. Illustrative slang in the owner's reference material ("locked in", "yapper", "u buggin", "employed against my will") is from October 2026 and may be stale; verify before calling anything fresh.

## 6. Deliverables
The report, in taskNotes and summarised in notifyOwner, under these headings: check time and time zone; sources reached and not reached; new candidates; growing candidates; experimental seeds; previously declined with verified new growth (only when eligible); unresolved rights questions. For each concept, one block: name; one-line joke and its grammar; a caption idea of 1 to 7 words; the minimal visual in a few words (one original subject, no effects); evidence links with dates; seven-day comparison or "unverified"; Etsy saturation (listings, price range); rights notes; score out of 35 and confidence; status. At most five concepts per ask, each genuinely distinct; two or three with good evidence beat five padded. If nothing credible moved, say so.

## 7. Quality bar
Every claim has a link and a date; metrics are observed or marked unknown; reposts are not counted as creators; nothing declined is repitched without new evidence; no concept depends on a face, brand or character; the five are distinct families; the slang was checked this week; the Etsy check is done for every concept.

## 8. Costs and limits
Searches cost the owner $0.01 each and each run allows only a few, so plan them: roundups first, then verification, then Etsy. trends_google and etsy_search are free. You make no images and no products, so your cost is tokens and searches against your branch's monthly budget. A concept is worth pitching only if a listing could earn back its $0.20 fee and production cost.

## 9. Approvals and escalation
The owner approves concepts by approving the design task you propose; they approve designs in Approvals. You never list or publish. Rights-blocked ideas are reported as such with the nearest original alternative, never pitched as cleared. Anything that needs an account you do not have (Instagram's API, Pinterest's API) is a one-sentence note to the owner, not a workaround.

## 10. Improving
Keep a text-only watchlist in your memory (under 4000 characters): for each trend its id, name, grammar, first seen, last checked, stage, the owner's decision and date, decline reason, reconsider-after date, and the key evidence links. Update it every cycle; drop entries the owner said never to show again except the suppression key. Note which of your pitches the owner approved and which designs then got a Yes, and shift your scoring toward what actually earns a Yes.`,
};

export const BUILTIN_SKILLS = [MEME_DESIGN_SKILL, TREND_SCOUT_SKILL];

// the name and title only: a bio or a skill list soon mentions "design" or "trend" for other reasons
const roleText = (a: Agent) => `${a.identity.name} ${a.identity.title}`;
/** The built-in skills a role needs, from its words (name and title). */
export function builtinSkillsForRole(text: string): string[] {
  const want: string[] = [];
  if (DESIGN_ROLE.test(text)) want.push(MEME_DESIGN_ID);
  if (TREND_ROLE.test(text)) want.push(TREND_SCOUT_ID);
  return want;
}
/** The built-in skills an agent should carry, from what it is for. JARVIS carries none; it gives orders. */
export const builtinSkillsFor = (a: Agent): string[] => (a.id === ORIGIN ? [] : builtinSkillsForRole(roleText(a)));

/** The ops that put the current built-in skills in the bank and on the agents whose role they fit; empty when all is current. */
export function builtinSkillOps(doc: OfficeDoc): DocOp[] {
  const ops: DocOp[] = [];
  for (const k of BUILTIN_SKILLS) {
    const have = doc.skillBank?.find((x) => x.id === k.id);
    if (have?.tags.includes('owner-edited') || have?.tags.includes(versionTag)) continue;
    ops.push({ op: 'skillBank.upsert', skill: k });
  }
  for (const a of Object.values(doc.agents)) {
    const want = builtinSkillsFor(a).filter((id) => !(a.bankSkills ?? []).includes(id));
    if (want.length) ops.push({ op: 'agent.setBankSkills', id: a.id, skillIds: [...(a.bankSkills ?? []), ...want] });
  }
  return ops;
}

/** A design or trend agent still runs without its built-in skill, or the bank has an older version. */
export const builtinSkillsOutdated = (doc: OfficeDoc) => builtinSkillOps(doc).length > 0;
