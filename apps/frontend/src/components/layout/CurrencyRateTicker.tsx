"use client";

import { useState, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { USDC, XLM, EURC } from "lucide-react";

const CURRENCIES = [
  { id: "usdc", label: "USDC", icon: USDC },
  { id: "xlm", label: "XLM", icon: XLM },
  { id: "eurc", label: "EURC", icon: EURC },
];

export function CurrencyRateTicker() {
  const [rates, setRates] = useState(
    CURRENCIES.map(() => ({ change24h: 0, change24hPercent: 0 }))
  );
  const [showPopover, setShowPopover] = useState(false);

  useEffect(() => {
    async function fetchRates() {
      try {
        const response = await fetch("/api/currency-rates", {
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json();
          setRates(data.rates || CURRENCIES.map(() => ({ change24h: 0, change24hPercent: 0 })));
        }
      } catch (error) {
        console.error("Failed to fetch currency rates:", error);
        setRates(CURRENCIES.map(() => ({ change24h: 0, change24hPercent: 0 })));
      }
    }

    fetchRates();
    const interval = setInterval(fetchRates, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative flex items-center gap-2">
      {CURRENCIES.map((currency) => {
        const rateData = rates.find((r) => r.id === currency.id) || { change24h: 0, change24hPercent: 0 };
        const isUp = rateData.change24h >= 0;

        return (
          <span key={currency.id} className="text-sm">
            {currency.icon} {currency.label} {rateData.change24hPercent >= 0 ? "+" : ""}{rateData.change24hPercent}%
          </span>
        );
      })}

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-pointer">💱 Rates</div>
        </TooltipTrigger>

        <TooltipContent
          className="bg-white rounded p-2 text-sm"
          open={showPopover}
          onOpenChange={setShowPopover}
        >
          {CURRENCIES.map((currency) => {
            const rateData = rates.find((r) => r.id === currency.id) || { change24h: 0, change24hPercent: 0 };
            const upClass = rateData.change24h >= 0 ? "text-green-500" : "text-red-500";
            return (
              <div key={currency.id} className="flex items-center justify-between">
                <span>{currency.label}</span>
                <span className={upClass}>
                  {rateData.change24hPercent >= 0 ? "+" : ""}{rateData.change24hPercent}%
                </span>
              </div>
            );
          })}

          {showPopover && <p className="text-neutral-500">Last updated: {new Date().toLocaleTimeString()}</p>}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}