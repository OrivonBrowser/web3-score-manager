# web3-score-manager

A command-line tool for running a Web3 Score provider. You keep one JSON file per evaluation,
check them against the standard (`orivon-web3-score/1`), and compile them into a static site you
can upload to any static host or to IPFS. Orivon reads the result as a Web3 Score provider.

## Install and run

Requires Node 22.18 or newer. The tool is TypeScript that Node runs directly, so there is no build
step, and it runs from a checkout (Node does not strip types inside `node_modules`).

```
npm install
node src/cli.ts --help
```

`npm link` puts a `web3-score` command on your path that points at the checkout.

## Quickstart

```
web3-score init --name "My provider"            # provider/provider.json and provider/scores/
web3-score new website my-app --id sha256:<hash> # a template to fill in
web3-score check                                 # validate everything
web3-score build                                 # write dist/
web3-score serve                                 # build and serve on http://127.0.0.1:7860
```

Then open Orivon, go to Settings > Web3, and paste `http://127.0.0.1:7860/score` as the Web3 Score
provider.

Every command takes `--dir <path>` (default `./provider`) and `--help`.

| Command | What it does |
|---|---|
| `init --name "<name>" [--bucket-hex-chars 2] [--about <url>]` | Creates `provider.json` and `scores/`. Refuses to overwrite |
| `new <subject> <slug> [--id <identifier>]...` | Writes a template evaluation, for a `website`, `operation`, `connection` or `integration`. Without `--id` it holds a placeholder that fails `check` until you edit it |
| `new marks` | Writes a template `marks.json` that restyles no grade and adds one mark. Refuses to overwrite |
| `add <file.json> [--slug s] [--force]` | Validates a file and copies it to `scores/<subject>/<slug>.json` |
| `remove <slug-or-identifier>` | Deletes the evaluation with that slug, or the one listing that identifier |
| `list` | One line per evaluation: subject, slug, level, name, identifiers |
| `check` | Validates the provider and every evaluation. Exit code 1 and the error list on failure |
| `ids <static-dir> [--integrations]` | Prints the Orivon bundle hash of a built app, or with `--integrations` the identifier of each integration the app declares (see below) |
| `moved [--resolver https://{name}.limo/] [--dnslink-resolver <url>]` | Asks what each watched name serves now and lists every name whose build no evaluation judges. Exit code 1 when one moved, or when no name could be resolved |
| `build [--out dist]` | Validates, then writes the static site |
| `serve [--port 7860] [--host 127.0.0.1]` | Builds into a temporary directory and serves it, GET and HEAD only |

`build` replaces `--out` only when it is empty or holds a previous build (`score/provider.json`).
It refuses any other directory.

## Source layout

```
provider/
  provider.json
  scores/
    website/<slug>.json
    operation/<slug>.json
    connection/<slug>.json
    integration/<slug>.json
  marks.json                (optional)
```

`provider.json` is the standard's descriptor: `standard`, `name`, `bucketHexChars` (1 or 2) and an
optional `about` address.

An evaluation file is the standard's evaluation object with two differences: `id` is replaced by
`ids`, a list of 1 to 8 identifiers (one evaluation can cover both a bundle hash and a CID of the
same build), and `subject` is added and must equal the directory the file is in. The slug is the
file name, matching `^[a-z0-9][a-z0-9-]{0,63}$`.

```json
{
  "subject": "website",
  "ids": ["sha256:26054c511f3394b66c6a022a48d82e559d637ac4b111657482ec6b7a7447fbcf"],
  "name": "ASGARDEX",
  "version": "1.45.3",
  "evaluated": "2026-10-03",
  "trustlessity": { "level": 3, "privacy": false },
  "summary": "Open source, and runs only its own bundled code.",
  "operations": [{ "name": "Send", "trustlessity": { "level": 3 }, "note": "Signed locally." }],
  "connections": [{ "name": "Data APIs", "trustlessity": { "level": 1 }, "note": "Answers are not checked." }],
  "evidence": ["https://github.com/asgardex/asgardex-desktop"]
}
```

A website or integration evaluation may add `warnings` (1 to 8 entries, each a `kind` and an optional `note`),
a `security` level (1 to 4, with an optional `note`) and a `mark`, the id of one of the marks in `marks.json`.
Another subject refuses all three. An integration evaluation is on the website scale and lists no names, operations or
connections: it is judged as a whole.

