# Earnest

Pre-orders that pay the buyer back **with a bonus** when too few people join.

*Earnest money* is the small deposit you put down to show you are serious about buying
something. The Indonesian for it is *tanda jadi*, the name this project started under and the
one its program and code still carry.

The front page is a museum of things that almost existed: every campaign is an exhibit in a
small building you can walk through, and opening one shows the campaign beside the floor.
The same campaigns are listed at `/catalog`. How the museum is built is in
[docs/museum.md](docs/museum.md).

## The idea in one story

Budi wants to build a tool for developers. It will take him two weeks and he does not know
whether anyone would pay for it. He opens a campaign: *"I build this if 50 people put down $10
within 7 days."* He locks a $50 bond.

Rina sees it on day one. Normally she would wait and see. This time she joins, because both
outcomes are fine for her:

- **Enough people join.** Budi gets $100 at once and the rest over the two weeks he spends
  building. If he goes quiet, a majority of backers can pull the brake and take back what has not
  been released yet, plus his bond.
- **Too few people join.** Rina gets her $10 back plus $2.50 from Budi's bond, because she was
  among the first 20. Budi loses $50 instead of two weeks of work on something nobody wanted.

The mechanism is a *dominant assurance contract* (Tabarrok, 1998). In a lab study, paying a bonus
when a campaign fails raised the share of campaigns that succeed by 50% or more, and paying it
only to early backers worked as well for less money (Cason, Tabarrok, Zubrickas, *Games and
Economic Behavior*, 2021). It has rarely been used in practice. One reason is that failing is
expensive on card rails: the processing fee is kept when a payment is refunded. On Solana,
returning 30 pledges costs a fraction of a cent, so the mechanism also works for $5 pledges.

## How the money moves

All amounts sit in a vault that only the program can move. Nobody, including us, has a key to it.

| Outcome | Who gets what |
|---|---|
| Deadline passes below target | Every backer: their pledge. The first `early_slots` backers: plus `bonus_per_early` from the bond. Creator: the part of the bond that was not owed (bonus seats nobody took). No fee. |
| Target reached | Creator: `upfront_bps` of the raise at once, the rest linearly over `build_secs`, the bond at the end. Treasury: the fee (3%). |
| Majority brakes during the build | Backers: the unreleased part of the raise plus the bond, split equally and capped at what each paid. Creator: what was released up to that moment. |

Things worth knowing before changing the program:

- **Terms are fixed at creation.** There is no instruction to edit or cancel a campaign.
- **Nothing needs to be "settled".** Every instruction first applies what the clock implies
  (`Campaign::sync`), so the first refund after the deadline is also what marks the campaign failed.
- **Payouts are permissionless.** `claim_refund`, `withdraw` and `collect_fee` can be sent by
  anyone; the destination is checked against the backer, creator or treasury. A bot can return
  every pledge the moment a campaign fails.
- **The campaign closes when the last seat is taken**, and the build period starts in that
  transaction.
- **A pledge account that survives is a receipt**: proof that this wallet pre-ordered.
- **A seat can be sold while the outcome is open** (before the deadline, or during the
  build). The holder posts a price, a buyer pays it straight to them, and the seat moves
  with its place in the queue, so a bonus seat stays a bonus seat. The vault and the number
  of backers do not change. A brake does not travel with the seat.
- **The creator can post updates, and only the creator.** Each one is kept on chain with its
  time (`post_update`; the latest five, and a count of all). It moves no money and changes no
  rule. It is there so that backers deciding about the brake can see how long the creator has
  been silent, and so that there is a place to say where the finished thing is.

## Repository

```
programs/tanda-jadi/        Anchor program (Rust)
  src/state.rs              accounts and all the money rules, with unit tests
  src/instructions/         one file per instruction: checks, then a call into state.rs
  tests/lifecycle.rs        end-to-end tests against the compiled program (LiteSVM)
app/                        Next.js web app, TypeScript client and scripts
  src/lib/tanda-jadi/       client: addresses, account readers, instruction builders, money helpers
  src/lib/museum/           the museum's floor plan and the rule that hangs campaigns in rooms
  src/components/museum/    the three.js scene and the page laid over it
  scripts/                  setup, faucet and the scripted demo
scripts/                    build helpers
```

## Working on it

Toolchain: Rust, Solana CLI 3.1.10, Anchor 1.2.1 (`avm use 1.2.1`), Node 20+. On Windows this has
to live in WSL; see <https://solana.com/docs/intro/installation>.

