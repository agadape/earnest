"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";

import { NetworkNotice, SetupNotice } from "@/components/campaign-list";
import { FaucetButton } from "@/components/faucet-button";
import { Button, Card, Notice } from "@/components/ui";
import { useConnectDialog } from "@/components/wallet-button";
import { useBalance, useNow, usePolled, useProgram } from "@/lib/chain";
import { MINT } from "@/lib/env";
import { formatDate, formatDuration, formatPercent, plural, usd } from "@/lib/format";
import {
  bond,
  type Campaign,
  campaignAddress,
  type CampaignTerms,
  createCampaignIx,
  fee,
  fetchConfig,
  MAX_TITLE_LENGTH,
  MAX_UPFRONT_BPS,
  MAX_URI_LENGTH,
  parseTokens,
  raised,
  streamTotal,
  upfront,
} from "@/lib/tanda-jadi";
import { useSend } from "@/lib/transactions";

// The program's limits (`constants.rs`).
const MAX_FUNDING_SECS = 90 * 86_400;
const MAX_BUILD_SECS = 365 * 86_400;
const MAX_SEATS = 0xffff_ffff;
const MAX_AMOUNT = 0xffff_ffff_ffff_ffffn;
const CENT = 10_000n;

const UNITS = { seconds: 1, minutes: 60, hours: 3_600, days: 86_400 };
type Unit = keyof typeof UNITS;

interface Draft {
  title: string;
  uri: string;
  price: string;
  seats: string;
  bonusSeats: string;
  bonus: string;
  fillAmount: string;
  fillUnit: Unit;
  buildAmount: string;
  buildUnit: Unit;
  upfront: string;
}

type Field =
  | "title"
  | "uri"
  | "price"
  | "seats"
  | "bonusSeats"
  | "bonus"
  | "fill"
  | "build"
  | "upfront";
type Terms = Omit<CampaignTerms, "id">;

const INITIAL: Draft = {
  title: "",
  uri: "",
  price: "10",
  seats: "50",
  bonusSeats: "20",
  bonus: "2.50",
  fillAmount: "7",
  fillUnit: "days",
  buildAmount: "14",
  buildUnit: "days",
  upfront: "20",
};

const bytes = (text: string) => new TextEncoder().encode(text).length;

function dollars(text: string): bigint | string {
  const amount = parseTokens(text);
  if (amount === null || amount <= 0n) return "Enter an amount above zero, like 10 or 2.50.";
  if (amount % CENT !== 0n) return "Use whole cents.";
  if (amount > MAX_AMOUNT) return "That is too large.";
  return amount;
}