A website evaluation may add `names`, 1 to 8 names that serve the judged build. It is published
with the entry. Orivon counts the judged level of a page whose content is one of `ids` when it is
shown at one of these names or at its own `ipfs://` address; at any other name it shows the level
it observed instead. A name is one of three forms: a lowercase ASCII host name (an ENS name or a
DNS host, as IDNA A-labels, at least two labels of `a-z`, `0-9` and `-`, none starting or ending
with `-`, a last label that is not all digits and is neither `localhost` nor `orivon`, at most 253 characters: `vitalik.eth`,
`docs.ipfs.tech`), `ipns://<base36 k51... key>`, or `ipns://<DNSLink host>`. A name is listed once
within an evaluation and may be listed by several. An evaluation holds at most 8 ids, so a later
build is judged in a new file that lists the same names, and the watch writes it that way
(`watch/merge.ts`: `<slug>-2.json`, then `-3`). A name that moves to new content loses its
evaluation until the new build is judged. `moved` lists those names: it takes the union of the ids of every evaluation that lists
a name, and asks for the name's root by form. An ENS name goes to the resolver template
(`https://{name}.limo/` by default) and its root is the first entry of the `X-Ipfs-Roots` header.
A DNS host or `ipns://<host>` name is read from its `_dnslink` TXT record through DNS over HTTPS
(`--dnslink-resolver`, or the `DNSLINK_RESOLVER` environment variable; Cloudflare's JSON endpoint
by default), and the record must be `dnslink=/ipfs/<cid>`. An `ipns://` key and a `/ipns/` record
are listed as unresolved. A `--resolver` other than the default is asked for every form. A name
that points at Swarm sends no root, so it is listed as unresolved and never opens the issue. The
repository's Watched names workflow runs it every day and keeps one issue open while any name has
moved. GitHub stops a scheduled workflow in a repository with no activity for 60 days.

Unknown fields are errors in source files, which catches typos. The built site contains only the
standard's fields, and `names` is one of them. Identifiers are canonicalised: `sha256:` is
lowercased, a `cid:` becomes a base32 CIDv1 (a CIDv0 is converted), and an identifier listed by
two evaluations is an error. `arw:`, `btmh:` and `btih:` are checked and never rewritten: they
must already be spelled as the table says; another case, length, padding or a second colon is an
error.

| Subject | Identifier types |
|---|---|
| `website` | `sha256:<64 hex>` (Orivon bundle hash), `cid:<CID>`, `arw:<43 base64url characters>` (Arweave transaction id), `btmh:1220<64 lowercase hex>` (torrent SHA-256 multihash), `btih:<40 lowercase hex>` (torrent SHA-1 info-hash) |
| `operation` | `caip10:<account>` |
| `connection` | `caip2:<chain>`, `origin:https://host[:port]` |

## The standard

A provider is an address `P` (for example `https://scores.example/score`). A client fetches two
kinds of JSON file under it:

- `P/provider.json`: name, `bucketHexChars`, optional `about`.
- `P/<subject>/<bucket>.json`: every evaluation whose identifier falls in the bucket. The bucket is
  the first `bucketHexChars` hex characters of the SHA-256 of the whole identifier string, prefix
  included. A missing bucket is a 404, which means "no score".

