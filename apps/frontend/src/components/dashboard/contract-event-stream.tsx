"use client";

import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { Check, Copy, Radio, Search, Terminal, WifiOff } from "lucide-react";
import {
  filterContractEvents,
  normalizeContractEvent,
  type ContractEventFilters,
  type ContractEventRecord,
} from "@/lib/contract-events";

const CONTRACT_ID = process.env.NEXT_PUBLIC_ORBIT_CONTRACT_ID?.trim() ?? "";
const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const EVENTS_WS_URL = process.env.NEXT_PUBLIC_ORBIT_EVENTS_WS_URL?.trim() ?? "";
const MAX_EVENTS = 120;
const POLL_MS = 1500;

function decoded(value: unknown): unknown {
  try {
    const scVal = typeof value === "string"
      ? xdr.ScVal.fromXDR(value, "base64")
      : (value as xdr.ScVal);
    return scValToNative(scVal);
  } catch {
    return value;
  }
}

function asXdr(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return (value as xdr.ScVal).toXDR("base64");
  } catch {
    return "";
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function mapRpcEvent(value: unknown): ContractEventRecord | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const rawTopics = Array.isArray(event.topic) ? event.topic : [];
  const topics = rawTopics.map(decoded);
  const name = String(topics[0] ?? event.event_name ?? "");
  const ledger = Number(event.ledger ?? event.ledger_sequence);
  const id = String(event.id ?? "");
  if (!name || !id || !Number.isSafeInteger(ledger) || ledger < 1) return null;
  if (event.inSuccessfulContractCall === false) return null;
  return normalizeContractEvent({
    id,
    name,
    ledger,
    txHash: String(event.txHash ?? event.transaction_hash ?? ""),
    topics,
    value: decoded(event.value),
    rawXdr: asXdr(event.value),
  });
}

function highlightedJson(json: string) {
  // React text nodes escape untrusted values automatically; never use raw HTML.
  const regex = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of json.matchAll(regex)) {
    const index = match.index ?? last;
    if (index > last) parts.push(json.slice(last, index));
    const token = match[0];
    const css = token.startsWith('"')
      ? (json.slice(index + token.length).trimStart().startsWith(":")
        ? "text-sky-300" : "text-emerald-300")
      : token === "true" || token === "false" || token === "null"
        ? "text-amber-300" : "text-violet-300";
    parts.push(<span key={index} className={css}>{token}</span>);
    last = index + token.length;
  }
  if (last < json.length) parts.push(json.slice(last));
  return parts;
}

const EventCard = memo(function EventCard({
  event,
  onInspect,
}: {
  event: ContractEventRecord;
  onInspect: (event: ContractEventRecord) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInspect(event)}
      className="w-full rounded-lg border border-neutral-800 bg-neutral-900/80 p-3 text-left hover:border-neutral-600 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-sky-300">{event.kind} <span className="text-neutral-500">({event.name})</span></span>
        <span className="rounded border border-emerald-900 bg-emerald-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">{event.status}</span>
      </div>
      <div className="mt-2 grid gap-1 font-mono text-[11px] text-neutral-400 sm:grid-cols-2">
        <span>Ledger #{event.ledger}</span>
        <span>Amount: {event.amount || "—"}</span>
        <span className="truncate" title={event.user}>User: {event.user || "—"}</span>
        <span className="truncate" title={event.merchant}>Merchant: {event.merchant || "—"}</span>
      </div>
    </button>
  );
});

