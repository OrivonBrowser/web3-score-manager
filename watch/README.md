# The Attila watch

A job that keeps Orivon Attila (`provider/`) in step with the sites it judges. Every three hours
it asks each watched `.eth` name what it serves now. When a name serves a build no evaluation
judges, the watch opens that build in a sandboxed browser, has a model read its files by the rules
in [provider/README.md](../provider/README.md), and either commits the new judgement or holds it
for the owner. Then it publishes Attila again and sends the owner a Telegram message for each site.

It runs on a Linux server under a systemd timer. `deploy/` holds the installer, the units and the
sign-in helper (see Install below).

## What one run does

1. Syncs a dedicated clone of this repository to `origin/main`.
2. Loads Attila and asks every watched name what it serves (`web3-score moved` does the same):
   the names that `moved` are the work. Names of one evaluation that moved to the same build are
   one job.
3. For each job, up to `MAX_SITES_PER_RUN`, skipping builds the state file says to skip:
   1. Asks the IPFS node for the build's size and refuses a build over `SITE_MAX_BYTES`.
   2. Fetches the new build, and the build the evaluation judged before, as the judge user.
   3. Computes facts in plain Node: the files added, removed and changed, the origins the files
      name, and the `<script>`, `<link>` and `<iframe>` tags that leave the origin (`facts.ts`).
   4. Opens the build in headless Chromium for 20 seconds with no network at all. Every request is
      answered from the build's own files or refused and recorded (`probe.ts`).
   5. Runs Claude Code on the inputs with a fixed prompt and a JSON schema (`judge/`).
   6. Validates the answer, merges it into the old evaluation, runs `check`, and decides
      (`verdict.ts`, `merge.ts`).
   7. Commits to `main`, or commits to a branch for the owner to review.
4. Builds Attila, adds it to IPFS and moves its IPNS name, once for the whole run.
5. Sends one Telegram message per judged site, and one per failure (the first time a build fails,
   and again when the watch gives up on it).

A judgement that passes goes to `main` with one commit per site. A judgement that rises in level,
gains the privacy mark, comes with a suspected injection, or sits at Level 3 or 4 while the build
loads third-party scripts or frames by itself is held: it goes to a branch named
`attila-watch/<name>-<build>`, the watch opens a pull request for it when it holds a GitHub token,
and the message links it. A build that does not
render is not judged; it is retried on later runs.

## Security model

The site is written by a stranger, so everything from it is treated as hostile data. The layers
are independent; each one holds if the others fail.

- **A separate unprivileged user.** The browser and the model run as the judge user, which has no
  access to the orchestrator's secrets (the GitHub token, the Telegram token and the Claude token
  in `/etc/attila-watch/secrets.env`), state or clone.
- **The srt sandbox.** Both run under `srt` (sandbox-runtime). The probe has no network at all.
  The judge reaches `api.anthropic.com` only, through a proxy that holds the OAuth token: the
  process sees a masked placeholder and never the real token. Both can write only to their job
  folder (`output`, `home`, `tmp`), and `/home`, `/root`, `/var/lib`, `/etc/ssh` and the other
  secret locations cannot be read. User namespaces are off, so Chromium runs with `--no-sandbox`
  inside the outer sandbox. srt runs without its seccomp socket filter (`allowAllUnixSockets`),
  because Ubuntu's AppArmor policy for bubblewrap forbids the nested namespace that filter needs;
  the sandbox has a network namespace of its own, so abstract sockets are out of reach, and `/run`
  and `/var/run`, where the host's socket files live, cannot be read.
- **Claude Code on a short leash.** `--restricted` with only `Read`, `Grep` and `Glob`, no MCP, no
  hooks, no slash commands, reads limited to the working directory, a turn cap and a timeout. The
  answer is structured output checked against `judge/schema.json`.
- **Only validated values in the prompt.** The prompt holds the `.eth` name, the CID and the date,
  each checked first. Site text reaches the judge as files it reads, never as prompt text.
- **A deterministic merge.** The watch, not the model, writes the evaluation: it keeps `ids`
  (at most eight, the new build last), `names` and `subject`, takes the judged fields, and refuses
  a scale violation (privacy only at website Level 4, operation 4 and 5, connection 3, evidence
  that is not an absolute http, https, ipfs or ipns address). `web3-score check` must pass on the
  result.
- **A secret scan.** The raw output is searched for the OAuth token, the Telegram token and the
  shapes of API keys, bot tokens, private keys and the sandbox's masked-token placeholder. A hit
  discards the answer and is reported without the match.
- **A human gate.** A level rise, the privacy mark gained, a suspected injection or third-party
  code under a Level 3 or 4 judgement is held for the owner. Only a judgement that keeps or lowers the
  level, with none of those signs, reaches `main` by itself.
- **Read with care.** `probe.json` is written by code that ran next to the site, so the watch reads
  it as a regular file only (a symlink is refused), caps its size and checks the few fields it
  acts on.

## Configuration

All settings are environment variables, read in `config.ts`.

