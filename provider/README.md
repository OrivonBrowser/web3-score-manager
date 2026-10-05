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

## Level 3: open source, and no third-party code the user has not knowingly accepted

- **Open source** means the source is public, so anyone can read what runs. A licence is not
  required; say in the summary when there is none. The source must be of the same project as what
  the name or CID serves. A page served as written, with no build step (plain HTML and CSS,
  unminified scripts), is its own public source. A minified bundle with no public repository is
  not. Cite the repository in `evidence`. Without public source, the site stays at 2.
- **Knowingly accepted third-party code** is code the user knows will run, because:
  - they accepted Orivon's grant dialog, which names what the app reaches;
  - running it is the evident purpose of the site: a YouTube client runs YouTube's code, a Matrix
    client talks to the homeserver the user signs in to;
  - it is a visible embed that shows whose it is, such as a YouTube player in a post; or
  - it starts from something the user visibly does: opening a widget, connecting a wallet,
    pressing play.
- **Not knowingly accepted** is code nothing announces and nobody sees, loaded from another
  origin when the page opens: analytics and tag managers (Google, Plausible, Fathom, Umami),
  trackers and ad pixels, error reporting, session replay, chat widgets, remote configuration, a
  wallet SDK's hidden frame loaded before the user connects, and a library fetched from a CDN
  without an `integrity` hash (the CDN can change it at any time). A site that loads any of these
  stays at 2 even when it is open source, and its summary says which.
- A library from a CDN pinned by an `integrity` hash counts as the site's own code: the browser
  refuses any other bytes. Tracking code bundled into the site's own files is its own code too;
  the requests it sends are connections, judged under Level 4.

FreeTube is the worked example. It runs YouTube's player code and BotGuard to play a video. The
user learns this from the grant dialog, and using YouTube without ads is why they open the app,
so the consent is informed: Level 3.

## Level 4: no non-trustless operation or connection without the user being aware of it

Level 3, and in addition:

- Opening the site and using it in the ordinary way makes no connection to a centralised party:
  no RPC endpoint, indexer, backend API, font or image host, analytics. A non-trustless
  connection is allowed only when the user asks for that connection knowingly: an option that is
  off until they turn it on, a button that says what it reaches.
- Data checked against a trustless system does not count against it: files fetched by CID and
  checked by Orivon, chain state read through a light client.
- Reads made through the user's own wallet (`window.ethereum`) after they connect it go through
  the connection the user chose, not one the site chose.
- A site built around a centralised service is Level 3, not 4, even though the user knows the
  service exists: its ordinary use is non-trustless. FreeTube (YouTube), Element (the homeserver)
  and The Lounge (IRC networks) are 3. AirGap Vault and Orivon Explore, which make no network
  request, are 4.

Website privacy (`"privacy": true`) needs every activity to be reasonably privacy preserving.
Fetching a site from IPFS still tells peers or a gateway what is read, so Attila leaves it false.

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