`build` writes only the bucket files that hold an entry. The authoritative wire format is
[web3-score-provider.md](https://github.com/OrivonBrowser/orivon-mvp/blob/main/docs/architecture/web3-score-provider.md).

## Marks

`marks.json` is optional. It is the standard's `marks` file: up to 16 marks, each with an `id`, a plain-text `label`, a
`tone`, light and dark `ink`, an optional one-path `icon` and `note`, and optionally the one grade (`web2`, `web25` or
`web3`) it restyles. `check` applies the rules Orivon reads the file with, and refuses what Orivon would leave unused: a
label with a control, bidirectional or zero-width character or a mix of Latin, Cyrillic and Greek letters, a word Orivon
draws itself (`web2`, `web25`, `web3`, `web?`, `unprotected`, `warning` and `!`, however it is spelt with look-alike letters; a mark that restyles a grade may carry that grade's own word), a second mark that restyles
the same grade, and ink that reads below 4.5:1 on its plate in either theme. It also refuses a field Orivon would
ignore, so a misspelt `restyles` is caught. An evaluation's `mark` must name a mark the file holds, and a file that
names a mark no evaluation uses is not an error. `build` writes the validated file as `score/marks.json`.

## Levels

The full meaning of each level is on the
[Web3 scores page](https://docs.orivonstack.com/docs/implementations/web3-score).

| Subject | Levels | Privacy allowed at | Summary |
|---|---|---|---|
| `website` | 1 to 4 | 4 | 1 standard site without DDOC; 2 supports DDOC; 3 open source and runs no external code without the user's willing, aware consent; 4 Level 4 operations and Level 2 connections, relying on no server, except optional parts the user knowingly starts |
| `operation` | 1 to 5 | 4 and 5 | 1 code unavailable or unverifiable; 2 code available and does what it promises; 3 relies only on trustless networks; 4 no untrusted party can act against the user; 5 immutable and completely trustless |
| `connection` | 1 to 3 | 3 | 1 relies on centralized parties; 2 received data can be verified; 3 completely decentralized |
| `integration` | 1 to 4 | 4 | The website scale for one integration (a node, a library, an extension, a wallet or search provider, a built-in): 1 part of what it runs or shows comes from outside what was pinned; 2 everything it runs is pinned, its source is not public; 3 open source, runs only what was pinned, relies on a server or on data nothing checks; 4 open source, trustless operations and checked connections |

Privacy may be left out, meaning false. Operations and connections are listed inside a website
evaluation, and can also be published as their own subjects. An integration's level groups as a website's does:
1 is Web2, 2 and 3 are Web2.5 and 4 is Web3.

## Publishing

`build` writes a folder:

```
dist/
  index.html            human page: every evaluation, relative links only
  score/
    index.html
    provider.json
    website/<bucket>.json
```

Copy `dist/` to any static host. The provider address is the host's address followed by `/score`.

On IPFS:

```
ipfs add -r --cid-version=1 -Q dist
```

Use `ipfs://<cid>/score` as the provider address. An ENS name whose content hash is that CID gives
`name.eth/score`.

## Identifying a build

A website evaluation is attached to a content identity. For an app built for Orivon, `ids` takes
the bundle hash:

```
web3-score ids ../my-app/dist      # prints sha256:<hash> from .well-known/orivon-ddoc.json
```

The IPFS CID of the same files comes from `ipfs add -r -H --cid-version=1 -Q <dir>`. List both in
`ids` to cover a site reached by either route.

An integration is identified by what it is, not by the site that offers it:

| The integration | `ids` takes |
|---|---|
| Brings files and is installed with its site's bundle pinned | `integration:<64 hex>#<declaration id>`: the bundle hash without `sha256:`, and the id its declaration gives it |
| A library or an extension (one file) | `sha256:<64 hex>`: the hash its declaration names for the file |
| Only data (a score provider, a catalogue, a search, a link scheme) | `integration:decl:<64 hex>`: the SHA-256 of the declaration's canonical JSON (keys in UTF-16 order, no white space) |
| Shipped with Orivon | `integration:builtin:<name>`: the name of its row |

```
web3-score ids ../my-app/dist --integrations   # one identifier per integration in .well-known/orivon.json
```

The tool prints the first form that fits a declaration, in the order the table gives, from the bundle hash in
`.well-known/orivon-ddoc.json` and the declarations in `.well-known/orivon.json`.

## What a provider learns

A lookup never names the site: it reveals the bucket, one of 16 (`bucketHexChars` 1) or 256 (2),
which every site hashing there shares. The server also sees what any server sees of a request:
the address and the time.

Wider buckets are not allowed, and Orivon refuses a provider that declares one. The sites a client
asks about can be listed in advance (every `.eth` name's content hash is public), so with 4,096
buckets or more most buckets hold at most one known site, and the request would name it. Even at
256, a provider that scores only a few sites can guess which one a bucket means. At about 1 KB per
evaluation, 256 bucket files of 1 MiB hold about 250,000 evaluations.

## Orivon Attila

`provider/` in this repository is Orivon Attila, the provider Orivon runs: one evaluation for each
app from `orivon-ports` that is published on IPFS, one verdict for each integration Orivon ships, and one for each library
fixture Orivon's tests serve. Its address is
`ipns://k51qzi5uqu5dli7gc98gxy6jlbarijipfrw1x8z2wfyre3rvhssxvzeummkaff/score`. After a change,
Orivon's IPFS node pins the new build and moves that name to it, so the address stays the same.
How Attila judges a website or an integration, and the worked examples to follow, are in
[provider/README.md](provider/README.md): read it before adding or changing an evaluation.
The commands above read `provider/` by default. To run a provider of your own, pass `--dir` with
another directory.

A job on a server keeps Attila current as the watched sites change; see [watch/README.md](watch/README.md).

## Example provider

`examples/orivon-test-provider` holds two evaluations (ASGARDEX and The Lounge). `npm start`
serves it on port 7860, and `web3-score check --dir examples/orivon-test-provider` validates it.

After rebuilding a port, refresh its identifiers: run `web3-score ids <static-dir>` for the new
bundle hash and the `ipfs add` command above for the new CID, then replace the old values in the
evaluation's `ids`.

## Development

```
npm run typecheck
npm test
```

## License

AGPL-3.0-only. See `LICENSE`.