| Variable | Default | Meaning |
|---|---|---|
| `REPO_DIR` | `/var/lib/attila-watch/repo` | The dedicated clone |
| `STATE_DIR` | `/var/lib/attila-watch` | `state.json`, `builds/`, the build output, the run lock |
| `JOBS_DIR` | `/var/attila-jobs` | One folder per judged site; the five newest are kept |
| `APP_DIR` | the directory that holds `watch/` | Where `watch/probe.ts` and `watch/judge/` are read from |
| `JUDGE_USER`, `JUDGE_GROUP` | `attila-judge`, the user's name | The unprivileged account, and the group of the job folders |
| `SRT_BIN`, `CLAUDE_BIN` | `watch/node_modules/.bin/srt`, `.../claude` | The sandbox and Claude Code |
| `NODE_BIN` | the running Node | Runs the probe and `check` |
| `IPFS_BIN` | `/usr/local/bin/ipfs` | The IPFS command line |
| `PLAYWRIGHT_BROWSERS_PATH` | `/opt/attila-watch/browsers` | Where the Chromium build is installed |
| `IPFS_API`, `IPFS_API_MULTIADDR` | `http://127.0.0.1:5001`, derived | The IPFS node's API |
| `GITHUB_REPO` | `OrivonBrowser/web3-score-manager` | Used for commit and pull request links |
| `GITHUB_TOKEN` | unset | Pushes over HTTPS and opens pull requests for held judgements; git reads it through a credential helper, never from an argument |
| `GIT_REMOTE` | `https://github.com/<GITHUB_REPO>.git` with a token, `git@github.com:<GITHUB_REPO>.git` without | Where the clone pushes |
| `DEPLOY_KEY` | unset | An SSH key for git instead of a token, used with `IdentitiesOnly` |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | `Attila watch`, `attila-watch@orivonstack.com` | Commit identity |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | unset | Without them messages are only logged as unsent |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Passed to the judge's sandbox, where it is masked |
| `RESOLVER` | `https://{name}.limo/` | How a name's build is read |
| `MODEL` | `claude-sonnet-5-5` | The judge's model |
| `MAX_TURNS`, `JUDGE_TIMEOUT_S` | `80`, `1500` | Limits on one judgement |
| `FETCH_TIMEOUT_S`, `PREVIOUS_FETCH_TIMEOUT_S`, `STAT_TIMEOUT_S`, `PROBE_TIMEOUT_S` | `900`, `180`, `120`, `120` | Limits on the other steps |
| `SITE_MAX_BYTES` | `314572800` | Largest build accepted |
| `MAX_SITES_PER_RUN` | `4` | Jobs per run |
| `MAX_ATTEMPTS` | `3` | Tries before a failing build is left alone |
| `KEEP_JOBS` | `5` | Job folders kept |
| `PUBLISH_DIR` | `/home/ubuntu/orivon-apps/web3-score-attila` | Where the built Attila is mirrored before `ipfs add` |
| `CID_FILE` | `<PUBLISH_DIR>.cid` | The CID of the last publication; the previous one is kept as `.bak-<date>` |
| `IPNS_KEY` | `web3-score` | The key that is moved to the new CID |
| `SUMMARY_FILE` | `/home/ubuntu/orivon-apps/SUMMARY.md` | The notes file: the CID is replaced in the Attila section and a log line is added |
| `ATTILA_WATCH_DRY_RUN` | unset | `1`: judge and send messages, but push nothing and publish nothing |
| `ATTILA_WATCH_ONLY` | unset | Comma-separated names; watch only these |

The job folder of a site (`JOBS_DIR`) must be writable by the orchestrator and by the judge user's
group, and its files are created group-writable. The orchestrator's account needs `sudo -n` rights
to run `ipfs get`, the probe and the judge as the judge user, and to delete what that user wrote.

## Install

On the server, from a checkout of this repository, as root:

```
sudo SERVICE_USER=<account> watch/deploy/install.sh
```

It needs Node 22.18 or newer at `/usr/local/bin/node`. It installs srt's dependencies (bubblewrap,
socat, ripgrep) and the libraries Chromium's headless shell links, creates the judge user, the
folders and `/etc/attila-watch/secrets.env`, copies `src/` and `watch/` to `/opt/attila-watch/app`
with their dependencies, installs Chromium's headless shell and the systemd service and timer
(`ENABLE_TIMER=0` installs the timer without starting it). Running it again updates the code.

Then fill in `secrets.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GITHUB_TOKEN`) and sign in
to Claude, in a terminal on the server:

```
/opt/attila-watch/bin/attila-watch-login
```

It runs `claude setup-token` for the owner's Claude subscription, checks the token with one
request and stores it as `CLAUDE_CODE_OAUTH_TOKEN`. The token lasts a year.

## Running it by hand

```
sudo systemctl start attila-watch.service
```

For a dry run, or to watch one name only, run the program directly as the service's account with the
service's environment:

```
ATTILA_WATCH_DRY_RUN=1 ATTILA_WATCH_ONLY=reality.eth node watch/run.ts
```

A dry run does everything except push, publish and save state, and puts "dry run" in its messages.
The exit code is 0 when the run completed, even if some sites failed, and 1 when it crashed.

## Where things live

- `STATE_DIR/state.json`: per name, the build, `applied`, `held`, `failed` or `rejected`, the
  attempts and the last error. A held build waits for the owner; a failed or rejected one is
  retried until it has used its attempts; a name whose build changes again starts over. A crash of
  the whole run is announced at most once a day.
- `STATE_DIR/builds/<cid>.json`: the file list and origins of every judged build, so the next build
  can be compared with it when the old one can no longer be fetched.
- `JOBS_DIR/<date>-<name>/`: `input/` (what the judge read: `site/`, `previous/`, `facts.md`,
  `probe.json`, `screenshot.png`, `rules.md`, `previous-evaluation.json`), `output/`, the two
  `srt-*.json` settings and `judge-result.json`.
- The log is on stdout, one timestamped line per event; systemd keeps it (`journalctl -u
  attila-watch`). Secrets and site text longer than 200 characters are not logged.

## Development

```
node --test          # the pure modules; nothing here loads Playwright or the network
npx tsc --noEmit -p watch
```

`watch/package.json` lists the runtime dependencies (Playwright, sandbox-runtime, Claude Code).
They are installed on the server only; the repository's own `npm install` does not need them.
`probe.ts` is the only module that imports Playwright, and the tests never load it.