export function ContractEventStream() {
  const [events, setEvents] = useState<ContractEventRecord[]>([]);
  const [filters, setFilters] = useState<ContractEventFilters>({
    type: "all", status: "all", wallet: "",
  });
  const [connection, setConnection] = useState<"unconfigured" | "connecting" | "websocket" | "polling" | "error">(
    CONTRACT_ID ? "connecting" : "unconfigured",
  );
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ContractEventRecord | null>(null);
  const [copied, setCopied] = useState<"json" | "xdr" | null>(null);
  const visible = useMemo(() => filterContractEvents(events, filters), [events, filters]);

  useEffect(() => {
    if (!CONTRACT_ID) return;
    let active = true;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextLedger = 0;
    let busy = false;
    const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

    const receive = (event: ContractEventRecord) => {
      if (!active) return;
      setEvents((previous) => {
        if (previous.some((item) => item.id === event.id)) return previous;
        return [event, ...previous].slice(0, MAX_EVENTS);
      });
    };

    const poll = async () => {
      if (!active || busy) return;
      busy = true;
      try {
        const latest = await server.getLatestLedger();
        if (!nextLedger) nextLedger = Math.max(1, latest.sequence - 20);
        if (nextLedger <= latest.sequence) {
          const filters = [{ type: "contract" as const, contractIds: [CONTRACT_ID] }];
          let request: Parameters<typeof server.getEvents>[0] = {
            startLedger: nextLedger, filters, limit: 100,
          };
          let exhausted = false;
          for (let page = 0; page < 10; page += 1) {
            const response = await server.getEvents(request);
            response.events.forEach((event) => {
              const record = mapRpcEvent(event);
              if (record) receive(record);
            });
            if (response.events.length < 100 || !response.cursor) {
              exhausted = true;
              break;
            }
            request = { cursor: response.cursor, filters, limit: 100 };
          }
          // Never advance the watermark on incomplete pagination: retry from
          // the same ledger and de-duplicate instead of silently losing events.
          if (exhausted) nextLedger = latest.sequence + 1;
          else throw new Error("Ledger event pagination exceeds the safety limit.");
        }
        if (active) {
          setError("");
          setConnection((current) => current === "websocket" ? current : "polling");
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Soroban RPC unavailable");
          setConnection((current) => current === "websocket" ? current : "error");
        }
      } finally {
        busy = false;
        if (active) timer = setTimeout(poll, POLL_MS);
      }
    };

    // Optional provider WebSocket for push latency. The official Soroban RPC
    // supports getEvents over HTTP; polling remains active as a reconciliation
    // fallback even when a compatible WebSocket is connected.
    if (EVENTS_WS_URL) {
      try {
        socket = new WebSocket(EVENTS_WS_URL);
        socket.onopen = () => {
          socket?.send(JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "stellar_subscribe",
            params: ["events", { type: "contract", contractIds: [CONTRACT_ID] }],
          }));
        };
        socket.onmessage = (message) => {
          try {
            const packet = JSON.parse(String(message.data)) as Record<string, unknown>;
            const params = packet.params as Record<string, unknown> | undefined;
            const result = params?.result ?? params?.data;
            const candidate = (result as Record<string, unknown> | undefined)?.event ?? result;
            const entry = mapRpcEvent(candidate);
            if (entry) {
              receive(entry);
              setConnection("websocket");
            }
          } catch { /* malformed provider notifications are ignored */ }
        };
        socket.onerror = () => setConnection((state) => state === "websocket" ? "polling" : state);
        socket.onclose = () => setConnection((state) => state === "websocket" ? "polling" : state);
      } catch { /* HTTP reconciliation still works without provider WebSocket */ }
    }
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  const copy = async (value: string, type: "json" | "xdr") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-neutral-800 bg-[#09090b] p-5 text-neutral-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal size={18} className="text-sky-400" />
          <div>
            <h3 className="font-bold text-sm">Contract event stream &amp; ledger inspector</h3>
            <p className="text-[11px] text-neutral-400">Finalized Soroban contract events · raw XDR and decoded JSON</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded border border-neutral-700 px-2.5 py-1 font-mono text-[11px] text-neutral-300">
          {connection === "error" || connection === "unconfigured" ? <WifiOff size={13} /> : <Radio size={13} className="text-emerald-400" />}
          {connection === "websocket" ? "WebSocket live" : connection === "polling" ? "RPC polling · 1.5s" : connection}
        </span>
      </div>
      {!CONTRACT_ID && <p className="text-xs text-amber-300">Set NEXT_PUBLIC_ORBIT_CONTRACT_ID to inspect your deployed contract.</p>}
      {error && <p role="status" className="text-xs text-amber-300">RPC: {error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs text-neutral-400">Event
          <select value={filters.type} onChange={(e) => setFilters((v) => ({ ...v, type: e.target.value as ContractEventFilters["type"] }))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-100">
            <option value="all">All events</option><option value="create_vault">Create vault</option>
            <option value="pull_funds">Pull funds</option><option value="cancel_vault">Cancel vault</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs text-neutral-400">Status
          <select value={filters.status} onChange={(e) => setFilters((v) => ({ ...v, status: e.target.value as ContractEventFilters["status"] }))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-100">
            <option value="all">All</option><option value="SUCCESS">SUCCESS</option><option value="FAILED">FAILED</option>
          </select>
        </label>
        <label className="text-xs text-neutral-400">Wallet / transaction
          <span className="mt-1 flex items-center gap-2 rounded border border-neutral-700 bg-neutral-900 p-2">
            <Search size={14} /><input value={filters.wallet} onChange={(e) => setFilters((v) => ({ ...v, wallet: e.target.value }))} placeholder="G... or transaction hash" className="w-full min-w-0 bg-transparent text-xs text-neutral-100 outline-none" />
          </span>
        </label>
      </div>
      <p className="text-[11px] text-neutral-500">Contract events reflect successful on-chain emissions. Failed transactions do not emit finalized contract events; use transaction diagnostics for failures. Times depend on RPC/provider delivery.</p>
      <div className="max-h-[400px] space-y-2 overflow-y-auto" aria-live="polite">
        {visible.length
          ? visible.map((event) => <EventCard key={event.id} event={event} onInspect={setSelected} />)
          : <div className="rounded border border-neutral-800 p-6 text-center font-mono text-xs text-neutral-500">{events.length ? "No events match the filters." : "Waiting for finalized contract events…"}</div>}
      </div>

      {selected && (
        <div role="dialog" aria-modal="true" aria-label="Raw contract event inspector" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-neutral-700 bg-[#09090b] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0"><h4 className="font-bold">Ledger #{selected.ledger} · {selected.name}</h4><p className="truncate font-mono text-[11px] text-neutral-500">{selected.txHash || selected.id}</p></div>
              <button type="button" onClick={() => { setSelected(null); setCopied(null); }} className="rounded border border-neutral-600 px-3 py-1.5 text-xs">Close</button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-2 text-xs"><strong>Decoded JSON</strong><button type="button" onClick={() => void copy(safeJson(selected), "json")} className="inline-flex items-center gap-1 text-sky-300">{copied === "json" ? <Check size={13} /> : <Copy size={13} />}Copy JSON</button></div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-black p-3 font-mono text-[11px] leading-relaxed text-neutral-300"><code>{highlightedJson(safeJson({ name: selected.name, topics: selected.topics, value: selected.value, ledger: selected.ledger, txHash: selected.txHash, status: selected.status }))}</code></pre>
              <div className="flex justify-between gap-2 text-xs"><strong>Raw event value XDR (base64)</strong><button type="button" onClick={() => void copy(selected.rawXdr, "xdr")} disabled={!selected.rawXdr} className="inline-flex items-center gap-1 text-sky-300 disabled:opacity-50">{copied === "xdr" ? <Check size={13} /> : <Copy size={13} />}Copy XDR</button></div>
              <pre className="max-h-36 overflow-auto break-all whitespace-pre-wrap rounded-lg border border-neutral-800 bg-black p-3 font-mono text-[11px] text-emerald-300">{selected.rawXdr || "Raw value XDR not supplied by the connected provider."}</pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