function count(text: string): number | null {
  if (!/^\d{1,10}$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_SEATS ? value : null;
}

function seconds(amount: string, unit: Unit, max: number): number | string {
  const value = Number(amount.trim());
  if (amount.trim() === "" || !Number.isFinite(value) || value <= 0) {
    return "Enter a length of time above zero.";
  }
  const total = Math.round(value * UNITS[unit]);
  if (total < 1) return "That is shorter than one second.";
  if (total > max) return `At most ${max / 86_400} days.`;
  return total;
}

/** The same checks the program makes, so a bad form is caught before anything is signed. */
function validate(draft: Draft): { terms: Terms | null; errors: Partial<Record<Field, string>> } {
  const errors: Partial<Record<Field, string>> = {};

  const title = draft.title.trim();
  if (!title) {
    errors.title = "Give it a name.";
  } else if (bytes(title) > MAX_TITLE_LENGTH) {
    errors.title = `Keep it within ${MAX_TITLE_LENGTH} characters.`;
  }

  const uri = draft.uri.trim();
  if (uri && !/^https?:\/\/\S+$/i.test(uri)) {
    errors.uri = "Start the link with https://";
  } else if (bytes(uri) > MAX_URI_LENGTH) {
    errors.uri = `Keep it within ${MAX_URI_LENGTH} characters.`;
  }

  const price = dollars(draft.price);
  if (typeof price === "string") errors.price = price;

  const seats = count(draft.seats);
  if (seats === null) errors.seats = "Enter a whole number of at least 1.";

  const bonusSeats = count(draft.bonusSeats);
  if (bonusSeats === null) {
    errors.bonusSeats = "At least 1 seat has to carry a bonus.";
  } else if (seats !== null && bonusSeats > seats) {
    errors.bonusSeats = "No more than the number of seats.";
  }

  const bonus = dollars(draft.bonus);
  if (typeof bonus === "string") errors.bonus = bonus;

  const fundingSecs = seconds(draft.fillAmount, draft.fillUnit, MAX_FUNDING_SECS);
  if (typeof fundingSecs === "string") errors.fill = fundingSecs;

  const buildSecs = seconds(draft.buildAmount, draft.buildUnit, MAX_BUILD_SECS);
  if (typeof buildSecs === "string") errors.build = buildSecs;

  const upfrontPercent = Number(draft.upfront.trim());
  const upfrontBps = Math.round(upfrontPercent * 100);
  if (!/^\d+(\.\d{0,2})?$/.test(draft.upfront.trim()) || upfrontBps > MAX_UPFRONT_BPS) {
    errors.upfront = `Between 0 and ${MAX_UPFRONT_BPS / 100}.`;
  }

  if (typeof price === "bigint" && seats !== null && price * BigInt(seats) > MAX_AMOUNT) {
    errors.seats = "Price times seats is too large.";
  }
  if (typeof bonus === "bigint" && bonusSeats !== null && bonus * BigInt(bonusSeats) > MAX_AMOUNT) {
    errors.bonusSeats = "Bonus times bonus seats is too large.";
  }

  if (
    Object.keys(errors).length > 0 ||
    typeof price !== "bigint" ||
    typeof bonus !== "bigint" ||
    typeof fundingSecs !== "number" ||
    typeof buildSecs !== "number" ||
    seats === null ||
    bonusSeats === null
  ) {
    return { terms: null, errors };
  }
  return {
    terms: {
      title,
      uri,
      price,
      targetBackers: seats,
      earlySlots: bonusSeats,
      bonusPerEarly: bonus,
      fundingSecs,
      buildSecs,
      upfrontBps,
    },
    errors,
  };
}

/** The campaign as it would stand the moment its last seat is taken, to run the numbers on. */
function preview(terms: Terms, feeBps: number, mint: PublicKey): Campaign {
  return {
    address: PublicKey.default,
    creator: PublicKey.default,
    mint,
    id: 0n,
    title: terms.title,
    uri: terms.uri,
    price: terms.price,
    targetBackers: terms.targetBackers,
    earlySlots: terms.earlySlots,
    bonusPerEarly: terms.bonusPerEarly,
    deadline: 0,
    buildSecs: terms.buildSecs,
    upfrontBps: terms.upfrontBps,
    feeBps,
    status: "building",
    backers: terms.targetBackers,
    brakes: 0,
    fundedAt: 0,
    brakedAt: 0,
    refundPerBacker: 0n,
    creatorWithdrawn: 0n,
    feeCollected: false,
  };
}

/**
 * `onOpened` is told the new campaign's address instead of the page moving to it, and `onTitle`
 * hears the title as it is typed. The museum's design mode uses both.
 */
export function NewCampaignForm({
  onOpened,
  onTitle,
}: {
  onOpened?: (address: string) => void;
  onTitle?: (title: string) => void;
} = {}) {
  const router = useRouter();
  const program = useProgram();
  const { publicKey } = useWallet();
  const openConnect = useConnectDialog();
  const balance = useBalance();
  const now = useNow();
  const { send, busy } = useSend();

  const loadConfig = useCallback(() => fetchConfig(program), [program]);
  const { data: config, error: configError } = usePolled(MINT ? loadConfig : null);

  const [draft, setDraft] = useState(INITIAL);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const { terms, errors } = useMemo(() => validate(draft), [draft]);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "title") onTitle?.(value);
  };
  const touch = (field: Field) => () => setTouched((current) => ({ ...current, [field]: true }));
  const errorFor = (field: Field) => (attempted || touched[field] ? errors[field] : undefined);

  if (!MINT) return <SetupNotice />;
  if (config === undefined) {
    return configError ? (
      <NetworkNotice />
    ) : (
      <div aria-busy className="h-96 animate-pulse rounded-2xl border border-stone-200 bg-white" />
    );
  }
  if (config === null) {
    return (
      <Notice title="Campaigns cannot be opened on this network yet">
        <p>
          The program has not been set up here. Run <code className="font-mono">npm run setup</code>{" "}
          in the <code className="font-mono">app</code> folder.
        </p>
      </Notice>
    );
  }

  const mint = MINT;
  const numbers = terms && preview(terms, config.feeBps, mint);
  const locked = numbers ? bond(numbers) : null;
  const short = locked !== null && balance !== null && balance < locked;

  const submit = async () => {
    setAttempted(true);
    if (!terms || !publicKey || locked === null) return;
    const id = BigInt(Date.now());
    const opened = await send("create", {
      pending: `Locking ${usd(locked)} and opening your campaign`,
      done: "Your campaign is open.",
      build: async (creator) => [
        [await createCampaignIx(program, creator, mint, { ...terms, id })],
      ],
    });
    if (!opened) return;
    // This page stays alive in the background after leaving it, so the form is cleared by
    // hand: coming back should offer a new campaign, not the one that was just opened.
    setDraft(INITIAL);
    setTouched({});
    setAttempted(false);
    onTitle?.("");
    const address = campaignAddress(publicKey, id).toBase58();
    if (onOpened) onOpened(address);
    else router.push(`/campaign/${address}`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <Card>
        <form
          noValidate
          className="space-y-8"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset className="space-y-5">
            <legend className="text-base font-semibold">What you would build</legend>
            <TextField
              label="Title"
              value={draft.title}
              onChange={set("title")}
              onBlur={touch("title")}
              error={errorFor("title")}
              hint={`${bytes(draft.title.trim())} of ${MAX_TITLE_LENGTH} characters`}
              placeholder="A command-line tool that…"
            />
            <TextField
              label="Link"
              optional
              value={draft.uri}
              onChange={set("uri")}
              onBlur={touch("uri")}
              error={errorFor("uri")}
              hint="Where backers can read what they would get."
              placeholder="https://"
              inputMode="url"
            />
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="text-base font-semibold">The offer</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Price of a seat"
                prefix="$"
                value={draft.price}
                onChange={set("price")}
                onBlur={touch("price")}
                error={errorFor("price")}
                inputMode="decimal"
              />
              <TextField
                label="Seats"
                value={draft.seats}
                onChange={set("seats")}
                onBlur={touch("seats")}
                error={errorFor("seats")}
                hint="You build it only if every seat is taken."
                inputMode="numeric"
              />
            </div>
            <DurationField
              label="Time to fill the seats"
              amount={draft.fillAmount}
              unit={draft.fillUnit}
              onAmount={set("fillAmount")}
              onUnit={set("fillUnit")}
              onBlur={touch("fill")}
              error={errorFor("fill")}
              hint="The campaign closes early if the last seat is taken sooner. At most 90 days."
            />
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="text-base font-semibold">If too few people join</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Bonus seats"
                value={draft.bonusSeats}
                onChange={set("bonusSeats")}
                onBlur={touch("bonusSeats")}
                error={errorFor("bonusSeats")}
                hint="The first backers, who get a bonus if the campaign fails."
                inputMode="numeric"
              />
              <TextField
                label="Bonus per seat"
                prefix="$"
                value={draft.bonus}
                onChange={set("bonus")}
                onBlur={touch("bonus")}
                error={errorFor("bonus")}
                hint="Paid from your bond, on top of their deposit."
                inputMode="decimal"
              />
            </div>
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="text-base font-semibold">If the seats fill</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <DurationField
                label="Time to build"
                amount={draft.buildAmount}
                unit={draft.buildUnit}
                onAmount={set("buildAmount")}
                onUnit={set("buildUnit")}
                onBlur={touch("build")}
                error={errorFor("build")}
                hint="The money reaches you evenly over this time. At most 365 days."
              />
              <TextField
                label="Paid to you at the start"
                suffix="%"
                value={draft.upfront}
                onChange={set("upfront")}
                onBlur={touch("upfront")}
                error={errorFor("upfront")}
                hint={`Of the money raised. At most ${MAX_UPFRONT_BPS / 100}%.`}
                inputMode="decimal"
              />
            </div>
          </fieldset>

          {/* Lets the Enter key submit; the visible button sits next to the summary. */}
          <button type="submit" hidden />
        </form>
      </Card>

      <Card className="lg:sticky lg:top-24">
        <h2 className="text-base font-semibold">What you are committing to</h2>
        {numbers && terms && locked !== null ? (
          <div className="mt-4 space-y-4 text-sm leading-6 text-stone-700">
            <Commitment title={`You lock ${usd(locked)} now`}>
              Your bond: {plural(terms.earlySlots, "bonus seat")} × {usd(terms.bonusPerEarly)}. It
              stays in the vault until the campaign ends one way or the other.
            </Commitment>
            <Commitment
              title={
                terms.targetBackers === 1
                  ? "If the seat is not taken"
                  : `If the ${terms.targetBackers} seats don't fill`
              }
            >
              {now !== null && `By ${formatDate(now + terms.fundingSecs)}, if you open it now. `}
              Every deposit goes back to its backer.{" "}
              {terms.earlySlots === 1
                ? "The first backer"
                : `Each of the first ${terms.earlySlots} backers`}{" "}
              also gets {usd(terms.bonusPerEarly)} from your bond. That costs you{" "}
              <strong className="font-semibold">at most {usd(locked)}</strong>.
              Bonus seats nobody took cost you nothing: that part of the bond returns to you.
            </Commitment>
            <Commitment
              title={
                terms.targetBackers === 1
                  ? "If the seat is taken"
                  : `If all ${terms.targetBackers} seats fill`
              }
            >
              {usd(raised(numbers))} is raised.{" "}
              {upfront(numbers) > 0n && (
                <>
                  <strong className="font-semibold">{usd(upfront(numbers))}</strong> (
                  {formatPercent(terms.upfrontBps)}) is yours at once.{" "}
                </>
              )}
              <strong className="font-semibold">{usd(streamTotal(numbers))}</strong> reaches you
              evenly over the next {formatDuration(terms.buildSecs)}. {usd(fee(numbers))} (
              {formatPercent(config.feeBps)}) is the service fee. When the build time is over,
              your {usd(locked)} bond is yours again.
            </Commitment>
            <Commitment title="While you build">
              Each backer can pull a brake. If more than half do, the money not yet released and
              your bond go back to the backers.
            </Commitment>
            <p className="text-stone-500">None of this can be changed once the campaign is open.</p>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-stone-600">
            Fill in the form and this box spells out, in dollars, what you lock, what a failure
            costs you and what a success pays.
          </p>
        )}

        <div className="mt-6 border-t border-stone-200 pt-5">
          {!publicKey ? (
            <Button className="w-full" onClick={openConnect}>
              Connect a wallet to continue
            </Button>
          ) : short && locked !== null && balance !== null ? (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-stone-700">
                The bond is {usd(locked)}. This wallet holds {usd(balance)}.
              </p>
              <FaucetButton variant="primary" className="w-full" />
            </div>
          ) : (
            <Button
              className="w-full"
              busy={busy === "create"}
              disabled={locked !== null && balance === null}
              onClick={submit}
            >
              {locked !== null ? `Lock ${usd(locked)} and open the campaign` : "Open the campaign"}
            </Button>
          )}
          {attempted && !terms && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Some fields need another look.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function Commitment({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-stone-900">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

const INPUT =
  "h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400";
const inputBorder = (error?: string) =>
  error ? "border-red-400" : "border-stone-300 hover:border-stone-400";

function FieldFrame({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {optional && <span className="font-normal text-stone-500"> (optional)</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-note`} className="mt-1.5 text-sm text-red-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className="mt-1.5 text-sm text-stone-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  optional,
  prefix,
  suffix,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "url";
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} optional={optional} hint={hint} error={error}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-500">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT} ${inputBorder(error)} ${prefix ? "pl-7" : ""} ${suffix ? "pr-8" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-stone-500">
            {suffix}
          </span>
        )}
      </div>
    </FieldFrame>
  );
}

function DurationField({
  label,
  amount,
  unit,
  onAmount,
  onUnit,
  onBlur,
  error,
  hint,
}: {
  label: string;
  amount: string;
  unit: Unit;
  onAmount: (value: string) => void;
  onUnit: (value: string) => void;
  onBlur: () => void;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={amount}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          onChange={(event) => onAmount(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT} ${inputBorder(error)} max-w-28`}
        />
        <select
          aria-label={`${label}: unit`}
          value={unit}
          onChange={(event) => onUnit(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT} ${inputBorder(error)} max-w-36`}
        >
          {Object.keys(UNITS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </FieldFrame>
  );
}
