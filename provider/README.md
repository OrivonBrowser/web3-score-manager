# Orivon Attila: how a website is judged

This directory is Orivon Attila, the provider Orivon runs (see the repository README for its
address and how it is published). Every website evaluation in `scores/website/` is judged by the
rules below, and every integration evaluation in `scores/integration/` by the section How Attila
judges an integration at the end. Read them before adding or changing one, and apply them as
written: a level that departs from them is a mistake, even when the site or the integration seems
to deserve it.

## Where a judgement starts

Orivon observes Levels 1 and 2 itself: Level 2 when every file of the page is checked against an
ENS name or an IPFS address, Level 1 otherwise. A judged 1 or 2 changes nothing it shows. A
judgement matters when it says 3 or 4, and it covers the build its identifiers name, not the
project in general.

A site reachable only at an ordinary web address has no identifier a provider can file, and stays
at the Level 1 Orivon observes. Look for an official IPFS or ENS build of it first; judge that
build only if it loads. A build whose files cannot be fetched, or that renders nothing, is not
judged: nobody can open it, so a level would describe nothing.

## A `.eth.limo` address is the `.eth` name

Orivon, with its default settings, loads `<name>.eth.limo` and `<name>.eth.link` as `<name>.eth`,
checked on this computer, whether the address is opened as a page or embedded in one: a link, a
script, a style, an image, a font, a video or a `fetch`. Judge such an address as the `.eth` name
it stands for. A site that reaches its own files through its own name's gateway address is loading
its own files; one that reaches another name's content through a gateway address makes a Level 2
connection, the same as files fetched by CID. The gateway form is how a Web3 site keeps working in
other browsers, and it never lowers a level. Two exceptions stay gateway connections at Level 1: a
frame, which Orivon keeps loading through the gateway because a `.eth` site refuses to be framed
by another site, and any other gateway (`bzz.limo`, `dweb.link`, `ipfs.io`).

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
   base32 CIDv1 (`cid:bafy...`): that is the identifier Orivon looks up. List in `names` every name
   that serves the judged build, and only those: a score counts at the names listed, so a name that
   serves other content is left out. A site on IPFS served at a DNS host lists `ipns://<host>` when
   that host's DNSLink names the build; a name no resolver confirms stays unlisted, and the content
   then counts only at its own `ipfs://` address. A name that points at Swarm is filed by the CID of
   its Swarm root (`cid:bah5...`), the root its feed points at today when it has one. When the name
   moves to new content, the evaluation no longer applies until the new CID is judged: the Watched
   names workflow opens an issue listing every such name each day (`node src/cli.ts moved` asks the
   same now; it cannot read a Swarm name's root yet, and lists one as unresolved). A new build that
   makes the same connections as the judged one, with no new third-party code, takes the same
   evaluation: add its CID. For an Orivon port, list both the bundle hash and the CID (see the
   repository README).
2. **Watch it open.** Load the CID in a headless browser and record every request in the first 20
   seconds without touching the page. Every request that leaves the site's own files is a
   connection to judge, and every script from another origin is third-party code.
3. **Read the source** for what happens on the site's actions: what a button reaches, which
   endpoints are hard-coded, whether an option is on by default.
4. **Write the evaluation**: the level, a summary that says why it is that level and not the next
   one up, the operations and connections found, the repository in `evidence`, and the date in
   `evaluated`.

## How Attila judges an integration

An integration is something a person adds to their browser that then acts for them: an Account that
signs, a node that answers for a chain, a tunnel, a search engine, a source a name's sites load
from. A verdict is about that one integration, never about the site that offered it: a site that
offers five integrations has five verdicts, and updating the site changes none of them. A verdict
lives in `scores/integration/`, on the same four-step scale as a website, and Orivon draws it as
the mark on the integration's row and page (Level 1 is Web2, Levels 2 and 3 are Web2.5, Level 4 is
Web3).

**Built-ins are judged like every other integration.** The subject, the scale, the rules below and
the way the verdict is drawn make no exception for what Orivon ships. Orivon's publisher runs Attila,
so a built-in's summary ends "Judged here by its publisher", as Orivon Explore's does, and a reader
weighs it as that. A built-in is filed under its row, `integration:builtin:<name>`. That identifier is
provisional: it is the row's name until Orivon's built-ins are published as packages beside the
others, and then each is filed under its bundle hash like any other.

