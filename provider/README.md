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
  bank is not accepted at this level, it is a passive operation at Level 1. A site whose purpose
  relies on a server is not Level 4, however standard or trust-minimised its protocol and whoever
  picks the server. The exceptions are an optional part that runs only with the user aware of it,
  and a step the user takes outside the site, as long as everything else is managed in a
  trustless way. Example: Bisq provides fiat exchange, and fiat payments are not trustless; but
  the payment goes from the user's own bank, outside the app, and the trade itself does not rely
  on a server.
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
so the consent is willing and aware. It stops at 3 because it relies on YouTube's servers.

## How Attila applies Level 4

- **Connections** must be Level 2 or better: the data received can be checked against a trustless
  system, such as files fetched by CID and checked by Orivon, or chain state read through a light
  client. An RPC endpoint read without a light client, an indexer, a backend API, a font or image
  host and analytics are Level 1 connections.
- **Operations** must be Level 4, passive ones included: reading balances, prices, quotes or a
  vault address from a centralised API is a passive operation at Level 1.
- Reads made through the user's own wallet (`window.ethereum`) after they connect it go through
  the connection the user chose, not one the site chose.
  ASGARDEX stays at 3: the vault address a swap sends funds to comes from a centralised API.
- **Relying on a server.** A site relies on a server when, if that server stops or lies, the user
  loses what they opened the site for or is shown false data. Such a site is at most Level 3,
  even when its protocol is open and standard, the user picks the server or could run their own,
  and everyone knows who runs it. FreeTube relies on YouTube, The Lounge on the IRC network a
  conversation lives on, and Element on the Matrix homeserver that holds the account and delivers
  every message: all three are Level 3.
- **Servers that only find peers** are not relied on. Trackers, a DHT and bootstrap or seed nodes
  tell the app where peers are, any of many will do, and what the peers send is checked against a
  hash, so a wrong answer costs time, never integrity. They are still Level 1 connections, and
  they count against privacy. WebTorrent is Level 4.
- **The exceptions** cover two things the user clearly knows are not trustless, as long as
  everything else is trustless:
  - an optional part that runs only when the user knowingly starts it. James Carnley's page is
    Level 4: its videos load from YouTube only when the reader presses play, and the page says so
    beside each one;
  - a step the user takes outside the site, with a party they chose: Bisq's fiat payment, sent
    from the user's own bank.
- AirGap Vault and Orivon Explore, which make no network request, are Level 4.

## How Attila applies Level 4 + privacy

Privacy is non-negotiable: consent does not buy an exception. Set `"privacy": true` only when no
connection the site causes can show the user to another party. A connection without a proxy or
another form of anonymity shows their IP address and what they do, so it is not privacy
preserving even when the user asked for it after a warning. A warning is enough only for a risky
action the user takes themselves, such as publishing something under their name, never for a
connection. The site's own files, which Orivon fetches the same way for every site, do not count.

- AirGap Vault, Walletbeat, ronan.eth, raffy.eth, ricmoo.eth and ENS Interviews connect to nothing
  beyond their own files: Level 4 with privacy.
- James Carnley's page warns before a video loads from YouTube, but YouTube then sees the reader's
  IP address: Level 4 without privacy.
- Orivon Explore sends no request itself, but a visitor who grants `trust.score` has Orivon resolve
  every listed `.eth` name and ask their Web3 Score provider about every listed site, which shows
  the provider their IP address and that they opened Explore: Level 4 without privacy.
- WebTorrent shows the user's IP address and the torrents they fetch to trackers, the DHT and
  every peer: Level 4 without privacy.

## How to check a site

1. **Identify the build.** For a `.eth` site, resolve the name to its root CID and file it as a
   base32 CIDv1 (`cid:bafy...`): that is the identifier Orivon looks up, and list the name in
   `names`. When the name moves to new content, the evaluation no longer applies until the new
   CID is judged: the Watched names workflow opens an issue listing every such name each day
   (`node src/cli.ts moved` asks the same now). A new build that makes the same connections as
   the judged one, with no new third-party code, takes the same evaluation: add its CID. For an
   Orivon port, list both the bundle hash and the CID (see the repository README).
2. **Watch it open.** Load the CID in a headless browser and record every request in the first 20
   seconds without touching the page. Every request that leaves the site's own files is a
   connection to judge, and every script from another origin is third-party code.
3. **Read the source** for what happens on the site's actions: what a button reaches, which
   endpoints are hard-coded, whether an option is on by default.
4. **Write the evaluation**: the level, a summary that says why it is that level and not the next
   one up, the operations and connections found, the repository in `evidence`, and the date in
   `evaluated`.
