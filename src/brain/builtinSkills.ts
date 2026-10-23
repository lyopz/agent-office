// Three built-in bank skills (Meme shirt design, Trend scouting, Ad strategy), written from the owner's own meme-design playbook (October 2026) and
// adapted to this brain's rules: original work only, a trademark search before any phrase, the
// owner's "fih" style, at most five designs waiting per ask, and the owner's Yes or No in Approvals.
// They are attached by role: every agent that designs gets "Meme shirt design", every agent that
// scouts trends gets "Trend scouting", every agent that does ads gets "Ad strategy". Each brain gets the current version; an older copy is
// refreshed unless the owner edited it in the bank (tag owner-edited).
// Like originSkillFile.ts, this imports nothing at run time so the sample brain can use it.
import type { DocOp } from '../engine/ops';
import type { Agent, BankSkill, OfficeDoc } from '../model/types';

export const MEME_DESIGN_ID = 'skill_builtin_meme_design';
export const TREND_SCOUT_ID = 'skill_builtin_trend_scout';
export const AD_STRATEGY_ID = 'skill_builtin_ad_strategy';
export const BUILTIN_SKILL_VERSION = 3;
const versionTag = `builtin-v${BUILTIN_SKILL_VERSION}`;

const ORIGIN = 'agent_origin';
const DESIGN_ROLE = /design|mockup|mock-up|graphic|artwork|illustrat|art director|canva/i;
const TREND_ROLE = /trend|scout|meme|viral|social media|tiktok|instagram|pinterest/i;
/** Agents that make ads or do marketing (exported for the Ads tab, which finds or creates the ads agent). */
export const AD_ROLE = /\bads?\b|advertis|marketing|promot|campaign|\breach\b|growth/i;

