# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/iqbalmaulana25/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/iqbalmaulana25/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar that reads the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) and ranks every protocol that records no token yet — all 40 on the house watchlist plus the early finds below its $50M floor — by an implied value: what a token would be worth if it were issued against the record in the snapshot. The price comes from the snapshot itself, never from a name list: each protocol is priced at the median market-cap-to-TVL multiple of the traded tokens in its own category (shrunk toward the global median where a category is thin), then scaled by its 7-day TVL momentum, by how long it has run with no token, and by the chains it serves. Protocols whose token already trades are never ranked; they are set apart in the dashboard as the comparables the model prices from. Every ranked protocol carries a seven-step farm plan generated from its own record — its category picks the playbook, its primary chain the gas costs, its TVL the position size, its age the qualifying window — with a stated cost and time for each step. The dashboard is a static page with no network: a sortable, filterable board, a detail view per protocol showing the model's working and the value's p25–p75 range, and the comparables view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`/input` is where the grader mounts the sealed snapshot; `--input` also accepts a directory holding `snapshot.json`, and `MAKEFUN_OUTPUT_DIR` stands in for `/output` outside the grader. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, and the same input always produces the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hhk4ynvx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
