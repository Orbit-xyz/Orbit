"use client";

import { useState, useEffect } from "react";

type CurrencyId = "usdc" | "xlm" | "eurc";

interface CurrencyRate {
  change24h: number;
  change24hPercent: number;
}

const CURRENCIES: { id: CurrencyId; label: string }[] = [
  { id: "usdc", label: "USDC" },
  { id: "xlm", label: "XLM" },
  { id: "eurc", label: "EURC" },
];

const EMPTY_RATE: CurrencyRate = { change24h: 0, change24hPercent: 0 };

function emptyRates(): Record<CurrencyId, CurrencyRate> {
  return { usdc: { ...EMPTY_RATE }, xlm: { ...EMPTY_RATE }, eurc: { ...EMPTY_RATE } };
}

export function CurrencyRateTicker() {
  const [rates, setRates] = useState<Record<CurrencyId, CurrencyRate>>(emptyRates);
  const [showPopover, setShowPopover] = useState(false);

  useEffect(() => {
    async function fetchRates() {
      try {
        const response = await fetch("/api/currency-rates", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          const next = emptyRates();
          // Accept either an array of { id, change24h, change24hPercent } or a map keyed by id.
          const entries: Array<[string, CurrencyRate]> = Array.isArray(data?.rates)
            ? data.rates.map((r: CurrencyRate & { id: string }) => [r.id, r])
            : Object.entries(data?.rates ?? {});
          for (const [id, rate] of entries) {
            if (id === "usdc" || id === "xlm" || id === "eurc") next[id] = rate;
          }
          setRates(next);
        }
      } catch (error) {
        console.error("Failed to fetch currency rates:", error);
        setRates(emptyRates());
      }
    }

    fetchRates();
    const interval = setInterval(fetchRates, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value}%`;

  return (
    <div className="relative flex items-center gap-2">
      {CURRENCIES.map((currency) => (
        <span key={currency.id} className="text-sm">
          {currency.label} {formatPercent(rates[currency.id].change24hPercent)}
        </span>
      ))}

      <button
        type="button"
        className="cursor-pointer text-sm"
        aria-expanded={showPopover}
        onClick={() => setShowPopover((open) => !open)}
      >
        Rates
      </button>

      {showPopover && (
        <div className="absolute right-0 top-full z-50 mt-2 rounded bg-white p-2 text-sm text-neutral-900 shadow">
          {CURRENCIES.map((currency) => {
            const rate = rates[currency.id];
            const upClass = rate.change24h >= 0 ? "text-green-500" : "text-red-500";
            return (
              <div key={currency.id} className="flex items-center justify-between gap-4">
                <span>{currency.label}</span>
                <span className={upClass}>{formatPercent(rate.change24hPercent)}</span>
              </div>
            );
          })}
          <p className="text-neutral-500">Last updated: {new Date().toLocaleTimeString()}</p>
        </div>
      )}
    </div>
  );
}
