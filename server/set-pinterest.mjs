// Connect the owner's Pinterest app for trends and idea search: npm run set-pinterest
// Needs a Pinterest developer app with an access token (pins:read, boards:read, user_accounts:read;
// pins:write + boards:write only for the secret memez board; trends need an approved app).
// The token is typed hidden (or taken from the clipboard) and checked before saving.
import { findOrCreateBoard, pingPinterest, pinterestConfig, savePinterest } from './pinterest.mjs';
import { secretsDir } from './key-file.mjs';
import { askSecret, describeToken, finish } from './secret-prompt.mjs';

async function main() {
  const { token, from } = await askSecret('Pinterest access token');
  if (token.length < 20) { console.log(`\nNo token arrived (${from === 'nothing' ? 'nothing typed and the clipboard is empty' : describeToken(token)}). Copy it again and run this once more. Nothing was saved.`); return 1; }
  console.log(`Checking the token with Pinterest (${describeToken(token)}, from the ${from})...`);
  const cfg = { ...(pinterestConfig() || {}), token, savedAt: new Date().toISOString() };
  try { cfg.username = await pingPinterest(cfg); }
  catch (e) { console.log(`\n${e.message}. Nothing was saved.`); return 1; }
  let boardNote = '';
  try { const b = await findOrCreateBoard(cfg); cfg.boardId = b.id; cfg.boardName = b.name; boardNote = `The agents may save pins to your secret "${b.name}" board and remove them from it; that board is the only thing they can write to.`; }
  catch (e) { delete cfg.boardId; boardNote = `No memez board (${e.message}); the agents can read trends and search pins, but not save any. For saving, make a new token with boards:write and pins:write too, then run this again.`; }
  savePinterest(cfg);
  console.log(`\nSaved: connected as ${cfg.username || 'your Pinterest account'}. ${boardNote} Nothing in the app can post, comment or follow. Stored in ${secretsDir()}, outside the app folder.`);
  return 0;
}
finish(await main());
