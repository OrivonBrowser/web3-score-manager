# web3-score-manager: agent instructions

- Before adding or changing an evaluation in `provider/` (Orivon Attila), read
  `provider/README.md` and judge by its rules. Its level definitions and worked examples
  (FreeTube, The Lounge and Element at Level 4 under the exception, ASGARDEX at 3, an
  auto-loaded embed at 2) are binding: do not re-derive a level from the short labels.
- After any change to `provider/`: `node src/cli.ts check` and `npm test`.
