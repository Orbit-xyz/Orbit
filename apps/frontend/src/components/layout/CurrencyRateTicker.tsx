"use client";

import { useState, useEffect } from "react";
import { Coins, CircleDollarSign, Landmark } from "lucide-react";

interface RateItem {
  id: string;
  change24h: number;
  change24hPercent: number;
}

const CURRENCIES = [
  { id: "usdc", label: "USDC", icon: CircleDollarSign },
  { id: "xlm", label: "XLM", icon: Coins },
  { id: "eurc", label: "EURC", icon: Landmark },
];

const EMPTY_RATE: CurrencyRate = { change24h: 0, change24hPercent: 0 };

function emptyRates(): Record<CurrencyId, CurrencyRate> {
  return { usdc: { ...EMPTY_RATE }, xlm: { ...EMPTY_RATE }, eurc: { ...EMPTY_RATE } };
}

export function CurrencyRateTicker() {
  const [rates, setRates] = useState<RateItem[]>(
    CURRENCIES.map((c) => ({ id: c.id, change24h: 0, change24hPercent: 0 }))
  );
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
      {CURRENCIES.map((currency) => {
        const Icon = currency.icon;
        const rateData = rates.find((r) => r.id === currency.id) || { id: currency.id, change24h: 0, change24hPercent: 0 };

        return (
          <span key={currency.id} className="text-xs flex items-center gap-1 font-mono text-neutral-600">
            <Icon size={12} /> {currency.label} {rateData.change24hPercent >= 0 ? "+" : ""}{rateData.change24hPercent}%
          </span>
        );
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowPopover(!showPopover)}
          className="text-xs cursor-pointer font-mono text-neutral-500 hover:text-black"
        >
          💱 Rates
        </button>

        {showPopover && (
          <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-lg border border-neutral-200 p-3 text-xs min-w-[140px] z-50">
            {CURRENCIES.map((currency) => {
              const rateData = rates.find((r) => r.id === currency.id) || { id: currency.id, change24h: 0, change24hPercent: 0 };
              const upClass = rateData.change24h >= 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold";
              return (
                <div key={currency.id} className="flex items-center justify-between py-1">
                  <span className="font-medium text-neutral-800">{currency.label}</span>
                  <span className={upClass}>
                    {rateData.change24hPercent >= 0 ? "+" : ""}{rateData.change24hPercent}%
                  </span>
                </div>
              );
            })}
            <p className="text-[10px] text-neutral-400 mt-2 border-t pt-1">
              Updated: {new Date().toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
