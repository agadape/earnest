"use client";

import { useMemo, useState } from "react";

import { Card, Tag } from "@/components/ui";
import { usePolled, useProgram } from "@/lib/chain";
import { formatDate, formatDuration, plural, usd } from "@/lib/format";
import { type Campaign, fetchMarket, type Market, type Sale } from "@/lib/tanda-jadi";

/** What this campaign's seats have sold for. `undefined` while loading, `null` if none sold. */
export function useMarket(campaign: Campaign): Market | null | undefined {
  const program = useProgram();
  const address = campaign.address.toBase58();
  const load = useMemo(
    () => () => fetchMarket(program, campaign.address),
    // The address as text: a new PublicKey object for the same campaign must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, address],
  );
  return usePolled(load).data;
}

/** A sale made while the campaign could still fail, of a seat that carries the bonus. */
export function isBonusSale(campaign: Campaign, sale: Sale): boolean {
  const stillFilling = campaign.fundedAt === 0 || sale.at < campaign.fundedAt;
  return stillFilling && sale.seat < campaign.earlySlots;
}

/**
 * The last price a seat actually sold for, with the recent sales as a small line and as a list.
 * Renders nothing until a seat has been sold.
 */
export function SeatTrades({
  campaign,
  market,
  now,
}: {
  campaign: Campaign;
  market: Market | null | undefined;
  now: number;
}) {
  if (!market || market.recent.length === 0) return null;
  const last = market.recent[market.recent.length - 1];
  const over = last.price - campaign.price;

  return (
    <div className="mt-5 rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-sm text-stone-500">Last sale</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight normal-nums">
            {usd(last.price)}
          </p>
          <p className="mt-1 text-sm text-stone-600">
            {over > 0n
              ? `${usd(over)} more than the ${usd(campaign.price)} a seat costs`
              : over < 0n
                ? `${usd(-over)} less than the ${usd(campaign.price)} a seat costs`
                : "exactly what a seat costs"}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Seat {last.seat + 1}, {formatDuration(Math.max(0, now - last.at))} ago ·{" "}
            {plural(market.sales, "sale")} so far
          </p>
        </div>
        <Sparkline campaign={campaign} sales={market.recent} />
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-stone-600 hover:text-stone-900">
          {market.recent.length === market.sales
            ? `All ${plural(market.sales, "sale")}`
            : `The latest ${market.recent.length} of ${market.sales} sales`}
        </summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-stone-500">
            <tr>
              <th className="py-1 pr-3 font-normal">When</th>
              <th className="py-1 pr-3 font-normal">Seat</th>
              <th className="py-1 text-right font-normal">Paid</th>
            </tr>
          </thead>
          <tbody>
            {[...market.recent].reverse().map((sale, index) => (
              <tr key={`${sale.at}:${sale.seat}:${index}`} className="border-t border-stone-200">
                <td className="py-1.5 pr-3 text-stone-600">{formatDate(sale.at)}</td>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    Seat {sale.seat + 1}
                    {isBonusSale(campaign, sale) && <Tag>Bonus seat</Tag>}
                  </span>
                </td>
                <td className="py-1.5 text-right font-medium">{usd(sale.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** The same record for a campaign that has ended, where seats no longer change hands. */
export function SeatTradesCard({ campaign, now }: { campaign: Campaign; now: number }) {
  const market = useMarket(campaign);
  if (!market || market.recent.length === 0) return null;
  return (
    <Card>
      <h2 className="text-xl font-semibold tracking-tight">Seats that changed hands</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        While this campaign was open, backers could sell their seats to others. This is what was
        actually paid.
      </p>
      <SeatTrades campaign={campaign} market={market} now={now} />
    </Card>
  );
}

// Chart ink: a step of the brand green with enough colour to stand apart from the gray rules.
const MARK = "#0a7f5a";
const RULE = "#e7e5e4";
const WIDTH = 248;
const HEIGHT = 76;
const GUTTER = 50; // room on the right for the two reference values
const PAD = 10;

/**
 * Recent sale prices, oldest to newest, against the two prices that give them meaning: what a
 * seat costs, and what a bonus seat pays back if the campaign does not fill.
 */
function Sparkline({ campaign, sales }: { campaign: Campaign; sales: Sale[] }) {
  const [active, setActive] = useState<number | null>(null);

  // The bonus line only means something while the campaign has not filled.
  const references = [
    { value: campaign.price, label: usd(campaign.price) },
    ...(campaign.fundedAt === 0
      ? [
          {
            value: campaign.price + campaign.bonusPerEarly,
            label: usd(campaign.price + campaign.bonusPerEarly),
          },
        ]
      : []),
  ];

  const values = [...sales.map((sale) => sale.price), ...references.map((r) => r.value)].map(Number);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const plotWidth = WIDTH - GUTTER - 2 * PAD;
  const y = (value: bigint) => PAD + (1 - (Number(value) - low) / span) * (HEIGHT - 2 * PAD);
  const x = (index: number) =>
    sales.length === 1 ? PAD + plotWidth : PAD + (index / (sales.length - 1)) * plotWidth;

  const points = sales.map((sale, index) => ({ sale, cx: x(index), cy: y(sale.price) }));
  const shown = active === null ? null : points[active];

  // Near either edge the tooltip leans inward, so it is never cut off by the card.
  const lean = shown ? shown.cx / (WIDTH - GUTTER) : 0.5;
  const shift = lean < 0.25 ? "-12%" : lean > 0.75 ? "-88%" : "-50%";

  return (
    <div className="shrink-0" style={{ width: WIDTH, maxWidth: "100%" }}>
      {/* Its own box, so the tooltip is placed against the plot and not the caption below it. */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`Prices of the last ${plural(sales.length, "sale")}, oldest to newest. The table below lists them.`}
        >
          {references.map((reference) => (
            <g key={reference.label}>
              <line
                x1={0}
                x2={WIDTH - GUTTER}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke={RULE}
                strokeWidth={1}
              />
              <text
                x={WIDTH}
                y={y(reference.value)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-stone-500 text-[10px] tabular-nums"
              >
                {reference.label}
              </text>
            </g>
          ))}
          {points.length > 1 && (
            <polyline
              points={points.map(({ cx, cy }) => `${cx},${cy}`).join(" ")}
              fill="none"
              stroke={MARK}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {points.map(({ sale, cx, cy }, index) => (
            <g key={`${sale.at}:${index}`}>
              <circle
                cx={cx}
                cy={cy}
                r={index === points.length - 1 || index === active ? 5 : 4}
                fill={MARK}
                stroke="#ffffff"
                strokeWidth={2}
              />
              {/* The hit target is far larger than the dot, and reachable by keyboard. */}
              <circle
                cx={cx}
                cy={cy}
                r={12}
                fill="transparent"
                tabIndex={0}
                aria-label={`Seat ${sale.seat + 1} sold for ${usd(sale.price)} on ${formatDate(sale.at)}`}
                className="cursor-default outline-none"
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            </g>
          ))}
        </svg>
        {shown && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${(shown.cx / WIDTH) * 100}%`,
              top: `${(shown.cy / HEIGHT) * 100}%`,
              transform: `translate(${shift}, calc(-100% - 10px))`,
            }}
          >
            <span className="block text-sm font-semibold text-stone-900">
              {usd(shown.sale.price)}
            </span>
            <span className="block text-stone-500">
              Seat {shown.sale.seat + 1} · {formatDate(shown.sale.at)}
            </span>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        Sale prices, oldest to newest.
        {campaign.fundedAt === 0
          ? ` Lines: what a seat costs, and what a bonus seat pays if this doesn't fill.`
          : " Line: what a seat costs."}
      </p>
    </div>
  );
}
