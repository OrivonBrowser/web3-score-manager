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
| `new <subject> <slug> [--id <identifier>]...` | Writes a template evaluation. Without `--id` it holds a placeholder that fails `check` until you edit it |
| `add <file.json> [--slug s] [--force]` | Validates a file and copies it to `scores/<subject>/<slug>.json` |
| `remove <slug-or-identifier>` | Deletes the evaluation with that slug, or the one listing that identifier |
| `list` | One line per evaluation: subject, slug, level, name, identifiers |
| `check` | Validates the provider and every evaluation. Exit code 1 and the error list on failure |
| `ids <static-dir>` | Prints the Orivon bundle hash of a built app (see below) |
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

Unknown fields are errors in source files, which catches typos. The built site contains only the
standard's fields. Identifiers are canonicalised: `sha256:` is lowercased, a `cid:` becomes a
base32 CIDv1 (a CIDv0 is converted), and an identifier listed by two evaluations is an error.

| Subject | Identifier types |
|---|---|
| `website` | `sha256:<64 hex>` (Orivon bundle hash), `cid:<CID>` |
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

## Levels

The full meaning of each level is on the
[Web3 scores page](https://docs.orivonstack.com/docs/implementations/web3-score).

| Subject | Levels | Privacy allowed at | Summary |
|---|---|---|---|
| `website` | 1 to 4 | 4 | 1 standard site without DDOC; 2 supports DDOC; 3 open source and runs no external code without consent; 4 trustless in all operations and connections |
| `operation` | 1 to 5 | 4 and 5 | 1 code unavailable or unverifiable; 2 code available and does what it promises; 3 relies only on trustless networks; 4 no untrusted party can act against the user; 5 immutable and completely trustless |
| `connection` | 1 to 3 | 3 | 1 relies on centralized parties; 2 received data can be verified; 3 completely decentralized |

Privacy may be left out, meaning false. Operations and connections are listed inside a website
evaluation, and can also be published as their own subjects.

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
app from `orivon-ports` that is published on IPFS. Its address is
`ipns://k51qzi5uqu5dli7gc98gxy6jlbarijipfrw1x8z2wfyre3rvhssxvzeummkaff/score`. After a change,
Orivon's IPFS node pins the new build and moves that name to it, so the address stays the same.
How Attila judges a website, and the worked examples to follow, are in
[provider/README.md](provider/README.md): read it before adding or changing an evaluation.
The commands above read `provider/` by default. To run a provider of your own, pass `--dir` with
another directory.

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