```sh
make test          # build the program, then run unit and end-to-end tests
cd app && npm test # the museum's hanging rules
```

`make build` passes `--arch v0 --tools-version v1.52` to `anchor build`. Anchor 1.2 compiles to
SBPF v3 by default, which the test VM pinned by Anchor's own template (LiteSVM 0.10) does not
load. Devnet and mainnet accept both formats today. A feature gate that stops *new* v0 deployments
exists (SIMD-0500) and was inactive on both when this was written; if it activates, deploy a plain
`anchor build` instead.

After each build the IDL is copied into `app/src/lib/tanda-jadi/` and committed, so the web app
can be worked on without the Rust toolchain.

### Run everything locally

```sh
make localnet                  # terminal 1: local chain with the program loaded

cd app && npm install          # terminal 2
npm run setup                  # config + a demo token standing in for USDC, writes .env.local
npm run demo                   # two scripted campaigns: one fills and is braked, one fails
npm run dev                    # the web app on http://localhost:3000
npm run stage                  # three campaigns one step short of their ending, for a walkthrough
npm run showcase               # the same campaigns set to stay open for weeks, for visitors
npm run faucet -- <address>    # demo dollars for your own wallet
npm run keeper                 # optional: a bot that returns pledges and sends payouts by itself
```

To try the app without a wallet extension, add `NEXT_PUBLIC_DEMO_WALLET=1` to `app/.env.local`.
It offers a play-money wallet kept in the browser and a button that hands out demo dollars.

`npm run stage` is the quickest way to see everything from one browser. It opens three campaigns
and plays every backer but you: one where you take a bonus seat and the deadline passes about two
minutes later, one with a seat on offer and three sales already on record, and one that is a
seat short, where two backers pull the brake once the build is running and yours decides it.
Leave it running while you click through; it prints the three links.

The web app's server also returns money by itself: when it holds a key (`FAUCET_SECRET_KEY`, or
`app/.keys/faucet.json` in development), a campaign page asks it to send the refunds the moment
the campaign fails, and the creator's share once that is final. A daily cron (`app/vercel.json`,
`GET /api/settle` with `CRON_SECRET`) sweeps the campaigns nobody opened. Without a key the
pages show buttons instead, and `npm run keeper` does the same job from a terminal.

On Windows, run `make` inside WSL and the `npm` commands wherever Node is installed; the
validator in WSL is reachable from Windows on `127.0.0.1:8899`. If the repository sits on the
Windows drive (`/mnt/c/...`), keep build output on the Linux side or builds get slow:
`export CARGO_TARGET_DIR=~/target/tanda-jadi`.

### Devnet

A hosted copy of the web app runs against devnet at <https://inearnest.vercel.app>. It offers a
play-money wallet, so it can be tried without installing anything.
Every push to `main` redeploys it; the Vercel project builds from the `app/` folder.

The program is live on devnet at the address below, with its config initialized and a demo token
created. To point the scripts and the web app at it:

```sh
cd app
RPC_URL=https://api.devnet.solana.com npm run setup    # rewrites the RPC and token in .env.local
RPC_URL=https://api.devnet.solana.com npm run demo     # optional: the scripted demo, on devnet
npm run dev
```

The public devnet RPC node throttles quickly. The scripts wait and retry, but for a live demo put
an RPC provider's devnet URL in `NEXT_PUBLIC_RPC_URL`. Going back to a local validator is
`npm run setup` without `RPC_URL`.

### Program address

`EsMmNdHM99LX3c3yhec5AgdteXBPyCz5kN8St3ySddzv`, from `target/deploy/tanda_jadi-keypair.json`,
which is not in git. To deploy at this address you need that file from whoever generated it.
Otherwise run `anchor keys sync` to switch the code to a keypair of your own.

### What a seat's price says

A bonus seat pays `price + bonus` if the campaign fails and is worth `price` to someone who
wants the product. A holder who offers it for `price + x` is giving up a possible bonus for
`x` now, which makes sense if they think a failure is about `x / bonus` likely or less. So
the cheapest offer for a bonus seat is a rough, public reading of what its holder expects:
$11.50 on a $10 seat with a $2.50 bonus reads as "60% or lower". Once a campaign is full,
an offer above the price is a holder testing whether more people want in than there are
seats. Both are asking prices from single holders, not forecasts.

Every sale is also recorded on chain, per campaign: how many seats were sold, for how much
in total, and the latest sixteen sales with their price, seat and time. Only `buy_seat`
writes that record, so it holds what was actually paid and nothing else. The campaign page
shows the last price paid and a small line of the recent ones, and reads a sale the same way
as an offer, with one difference: a sale is a price a buyer and a seller both accepted.

