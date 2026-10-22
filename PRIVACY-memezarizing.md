# Privacy policy for Memezarizing (The Brain)

**Memezarizing** is the name of the owner's shop and of the owner's Pinterest and Meta developer apps. **The Brain** is the personal tool behind them, run by its owner on his own computer. It is not a public service, it has
no users other than the owner, and it sells nothing and shares nothing. This page exists because the
services it connects to (Pinterest, Meta's Instagram API) ask for one.

Last updated: 22 October 2026.

## What the tool does

The Brain is a desktop app and a small local server on the owner's PC. Its AI agents research ideas for
the owner's print-on-demand shop. For that research they read public information from Pinterest and
Instagram through the owner's own developer apps and the owner's own accounts.

## What it reads from Pinterest and Instagram

- Pinterest: trending keywords, pin search results (titles, descriptions, links and pin ids), and the
  contents of one board the owner keeps for that purpose (a secret board named "memez").
- Instagram: the owner's own account numbers (follower and post counts), the owner's own posts
  (captions, like and comment counts, links), and, where Meta allows it, public posts under a hashtag
  (captions, counts, links).

Images are never downloaded from either service. No other person's account is read, and no personal
data of any other person is collected or stored: a caption or title may be kept as the record of an
idea, never a name, profile or message.

## What it writes

The only write on any social account is this: the owner's agents may save a pin to the owner's own
secret Pinterest board "memez" and remove it from that board later, so an idea is not lost. The tool
cannot post, comment, like, follow, message, or change anything else, by design: every other write is
refused in the code before it reaches Pinterest or Meta.

## Where the data is

Everything stays on the owner's PC:

- Access tokens and refresh tokens are stored in the owner's Windows profile folder
  (`%APPDATA%\the-brain\`), outside the app and never in any repository, log or prompt.
- Research notes (titles, captions, counts, links, the owner's own notes) are stored in a folder on
  the owner's PC.

Nothing is uploaded to a server of ours (there is none), nothing is sold, shared, or given to any third
party. The text of research notes may be sent to Anthropic's API as part of the agents' work, under
Anthropic's own terms; that text contains no personal data of other people.

## Deleting data

The owner can disconnect a service at any time by deleting its token file or by revoking the app in
Pinterest's or Meta's settings. Deleting the research folder removes every note.

## Contact

Operator: Memezarizing (the owner's shop at etsy.com/shop/Memezarizing), the account that registered the
Pinterest and Meta developer apps that link here. Questions go to the email address on those developer
accounts.
