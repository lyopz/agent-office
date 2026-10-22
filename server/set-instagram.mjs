// Connect the owner's Instagram professional account: npm run set-instagram
// Two kinds of token are accepted, both read-only:
//   1. From the Meta app dashboard, Instagram > API setup with Instagram login > Generate token.
//      Needs no account id. Sees the owner's own account only (profile numbers, own posts).
//   2. From Facebook Login for Business (Graph API Explorer) with instagram_basic, pages_show_list and
//      the Instagram Public Content Access feature, plus the Instagram account id. Adds hashtag search.
// The token is typed hidden (or taken from the clipboard) and checked with Meta before saving.
import { TOKEN_DAYS, canRenew, instagramConfig, pingInstagram, saveInstagram } from './instagram.mjs';
import { secretsDir } from './key-file.mjs';
import { ask, askSecret, describeToken, finish } from './secret-prompt.mjs';

async function main() {
  console.log('Which token?\n  1  Instagram login token (app dashboard: Instagram > API setup with Instagram login > Generate token). Own account only.\n  2  Facebook Login for Business token (Graph API Explorer, instagram_basic + pages_show_list + Public Content Access). Adds hashtag search.');
  const choice = await ask('1 or 2: ');
  const kind = choice === '2' ? 'facebook' : 'instagram';
  const igUserId = kind === 'facebook' ? await ask('Instagram account id (Graph API Explorer: me/accounts, then <page-id>?fields=instagram_business_account): ') : '';
  const { token, from } = await askSecret('Access token');
  let appId = '', appSecret = '';
  if (kind === 'facebook') {
    appId = await ask('App id, so the runner can renew the token itself (App settings > Basic; press Enter to skip): ');
    if (appId) appSecret = (await askSecret('App secret (App settings > Basic > Show)')).token;
  }
  if (kind === 'facebook' && !/^\d{5,}$/.test(igUserId)) { console.log('\nThat account id does not look right (digits only). Nothing was saved.'); return 1; }
  if (token.length < 20) { console.log(`\nNo token arrived (${from === 'nothing' ? 'nothing typed and the clipboard is empty' : describeToken(token)}). Copy the token again and run this once more. Nothing was saved.`); return 1; }
  console.log(`Checking the token with Meta (${describeToken(token)}, from the ${from})...`);
  const cfg = { ...(instagramConfig() || {}), kind, igUserId, token, savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TOKEN_DAYS * 86_400_000).toISOString(), refreshedAt: null, refreshError: null, ...(appId && appSecret ? { appId, appSecret } : { appId: undefined, appSecret: undefined }) };
  try { const me = await pingInstagram(cfg); cfg.igUserId = me.igUserId || igUserId; cfg.username = me.username; }
  catch (e) {
    console.log(`\n${e.message}. Nothing was saved.`);
    if (kind === 'instagram') console.log('If you copied the token a moment ago, it is not expired: Meta says that for a token it cannot read. Copy it again from the dashboard (Instagram > API setup with Instagram login > Generate token), then run this and just press Enter at the token question so it is taken from the clipboard. If the dashboard shows no Generate token button yet, accept the tester invite first: instagram.com/accounts/manage_access, Tester invites, Accept.');
    return 1;
  }
  if (!cfg.igUserId) { console.log('\nMeta did not return the account id. Nothing was saved.'); return 1; }
  saveInstagram(cfg);
  console.log(`\nSaved: connected as @${cfg.username || cfg.igUserId} (${kind === 'facebook' ? 'Facebook login: own account and hashtag search, 30 hashtags a week' : 'Instagram login: own account numbers and own posts; Meta gives no hashtag search on this token'}). Read-only: nothing in the app can post, like, comment or follow. Stored in ${secretsDir()}, outside the app folder. ${canRenew(cfg) ? 'The token lasts 60 days and the runner renews it by itself every week while it runs, so it should never expire.' : 'The token lasts 60 days; the runner can renew it by itself if you run this again and give the app id and secret, otherwise run this again before it expires.'}`);
  return 0;
}
finish(await main());