### What a creator did before

Every campaign names the wallet that opened it, so a creator's history can be read straight
from the chain: how many campaigns they opened, how many ran to the end, how many did not fill
and what that cost them in bonuses, how many their backers stopped. The app shows it in one
line under a campaign's title and in full as a file inside the museum (`/creator/<address>`). A campaign that did not
fill counts for the creator here, not against them: they asked before building and paid what
they promised.

### Rooms and reactions

Whoever opened a campaign can build its exhibit a room of its own in the museum's annex: pick
a free plot and a floor, sign once. Anyone with a wallet can react to a campaign, and reactions
gather a crowd of figures round its exhibit. Neither touches the program or a database. Each is
a signed transaction carrying a memo, found again through one fixed address; see
`app/src/lib/ledger.ts` and `docs/museum.md` for the rules and their limits. A count of
reactions is a count of signed transactions, not of people.

    RPC_URL=https://api.devnet.solana.com npx tsx scripts/notes.ts     # read them, from app/

Reactions can be kept in Supabase instead, free to give and one of each kind per wallet: run
`supabase/reactions.sql` in the project's SQL editor and set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` for the app's server. The key must never get a `NEXT_PUBLIC_` name.
Rooms stay on chain.

## What this does not solve

Stated plainly, because a reader will find them anyway.

- **It is built for things a backer gets, not for things everyone gets.** A seat is a pre-order.
  If what is built is free for all once it exists, as open-source tools are, anyone can wait for
  others to fill the seats and use it anyway. The bonus for the earliest backers pulls against
  that but does not remove it. Several of the campaigns on devnet are open-source tools, which
  is the weakest fit; a seat should come with something only backers get.
- **The creator has to lock money before the first backer arrives.** The bond is small beside
  what is raised (the bonus for each early seat, times the early seats), and the creator sets
  it, but someone with nothing to lock cannot ask at all. Nobody else can post a bond for them.
- **Nothing curates what is opened.** Anyone with the bond can start a campaign for anything,
  and the museum will show it. The bond makes spam cost something and the record shows what a
  wallet did before; neither is moderation, and there is no way to take an exhibit down.
- **A creator can pledge to their own campaign.** Filling the gap to reach the target only costs
  them the fee, so the number of backers proves nothing to an outsider. Taking the bonus seats
  themselves makes their bond free again, but then real backers see that no bonus seat is left
  before they pledge, so nobody is misled about what they will get back.
- **A creator can take the upfront share and disappear.** The brake recovers the rest and the
  bond, not that share. It is capped at 30% by the program.
- **Backers can brake a campaign that was delivered.** It takes a majority, and what they can
  claw back shrinks every second, but for a digital product delivered early this is real.
- **A seat's price can be staged.** In a market this thin, whoever holds a seat can post any
  price. The only discipline is that an offer is firm: one that is too cheap gets bought.
  Nothing stops a creator from holding seats and posting prices that flatter the campaign.
- **A recorded sale can be staged too.** One person with two wallets can sell a seat to
  themselves at any price, and it costs them only network fees. The record proves a payment
  happened, not that two different people agreed on it.
- **An update is only the creator's word.** The chain proves who wrote it and when, not that
  it is true. A creator who posts "almost done" every day keeps the silence clock at zero.
- **A record can be shed.** A creator whose campaigns were stopped can open the next one from
  a new wallet. An empty record says nothing either way; only a good one says something.
- **A record can be made up of real campaigns.** A creator can back a small campaign of their
  own and let it run to the end. It costs them the fee, and it reads as "1 completed".
- **A creator can buy out a brake.** During the build they can buy seats from backers who
  pulled it, which releases those brakes. The sellers got the price they asked; the backers
  who stay have fewer allies.
- **Selling a bonus seat near the deadline is a bet on the campaign failing.** Whether that
  is treated as reselling a pre-order or as something regulated depends on the country.
  Nobody has given us a legal opinion.
- **The fee is taken when the target is reached**, also if the campaign is braked later.
- **`initialize_config` can be called by whoever gets there first** after a fresh deployment. Run
  it in the same breath as the deploy.
- **Whoever holds the program's upgrade authority can change all of the above.** That is the one
  place where users have to trust the team.
- **Not audited.** Demo token only; do not put real money through it.

## License

MIT. See [LICENSE](LICENSE).
