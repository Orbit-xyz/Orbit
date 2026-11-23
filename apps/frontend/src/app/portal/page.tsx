"use client";
import { useState } from "react";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { signMessage } from "@stellar/freighter-api";
import { ORBIT_API_URL } from "@/lib/api";
import { getWalletAdapter, type WalletProvider } from "@/lib/wallet-adapters";
import { DunningGraceBanner } from "@/components/dashboard/dunning-grace-banner";

type Sub = {
  id: string;
  next_billing_date: string;
  status?: string;
  past_due?: boolean;
  grace_period_expires_at?: string;
  plans?: {
    name?: string;
    usdc_amount?: string | number;
    interval_seconds?: string | number;
    merchants?: { name?: string; wallet_address?: string };
  };
};
type Receipt = { id:string;plan_name?:string;merchant_name?:string;created_at:string;tx_hash:string;transaction_url?:string };

export default function PortalPage() {
  const [provider,setProvider]=useState<WalletProvider>("freighter"), [wallet,setWallet]=useState(""), [token,setToken]=useState("");
  const [subs,setSubs]=useState<Sub[]>([]), [receipts,setReceipts]=useState<Receipt[]>([]), [tab,setTab]=useState<"subs"|"history">("subs");
  const [busy,setBusy]=useState(""), [error,setError]=useState(""), [editing,setEditing]=useState<Sub|null>(null), [amount,setAmount]=useState("");

  async function refresh(t=token) {
    const h={Authorization:"Bearer "+t};
    const [a,b]=await Promise.all([fetch(ORBIT_API_URL+"/customer-portal/subscriptions",{headers:h}),fetch(ORBIT_API_URL+"/customer-portal/receipts",{headers:h})]);
    if(!a.ok||!b.ok) throw new Error("Could not load portal data");
    setSubs((await a.json()).subscriptions||[]); setReceipts((await b.json()).receipts||[]);
  }
  async function connect() {
    setBusy("connect"); setError("");
    try {
      const adapter=getWalletAdapter(provider), address=await adapter.connect();
      if(provider!=="freighter") throw new Error("Portal login currently uses Freighter message authentication.");
      let r=await fetch(ORBIT_API_URL+"/customer-portal/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet_address:address})});
      const challenge=await r.json(); if(!r.ok) throw new Error(challenge.error||"Challenge failed");
      const signed=await signMessage(challenge.message,{address}); if(signed.error||!signed.signedMessage) throw new Error(signed.error?.message||"Signature rejected");
      const signature=typeof signed.signedMessage==="string"?signed.signedMessage:btoa(String.fromCharCode(...signed.signedMessage));
      r=await fetch(ORBIT_API_URL+"/customer-portal/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet_address:address,challenge_id:challenge.challenge_id,signature})});
      const session=await r.json(); if(!r.ok) throw new Error(session.error||"Authentication failed");
      setWallet(address); setToken(session.token); await refresh(session.token);
    } catch(e){setError(e instanceof Error?e.message:"Connection failed")} finally{setBusy("")}
  }
  async function prepared(path:string, body:object) {
    const r=await fetch(ORBIT_API_URL+path,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const p=await r.json(); if(!r.ok) throw new Error(p.error||"Could not prepare transaction");
    const signed=await getWalletAdapter(provider).signTransaction(p.transaction_xdr,{address:wallet,networkPassphrase:p.network_passphrase});
    const server=new rpc.Server(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL||"https://soroban-testnet.stellar.org");
    const sent=await server.sendTransaction(TransactionBuilder.fromXDR(signed,p.network_passphrase)); if(sent.status==="ERROR") throw new Error("Transaction rejected");
    for(let i=0;i<24;i++){await new Promise(x=>setTimeout(x,1000));const tx=await server.getTransaction(sent.hash);if(tx.status==="SUCCESS")return;if(tx.status==="FAILED")throw new Error("Transaction failed on-chain")}
    throw new Error("Submitted, but confirmation is still pending");
  }
  async function cancel(s:Sub){setBusy(s.id);setError("");try{await prepared("/customer-portal/cancel",{subscription_id:s.id});setSubs(x=>x.filter(y=>y.id!==s.id))}catch(e){setError(e instanceof Error?e.message:"Cancellation failed")}finally{setBusy("")}}
  async function modify(){if(!editing)return;setBusy("modify");setError("");try{await prepared("/customer-portal/modify",{subscription_id:editing.id,amount_usdc:amount});setEditing(null);setAmount("");await refresh()}catch(e){setError(e instanceof Error?e.message:"Update failed")}finally{setBusy("")}}
  async function retryPayment(s:Sub){setBusy(s.id);setError("");try{await prepared("/customer-portal/retry",{subscription_id:s.id});await refresh()}catch(e){setError(e instanceof Error?e.message:"Payment retry failed")}finally{setBusy("")}}

  const pastDueSubs = subs.filter(
    (s) => s.status === "past_due" || s.past_due || Boolean(s.grace_period_expires_at)
  );

  return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-black"><div className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-col gap-4 rounded-2xl border bg-white p-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Orbit customer portal</p><h1 className="text-2xl font-bold">Manage subscriptions</h1><p className="text-sm text-neutral-500">{wallet?wallet.slice(0,12)+"…"+wallet.slice(-8):"Connect your Stellar wallet."}</p></div>
      {!token&&<div className="flex gap-2"><select className="rounded-lg border px-3" value={provider} onChange={e=>setProvider(e.target.value as WalletProvider)}><option value="freighter">Freighter</option><option value="albedo">Albedo</option></select><button disabled={!!busy} onClick={connect} className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50">{busy?"Connecting…":"Connect wallet"}</button></div>}</header>
    {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {pastDueSubs.length > 0 && (
      <div className="space-y-3">
        {pastDueSubs.map((s) => (
          <DunningGraceBanner
            key={`dunning-${s.id}`}
            subscriptionId={s.id}
            planName={s.plans?.name}
            merchantName={s.plans?.merchants?.name}
            amountUsdc={s.plans?.usdc_amount}
            expiresAt={
              s.grace_period_expires_at ||
              new Date(Date.now() + 3 * 86400 * 1000).toISOString()
            }
            onRetry={() => retryPayment(s)}
          />
        ))}
      </div>
    )}
    {token&&<><nav className="flex gap-2"><button onClick={()=>setTab("subs")} className={"rounded-lg px-4 py-2 text-sm "+(tab==="subs"?"bg-black text-white":"border bg-white")}>Active subscriptions</button><button onClick={()=>setTab("history")} className={"rounded-lg px-4 py-2 text-sm "+(tab==="history"?"bg-black text-white":"border bg-white")}>Billing history</button></nav>
    {tab==="subs"?<section className="grid gap-4 md:grid-cols-2">{subs.map(s=><article key={s.id} className="rounded-xl border bg-white p-5"><p className="text-xs text-neutral-500">{s.plans?.merchants?.name||"Merchant"}</p><h2 className="text-lg font-semibold">{s.plans?.name||"Subscription"}</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><span className="text-neutral-500">Recurring cap</span><p>{String(s.plans?.usdc_amount??"—")} raw USDC</p></div><div><span className="text-neutral-500">Next pull</span><p>{new Date(s.next_billing_date).toLocaleDateString()}</p></div></div><div className="mt-5 flex gap-2"><button onClick={()=>{setEditing(s);setAmount("")}} className="rounded-lg border px-3 py-2 text-sm">Modify allowance</button><button disabled={busy===s.id} onClick={()=>cancel(s)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">{busy===s.id?"Confirming…":"Cancel subscription"}</button></div></article>)}{!subs.length&&<div className="rounded-xl border bg-white p-8 text-sm text-neutral-500">No active subscriptions.</div>}</section>:
    <section className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-neutral-50"><tr><th className="p-4">Merchant</th><th className="p-4">Plan</th><th className="p-4">Date</th><th className="p-4">Transaction</th></tr></thead><tbody>{receipts.map(r=><tr key={r.id} className="border-t"><td className="p-4">{r.merchant_name||"Merchant"}</td><td className="p-4">{r.plan_name||"Subscription"}</td><td className="p-4">{new Date(r.created_at).toLocaleDateString()}</td><td className="p-4">{r.transaction_url?<a className="underline" href={r.transaction_url} target="_blank" rel="noreferrer">{r.tx_hash.slice(0,10)}…</a>:r.tx_hash.slice(0,10)+"…"}</td></tr>)}</tbody></table></section>}</>}
    {editing&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-xl bg-white p-6"><h2 className="text-lg font-semibold">Modify allowance limit</h2><p className="text-sm text-neutral-500">The current billing interval is preserved.</p><input autoFocus value={amount} onChange={e=>setAmount(e.target.value)} placeholder="USDC amount" className="mt-4 w-full rounded-lg border px-3 py-2"/><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setEditing(null)} className="rounded-lg border px-3 py-2 text-sm">Close</button><button disabled={!amount||busy==="modify"} onClick={modify} className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50">{busy==="modify"?"Confirming…":"Sign update"}</button></div></div></div>}
  </div></main>
}