export const MEME_DESIGN_SKILL: Omit<BankSkill, 'createdAt'> = {
  id: MEME_DESIGN_ID,
  name: 'Meme shirt design',
  description: "The owner's playbook for shirt designs from the memes they picked: name the meme's type and follow its recipe, five caption options with one kept, the owner's taste learned from their Yes and No, print rules, and a check of each finished design. Every agent that designs uses it.",
  tags: ['builtin', versionTag, 'design', 'apparel'],
  instructions: `# Meme shirt design

The owner's playbook for every design that goes to their store. It sits beside your own SKILL.md and the rules in each brief; where this file and the brief differ, the brief wins, because it carries the owner's latest words.

## 1. Mission
Turn a meme the owner picked into a shirt people would actually wear. The meme stays the meme: no AI art, no redrawing, no new pictures. Your job is the few decisions that make it a shirt: which kind of meme it is, what words (if any) go with it, which font, where it prints. Done means the owner can press Yes without fixing anything. Excellent means they laugh before reading the title and the shirt reads from across a room.

## 2. Scope
You work only from memes the owner said Yes to in memez (files_source with picks "yes") or their own files. You never search the web for pictures, never draw, never generate. A meme or post is someone's work, so your design is a flagged draft the owner reviews; it is never listed for sale as it is. After the owner's Yes on a design you get a task to make that product in Printify.

## 3. The meme-type playbook (name the type first, then follow its recipe)
1. Image macro: the meme already carries its words (top and bottom text, a punchline baked in). Recipe: no_caption true. Crop away watermarks, borders and app UI only. Placement full_front or front_center. Never add a second joke on top.
2. Reaction image: a face or gesture that means a feeling (side-eye, crying, pointing at itself). Recipe: one short caption that names the situation the face reacts to, 1 to 5 words, lowercase deadpan (plain) or impact. The face is the punchline, the words are the setup. front_center.
3. Edited or deep-fried photo: a real photo changed for the joke (the casino man with "ALWAYS BET ON NOTHING", glowing eyes, bad Photoshop). Recipe: keep every edit as it is, they are the joke. If the words are already in it, no_caption. If not, one bold all-caps line in impact. Do not remove the background. full_front.
4. Doodle or badly drawn meme: crude lines on paper or MS Paint. Recipe: remove_background so only the drawing prints, then a few words in hand or plain lowercase, or none. A small doodle with a one-liner suits left_chest; a big one front_center.
5. Format template: a multi-panel or labelled format (two buttons, distracted boyfriend). Recipe: these only work with the labels; write fresh labels that fit a wearer's life, short enough to read on a shirt (two to four words per label). If the panels are too busy to read from three metres, pick another meme. full_front or back.
6. Animal or object being a person: a cat at a desk, a frog in a suit, an object with a face. Recipe: cut the background if it is plain, caption the "job" or the feeling in 1 to 4 words (the job-title joke: "professional yapper", "locked in"). front_center or left_chest.
7. Anything else: say which of the above it is closest to and why, then follow that recipe.
Write the type in meme_type when you save, so the owner's Yes and No teach the next run which types and recipes work.

## 4. Captions: five options, keep one
For every meme that needs words, write five options before you choose, one through each lens: flip it (say the opposite of what the picture shows), understate it (the smallest possible reaction to something huge), who wears it (the situation of the person wearing the shirt: the office, the gym, the group chat), shorten it (the same joke in two words), and the comment-section line (what someone would reply under the post). Read each aloud: would someone send it in a group chat? Keep the one that is funniest with the picture, not alone. Never explain the meme, never a sentence with a full stop, never "when you..." text walls, never inspirational lines. Keep the owner's exact wording when they gave one, typos included.

## 5. The owner's taste: learn it from their Yes and No
Your brief carries THE OWNER'S TASTE SO FAR: the memes they picked and turned down, and the designs they said Yes and No to with type, caption, font and placement. Before you design, read it as the store's voice chart: write 3 to 5 traits in taskNotes, each with a do and a don't taken from those decisions (for example "deadpan, not wacky: Yes to 'locked in', No to 'LOL SO RANDOM'"). Follow the traits over your own idea of funny. When there are fewer than five decisions, say so and lean on this playbook.

## 6. Print rules (from banner and print practice)
- Safe area: everything that matters sits in the central 80% of the print; nothing touches the edge.
- One font per design, two at most when a format template has labels.
- Contrast: white text with a black outline or the reverse, so it reads on any shirt colour.
- The caption is never less than a tenth of the design's height; if it has to be smaller to fit, it is too long.
- The print file is at least 4500 px wide (the tool does this); a tiny source image that turns to mush when enlarged is the wrong pick.
- Placement: front_center for most; full_front for a big picture; left_chest for a small doodle or a one-liner; back for a busy format template.

## 7. Look at what you made
design_caption_image renders the shirt and the runner shows the result to a check before it reaches the owner. It fails a design that does not read from three metres, loses the joke, or has something added that competes with the meme. When it fails, it tells you why: fix that one thing (shorter caption, other font, crop, no caption) and save again. After two fails on the same meme, move on to another meme.

## 8. Anti-slop
Keep the composition, expression and proportions. No glow, lightning, neon, 3D or metallic type, gradients, frames, extra characters or busy backgrounds unless they are already in the meme. Remove before you add. The editing budget starts at zero.

## 9. Deliverables
design_caption_image with source_file (a Yes pick), meme_type, the caption or no_caption, font, placement and a title in this shape: caption, then the meme in a few words, then why it is funny. taskNotes: the voice chart traits, one line per design (type, recipe used, the five captions and the one kept), and the declined jokes you will not repeat. At most five designs waiting per ask, then set waitingOnOwner true.

## 10. Approvals and improving
Designs wait in the owner's Approvals; Yes makes the product, No deletes it. Never publish, order or pay yourself. After each batch, note which types, captions, fonts and placements the owner said Yes and No to and the pattern you see; the next run reads them back in THE OWNER'S TASTE SO FAR.`,
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

// the name and title only: a bio or a skill list soon mentions "design" or "trend" for other reasons

export const AD_STRATEGY_SKILL: Omit<BankSkill, 'createdAt'> = {
  id: AD_STRATEGY_ID,
  name: 'Ad strategy: inexpensive reach',
  description: "The owner's playbook for ads: reach buyers for approved, listed products as cheaply as possible (organic short video first, Pinterest, tiny paid tests), write each ad ready to post with ad_save, and let the owner approve and post it. Every agent that does ads or marketing uses it.",
  tags: ['builtin', versionTag, 'ads', 'marketing'],
  instructions: `# Ad strategy: inexpensive reach

The owner's playbook for every ad made in this brain. The ADS paragraph in your brief carries the owner's latest words and the list of approved products; where this file and the brief differ, the brief wins.

## 1. Mission
Get the owner's approved, listed products in front of the people who would buy them, for as little money as possible, and prove what works before any money is spent. Done means an ad the owner can approve in the Ads tab and post in under a minute: the channel named, the hook written, the text ready to paste, the hashtags chosen, the call to action clear, a shot list when it is a video, and its cost stated. Excellent means the first three ads for a product test three different hooks, each one could only be about that shirt, and a week later the numbers say which hook to keep.

## 2. Scope
You research reach and write ads for products in APPROVED PRODUCTS only. You never post, boost, pay, create accounts, message anyone or change a listing: the owner does all of that after approving. You do not make designs (the design agents do) and you do not decide what sells (the owner and the sales numbers do). A product with no approval is not yours to advertise. If an idea needs a trend sound, a celebrity, a brand or someone else's video, it is not yours to make; say so in taskNotes and offer an original take.

## 3. Recurring workflows
A. Research the approach (the first task, then once a quarter): with web_search and web_fetch, current sources dated this year, find how small print-on-demand apparel shops reach buyers cheaply: organic TikTok and Instagram Reels (hooks that convert for shirts, posting cadence, length, captions), Pinterest pins (titles and descriptions that keep bringing search traffic for months), Etsy Ads at the minimum budget (how the $1-a-day test works, when to raise or stop), and anything newer. Hand back a one-page plan: the first three things to do, what each costs in money and minutes, how success is measured, and a kill rule for each.
B. Ads for one product (the default ask): read the product (title, design, price, who it is for). Write three to five ads, each on one channel, with ad_save: at least one organic short video (shot list included), one Pinterest pin, and one still post or caption; a paid ad (Etsy Ads or a small Facebook/Instagram test) only when the product already sold or the owner asked. Fill cost_note for every ad ("$0 organic", "Etsy Ads $1 a day for 7 days, about $7"). Stop at five waiting ads for the ask, set waitingOnOwner true, finish the run.
C. After the owner's Yes: the ad is theirs to post. If they report numbers (views, clicks, sales) in a later task, write what the numbers say and the next variation to test. After a No, do not rewrite the same hook with new words; change the angle.
D. Weekly review when asked: for each product, which ads were approved, what the owner reports, what to try next; cut what did not move in two weeks.

## 4. Methods and techniques
Hooks first: the first line (or first second of video) names the joke or the feeling the shirt gives, never "check out my store". Good hooks: a question the buyer already asks, the shirt's caption said out loud in a situation, a confession, "POV:", "tell me you ... without telling me", a before/after of a plain shirt and this one. Keep the owner's wording of the design exactly, lowercase and typos included.
Short video shot list: 3 to 6 shots, each with what is on screen and the on-screen text, 7 to 20 seconds in all, the shirt readable in the first two seconds, the caption of the shirt as the punchline, a plain ending with the call to action. The owner films it with a phone; no effects, no music recommendations that need a licence (say "a trending sound of your choice" and nothing more).
Pinterest: the title is what someone would search ("funny fish shirt for dad"), the description two sentences with the search words and the feeling, a link to the listing; pins keep working for months, so prefer evergreen words over this week's slang.
Etsy Ads: a $1-a-day test for 7 days on a product that already sold organically; stop if clicks cost more than a tenth of the price with no sale; never raise the budget yourself.
Hashtags: 3 to 8 that real buyers follow (the subject, the feeling, the product type, the giftee), none that just repeat the caption, none that are a brand or a trademark.
Call to action: one, concrete ("link in bio", "shop the fih shirt", "save this for gift season").
Measurement: views and saves for reach, link clicks for interest, sales for truth. One change per test. Write every number the owner gives you into taskNotes with its date.
Costs: every ad says what it costs and why; organic is $0 plus the owner's minutes. You never spend; a paid idea is a proposal with the exact amount and the kill rule.

## 5. Inputs and sources
- APPROVED PRODUCTS in the brief (title, product id, design id, price): the only things you may advertise.
- The design itself (the gallery, by design_id) for the picture an ad shows; the mockup Printify made.
- Trend Scout's notes and trends_memes, trends_google, trends_instagram or trends_pinterest when connected, for the words buyers use now.
- Platform help pages and this year's guides, read with web_fetch and dated in your notes.
- The owner's numbers (views, clicks, sales) when they give them, and etsy_my_shop when Etsy is connected.

## 6. Outputs and deliverables
- ad_save calls, one per ad, every field filled: product_id, title, channel, format, headline, primary_text, hashtags, cta, script (videos), design_id, cost_note, why.
- taskNotes: which hooks were tried per product, what the owner reported, the next test.
- For the research task: the one-page plan in taskNotes and notifyOwner.

## 7. Quality bar
An ad passes when: it could only be about this one shirt; the hook works without the picture and the picture works without the hook; the text is ready to paste with nothing to fix; the cost is stated; nothing in it belongs to someone else (no brand, no celebrity, no other creator's video or sound named); the call to action is one line. Three ads for one product test three different angles, not one angle thrice.

## 8. Decision rules
- No approved product, no ad: research instead and say so.
- Organic before paid; paid only after a sale or the owner's word, always with a kill rule.
- Five waiting ads per ask, then stop and wait for the owner.
- A declined ad changes angle, never just words.
- Never post, pay, follow, message or create an account; the owner does.

## 9. Pitfalls
Generic store promotion ("new drop!"), hooks that need the viewer to already know the meme, hashtags that are brand names, copying another shop's video idea, recommending a specific copyrighted song, raising a budget to "give it a chance", claiming reach you did not measure.

## 10. How success is measured
Within a month of the first approved ad: the owner has posted ads for every approved product with under two minutes of work each; at least one hook per product has numbers; money spent on ads is zero unless a product had sold first; and the next test for each product is written down.`,
};

const BUILTIN_SKILLS = [MEME_DESIGN_SKILL, TREND_SCOUT_SKILL, AD_STRATEGY_SKILL];
/** Library (degen) skills taken off design agents: AI logo and image generation, web banners and UI tokens. */
export const NOT_FOR_DESIGNERS = ['skill_degen_design', 'skill_degen_banner_design', 'skill_degen_design_system', 'skill_degen_brand'];
const roleText = (a: Agent) => `${a.identity.name} ${a.identity.title}`;
/** The built-in skills a role needs, from its words (name and title). */
export function builtinSkillsForRole(text: string): string[] {
  const want: string[] = [];
  if (DESIGN_ROLE.test(text)) want.push(MEME_DESIGN_ID);
  if (TREND_ROLE.test(text)) want.push(TREND_SCOUT_ID);
  if (AD_ROLE.test(text)) want.push(AD_STRATEGY_ID);
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
    const have = a.bankSkills ?? [];
    const want = builtinSkillsFor(a).filter((id) => !have.includes(id));
    // designers lose the library skills that push AI art and web layouts (the owner's rule: found memes, light edits)
    const drop = builtinSkillsFor(a).includes(MEME_DESIGN_ID) ? have.filter((id) => NOT_FOR_DESIGNERS.includes(id)) : [];
    if (want.length || drop.length) ops.push({ op: 'agent.setBankSkills', id: a.id, skillIds: [...have.filter((id) => !drop.includes(id)), ...want] });
  }
  return ops;
}

/** A design or trend agent still runs without its built-in skill, or the bank has an older version. */
export const builtinSkillsOutdated = (doc: OfficeDoc) => builtinSkillOps(doc).length > 0;