The row of a built-in standard is `builtin:std-` and its code in lower case, so `ETH_0_1` is filed as
`integration:builtin:std-eth_0_1`. A standard defines a code and answers nothing, so its row is judged as
a definition: it runs nothing and connects to nothing, and what answers the code is judged on its own row.

### What a verdict covers

`ids` holds the identifier Orivon looks the integration up by, in the form that fits what it is:

| The integration | Identifier | How to get it |
|---|---|---|
| Installed with its site's bundle pinned | `integration:<64 hex>#<declaration id>`: the bundle hash without its `sha256:`, a `#`, and the id its declaration gives it (lower-case letters, digits, `.`, `_` and `-`, at most 64 characters, the first a letter or a digit) | `node src/cli.ts ids <static-dir> --integrations` |
| A library or an extension: one file pinned by its own hash | `sha256:<64 hex>`: the SHA-256 of that file | the same command |
| A component or a standard with a file of its own, installed without its site's bundle pinned | `sha256:<64 hex>`: the SHA-256 of that file | the file's `hash` in its declaration |
| Only data (a score provider, a catalogue, a search, a link scheme: no code bundle and no file) | `integration:decl:<64 hex>`: the SHA-256 of its declaration as Orivon's manifest reader returns it (see the repository README), even when its site's bundle was pinned | the same command |
| Shipped with Orivon | `integration:builtin:<name>`: `builtin:` and the name of its row, in the characters of a declaration id | the row's id in Orivon's Integrations page |

Which one an integration has is the first of these that fits, in this order: a library or an extension is its file; one
with no code is its declaration, even when its site's bundle was pinned; any other integration whose site's bundle was
pinned is that bundle's; one with only a file of its own is that file; one with neither is its declaration. The `ids`
command prints one identifier a line, in the order the site's manifest lists its integrations. A search engine, a
catalogue or a Web3 Score provider is therefore filed by its declaration alone, whatever else its site brings, and
keeps its verdict when the site updates.

A verdict covers the code its identifier names. A site that updates an integration's files has a new
bundle hash and so a new identifier, which is judged when it appears; the old verdict stays on the
old build. `names`, `operations` and `connections` are not used: an integration is pinned content,
not a name, and it is judged as a whole.

### The levels

These are the website levels, read for an integration: its code, what it reaches, and what it does
with the person's keys, money or data take the place of a site's files.

- **Level 1 (Web2):** part of what it runs or shows comes from outside what Orivon pinned, so it
  cannot be checked: a page that loads its logic from a server at run time, or a pointer to a
  service whose pages are that service's (a Web2 search engine).
- **Level 2 (Web2.5):** everything it runs is pinned and can be checked, but its source is not
  public. Without public source an integration stays at 2.
- **Level 3 (Web2.5):** the source is public, it runs no external code the person did not knowingly
  start, but it relies on a server or a party, or on data nothing checks.
- **Level 4 (Web3):** open source, trustless in every operation (Level 4) and in every connection
  (Level 2 or better), and relying on no server except an optional part the person knowingly starts.
- **Level 4 + privacy:** no connection the integration causes can show the person to another
  party. Privacy is non-negotiable here too: consent does not buy it, and an integration that
  reaches the network at all almost never has it.

### Rules that carry over from websites

- **Relying on a server caps at Level 3**, however open the protocol and whoever picks the server.
  The test is the same: if that server stops or lies, does the person lose what they added the
  integration for, or see false data? A node that asks a public server whose answers nothing
  checks (an Esplora API, THORNode, Boltz) is 3. A node that checks every answer (a light client,
  an IPFS or Swarm node that checks blocks against their address) is not relying on the servers it
  asks for integrity.
- **Servers that only find peers are not relied on.** Bootstrap nodes and a DHT say where peers are,
  and what the peers send is checked against an address. They still count against privacy.
