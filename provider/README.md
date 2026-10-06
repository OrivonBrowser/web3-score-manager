# Orivon Attila: how a website is judged

This directory is Orivon Attila, the provider Orivon runs (see the repository README for its
address and how it is published). Every website evaluation in `scores/website/` is judged by the
rules below. Read them before adding or changing one, and apply them as written: a level that
departs from them is a mistake, even when the site seems to deserve it.

## Where a judgement starts

Orivon observes Levels 1 and 2 itself: Level 2 when every file of the page is checked against an
ENS name or an IPFS address, Level 1 otherwise. A judged 1 or 2 changes nothing it shows. A
judgement matters when it says 3 or 4, and it covers the build its identifiers name, not the
project in general.

A site reachable only at an ordinary web address has no identifier a provider can file, and stays
at the Level 1 Orivon observes. Look for an official IPFS or ENS build of it first; judge that
build only if it loads. A build whose files cannot be fetched, or that renders nothing, is not
judged: nobody can open it, so a level would describe nothing.

## The website levels

These are the definitions every website judgement applies:

- **Level 1:** a standard website, without DDOC. Detected by Orivon.
- **Level 2:** the site supports DDOC. Detected by Orivon.
- **Level 3:** the site root is open source and won't execute any external code without the user
  willingly consenting to it and being aware of its risk and trustlessness.
- **Level 4:** the site is trustless enough in all of its operations (Level 4 operations) and
  external connections (Level 2 connections). Passive operations count: getting an IBAN from a
  bank is not accepted at this level, it is a passive operation at Level 1. The exceptions are
  operations and connections whose trustlessness the user is clearly aware of, as long as
  everything else is managed in a trustless way. Example: Bisq provides fiat exchange, and you
  know that fiat interactions are not trustless by themselves; nobody needs to tell you.
- **Level 4 + privacy:** every single activity on the site, connections and operations included,
  is reasonably privacy preserving, and the user is made aware of the privacy risk of a specific
  risky action.

## How Attila applies Level 3

- **Open source** means the source of the site root is public, so anyone can read what runs. A
  licence is not required; say in the summary when there is none. The source must be of the same
  project as what the name or CID serves. A page served as written, with no build step (plain HTML
  and CSS, unminified scripts, or minified scripts shipped with their source maps), is its own
  public source. A minified bundle with no public repository is not. Cite the source in
  `evidence`. Without public source, the site stays at 2.
- **Willing, aware consent to external code** means the user chose to run it and knows whose it
  is:
  - they accepted Orivon's grant dialog, which names what the app reaches;
  - running it is the evident purpose of the site: a YouTube client runs YouTube's code; or
  - it starts from something the user does knowingly: opening a widget, connecting a wallet,
    pressing play on a video the page says comes from YouTube.
- **No consent** is code that runs on its own: analytics and tag managers (Google, Plausible,
  Fathom, Umami), trackers and ad pixels, error reporting, session replay, chat widgets, remote
  configuration, a wallet SDK's hidden frame loaded before the user connects, a third-party embed
  that loads as the page opens (even a visible YouTube player), and a library fetched from a CDN
  without an `integrity` hash (the CDN can change it at any time). A site that runs any of these
  stays at 2 even when it is open source, and its summary says which.
- A library from a CDN pinned by an `integrity` hash counts as the site's own code: the browser
  refuses any other bytes. Tracking code bundled into the site's own files is its own code too;
  the requests it sends are connections, judged under Level 4.

FreeTube is the worked example. It runs YouTube's player code and BotGuard to play a video. The
user learns this from the grant dialog, and using YouTube without ads is why they open the app,
so the consent is willing and aware.

## How Attila applies Level 4

- **Connections** must be Level 2 or better: the data received can be checked against a trustless
  system, such as files fetched by CID and checked by Orivon, or chain state read through a light
  client. An RPC endpoint read without a light client, an indexer, a backend API, a font or image
  host and analytics are Level 1 connections.
- **Operations** must be Level 4, passive ones included: reading balances, prices, quotes or a
  vault address from a centralised API is a passive operation at Level 1.
- Reads made through the user's own wallet (`window.ethereum`) after they connect it go through
  the connection the user chose, not one the site chose.
- **The exception** covers what the user clearly knows is not trustless, either because the site
  tells them before it happens or because it is evident, as long as everything else is trustless:
  - FreeTube (YouTube), The Lounge (the IRC networks the user joins) and Element (the Matrix
    homeserver the user signs in to) are Level 4. A user knows YouTube, an IRC network or a
    homeserver is run by someone, their other features are optional and off until turned on or
    started by the user, and what they keep locally is trustless.
  - ASGARDEX stays at 3. The vault address a swap sends funds to comes from a centralised API,
    and nothing in a wallet tells its user that.
  - James Carnley's page is Level 4: its videos load from YouTube only when the reader presses
    play, and the page says so beside each one.
- AirGap Vault and Orivon Explore, which make no network request, are Level 4.

## How Attila applies Level 4 + privacy

Set `"privacy": true` when every activity is reasonably privacy preserving: the site makes no
request beyond its own files, or warns before the one action that does, as James Carnley's page
does for YouTube. Fetching the site's own files from IPFS does not count against it. A Level 4
site whose ordinary use shows the user to a server is not private: FreeTube, The Lounge and
Element are Level 4 without privacy.

## How to check a site

1. **Identify the build.** For a `.eth` site, resolve the name to its root CID and file it as a
   base32 CIDv1 (`cid:bafy...`): that is the identifier Orivon looks up. When the name moves to
   new content, the evaluation no longer applies until the new CID is judged. For an Orivon port,
   list both the bundle hash and the CID (see the repository README).
2. **Watch it open.** Load the CID in a headless browser and record every request in the first 20
   seconds without touching the page. Every request that leaves the site's own files is a
   connection to judge, and every script from another origin is third-party code.
3. **Read the source** for what happens on the site's actions: what a button reaches, which
   endpoints are hard-coded, whether an option is on by default.
4. **Write the evaluation**: the level, a summary that says why it is that level and not the next
   one up, the operations and connections found, the repository in `evidence`, and the date in
   `evaluated`.
