# web3-score-manager: agent instructions

- Before adding or changing an evaluation in `provider/` (Orivon Attila), read
  `provider/README.md` and judge by its rules. Its level definitions and worked examples
  (FreeTube, The Lounge and Element at Level 3 because each relies on a server, WebTorrent at 4
  because trackers only find peers, ASGARDEX at 3, an auto-loaded embed at 2, no privacy for any connection that shows the user, consent or not) are binding: do not re-derive a level from the short labels.
- After any change to `provider/`: `node src/cli.ts check` and `npm test`.
- When the issue "Watched names serve builds Attila has not judged" is open, judge each listed
  build by `provider/README.md` section How to check a site, add its CID, then publish Attila again.