- **A pointer takes the level of what it points at.** An integration that is only an address (a
  search engine's template, a catalogue's feed, a Web3 Score provider's address) does nothing else,
  so it is judged with the thing it names: a search engine whose pages are a closed service's is 1,
  and one that opens a directory checked by its address is 4.
- **Passive operations count.** Reading a price, a balance or a quote from a source nothing checks
  is a Level 1 operation. A price read from an oracle network is trusted data: Level 3 at best.
- **External code needs consent.** A page integration that fetches a script from a CDN with no
  `integrity` hash, or loads a remote frame as it starts, is not pinned code: Level 1.
- **A key the integration holds** is judged by where it is kept and who can use it. An Account that
  keeps the keys on the computer and signs there is Level 4; one that sends the key or the
  signing to a server is 1 or 2, whatever its source.

### What to look at, by type

| Type | Its operations | Its connections |
|---|---|---|
| `account` | Where the key lives and who can sign | What it reaches while it signs: a device, a server |
| `crypto`, `address-list` | Deriving and encoding: pure code | None of its own; the node it reads through is judged on its own |
| `payment` | Building the legs, and where funds are sent | The nodes and services that price and route; the address a swap pays to |
| `network-node` | Answering a chain or service | The servers it asks, and whether each answer is checked |
| `tunnel` | Carrying the traffic | The relays and directories; who sees the destination |
| `name-resolution`, `data-gathering` | Turning a name or record into bytes | Whether the bytes are checked against an address, and by whom |
| `web3-score`, `catalogue`, `search`, `link-scheme` | Pointers: judged with what they name | The service or feed they point at |
| `extension` | What it can do to every page | What it fetches, and whether its code is pinned |
| `library`, `standard` | Pure logic or a definition | None |
| `dashboard` | What the page shows and runs | What the page requests |

### Warnings, Security and marks

- **Warnings** are Attila's word that an integration is bad: `phishing`, `drainer`, `malware`, `web2`
  (it presents itself as Web3 and is not) or `other`, with a note a person can read. A warning is
  about the content whatever level it has, and Orivon shows it wherever the integration is shown.
  Use it for harm, never to say "low level".
- **Security** is `{ level, note? }` from 1 to 4. The scale's levels are provisional until the
  canonical page defines them, so Attila gives none yet.
- **Marks:** Attila publishes no `marks.json`, so every verdict is drawn with Orivon's own marks, and
  no evaluation sets `mark`. `examples/orivon-test-provider/marks.json` shows the file: one mark of
  the provider's own, restyling nothing. A label may never be or contain a word Orivon draws itself
  (`web2`, `web25`, `web3`, `web?`, `unprotected`, `warning`, `!`), also when spelt with look-alike letters or with a
  two-character pair that draws as one letter (`VVeb3`, `uueb3`, `\/\/eb3`, `Waming`); a restyle's label must be exactly its
  grade's word. `check` measures the ink against the plate in both themes, at the 13% and the 22% tint, and an icon path
  is at most 1024 characters as written back. Before republishing by hand, run `ORIVON_REPO=<Orivon checkout> npm test`.

### How to check an integration

1. **Identify it.** For an installed one, build the site and run `ids <static-dir> --integrations`;
   for a built-in, take the row's id. File the identifier it prints. A component that Orivon can also
   reach by its own file may be listed under that file's `sha256:` too.
2. **Read its declaration and its code.** The declaration says the type, what it uses and what it
   asks for; the code says what it does. Note every address it can reach and every script it can run.
3. **Run it** in a headless Orivon with the network recorded, and list every request it causes.
4. **Judge** by the levels above. Name in the summary why it is that level and not the next one up.
5. **Write it:** `new integration <slug> --id <identifier>`, fill it in, `check`, then `build`.

### Worked examples (binding)

- **Orivon's IPFS node** is 4: every block is checked against its CID, so a peer can slow it and
  never change what a site is. It is not private: peers see the address and the CIDs asked for.
- **The Ethereum light client** is 4: every read is proven against the chain's consensus. Its
  checkpoint comes from the release, or from two beacon servers only when that one is over 14 days
  old. The servers it asks see the address.
- **The public IPFS gateways** are 3: the blocks are checked, but loading depends on a few
  gateway servers, which also see the address and the CID.
- **The site's own server over HTTPS** is 1: what it sends is not checked against an address.
- **A Web2 search engine** is 1: every query goes to its servers and the pages that come back are
  its own. **Explore as a search engine** takes Explore's level.
- **mempool.space, THORNode and Boltz** as nodes are 3: they are public servers whose answers
  nothing here checks. **Chainlink prices**, read through the light client, are 3: the chain proves
  the feed's value, and the oracle network is still trusted for it.
- **uBlock Origin** is 3: open source and pinned, but it downloads filter lists from servers nothing
  checks and acts on every page.
- **A Nym tunnel and a user's own SOCKS5 proxy** are 3: both rely on parties the person does not
  run and nothing checks.
- **Pure local code with no connection**, such as an address list, an Account that signs on the
  computer or an embedded SQLite, is 4 with privacy.
- **A standard's row** (`builtin:std-<code>`) is 4 with privacy: a definition runs nothing and
  connects to nothing, and what answers the code is judged on its own row.
