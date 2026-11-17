// FLOP devnet stability test: a few wallets, low-rate transfers, latency + error report.
// Devnet only. Wallet mnemonics are stored in plain text in devnet_wallets.json: never reuse them.
//
//   node devnet_test.mjs setup [n]           create n devnet wallets (default 5, max 10)
//   node devnet_test.mjs fund [k]            ask the faucet once per unfunded wallet (only the first k if given)
//   node devnet_test.mjs limits              show what the faucet has left today
//   node devnet_test.mjs spread [flop]       wallet 1 sends [flop] (default 1) to each empty wallet
//   node devnet_test.mjs agent-wallet [o] [a] wallet o creates an agent wallet for wallet a (default 1, 2)
//   node devnet_test.mjs miners              count entries in the chain's miner storage (registered miners...)
//   node devnet_test.mjs caps [miner]        sum all calibrated capacity, how it is spread (median, top 10, size groups);
//                                            your share and rank if you give your miner address
//   node devnet_test.mjs balances            show each wallet's balance and the node's health
//   node devnet_test.mjs run [min] [sec]     send a small transfer every [sec] (default 20) for [min] (default 30)
//   node devnet_test.mjs report              summarise results.csv
import fs from "node:fs";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, mnemonicGenerate } from "@polkadot/util-crypto";

const RPC = process.env.FLOP_RPC || "wss://rpc.devnet.flop.network";
const FAUCET = process.env.FLOP_FAUCET || "https://faucet.flop.network";
const WALLETS = "devnet_wallets.json";
const RESULTS = "results.csv";
const SS58 = 42;
const DECIMALS = 18n;
const AMOUNT = 10n ** (DECIMALS - 3n);           // 0.001 FLOP per transfer
const MAX_WALLETS = 10;
const FAUCET_GAP_MS = 30_000;                     // one faucet request every 30 s
const MIN_INTERVAL_S = 10;                        // never faster than one transfer every 10 s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const fmt = (raw) => (Number(raw) / 1e18).toFixed(4);

async function pairs() {
  if (!fs.existsSync(WALLETS)) throw new Error(`No ${WALLETS}. Run: node devnet_test.mjs setup`);
  await cryptoWaitReady();
  const kr = new Keyring({ type: "sr25519", ss58Format: SS58 });
  return JSON.parse(fs.readFileSync(WALLETS, "utf8")).map((w) => kr.addFromUri(w.mnemonic));
}

async function connect() {
  const t0 = now();
  const provider = new WsProvider(RPC);
  const api = await Promise.race([
    ApiPromise.create({ provider, noInitWarn: true }),
    sleep(30_000).then(() => { provider.disconnect(); throw new Error(`could not connect to ${RPC} within 30 s`); }),
  ]);
  const [chain, ver, health] = await Promise.all([
    api.rpc.system.chain(), api.rpc.state.getRuntimeVersion(), api.rpc.system.health()]);
  console.log(`connected to ${chain} (${RPC}) in ${now() - t0} ms; runtime ${ver.specName} ${ver.specVersion};`
    + ` peers ${health.peers}, syncing ${health.isSyncing}`);
  return api;
}

async function setup(n) {
  // keeps existing wallets and adds new ones until there are n in total (max 10)
  const existing = fs.existsSync(WALLETS) ? JSON.parse(fs.readFileSync(WALLETS, "utf8")) : [];
  n = Math.min(Math.max(1, n), MAX_WALLETS);
  if (existing.length >= n) {
    console.log(`${WALLETS} already has ${existing.length} wallets (asked for ${n}); nothing added.`);
    existing.forEach((w, i) => console.log(`  ${i + 1}. ${w.address}`));
    return;
  }
  await cryptoWaitReady();
  const kr = new Keyring({ type: "sr25519", ss58Format: SS58 });
  const added = Array.from({ length: n - existing.length }, () => {
    const mnemonic = mnemonicGenerate();
    return { address: kr.addFromUri(mnemonic).address, mnemonic };
  });
  const list = existing.concat(added);
  if (existing.length) fs.copyFileSync(WALLETS, WALLETS + ".bak");
  fs.writeFileSync(WALLETS, JSON.stringify(list, null, 2));
  console.log(`added ${added.length} wallets; ${WALLETS} now holds ${list.length} (mnemonics not printed):`);
  list.forEach((w, i) => console.log(`  ${i + 1}. ${w.address}`));
}

async function limits() {
  const res = await fetch(`${FAUCET}/limits`);
  console.log(`faucet /limits HTTP ${res.status}:`, await res.text());
}

async function spread(amountFlop) {
  // wallet 1 sends amountFlop to each other wallet that is empty, so only one faucet request is needed
  const ps = await pairs();
  const api = await connect();
  const amt = BigInt(Math.round(amountFlop * 1e6)) * 10n ** (DECIMALS - 6n);
  const { data } = await api.query.system.account(ps[0].address);
  console.log(`wallet 1 has ${fmt(data.free.toBigInt())} FLOP; sending ${amountFlop} FLOP to each empty wallet`);
  if (data.free.toBigInt() < amt * BigInt(ps.length)) {
    console.log("wallet 1 does not have enough FLOP yet. Run 'node devnet_test.mjs fund 1' first and check 'balances'.");
    await api.disconnect();
    return;
  }
  for (const [i, p] of ps.entries()) {
    if (i === 0) continue;
    const acc = await api.query.system.account(p.address);
    if (acc.data.free.toBigInt() > 0n) { console.log(`${i + 1}. already funded`); continue; }
    const r = await new Promise((resolve) => {
      api.tx.balances.transferKeepAlive(p.address, amt).signAndSend(ps[0], ({ status, dispatchError }) => {
        if (dispatchError) resolve(`failed: ${dispatchError.toString()}`);
        else if (status.isInBlock) resolve(`in block ${status.asInBlock.toHex().slice(0, 12)}...`);
        else if (status.isDropped || status.isInvalid) resolve(status.type);
      }).catch((e) => resolve(`rejected: ${e.message || e}`));
    });
    console.log(`${i + 1}. ${p.address} ${r}`);
  }
  await api.disconnect();
}

async function agentWallet(ownerIdx, agentIdx, dailyCap, txLimit) {
  // Owner wallet signs AgentWallet.createWallet(agent, perTxLimit, dailyCap, allowedDestinations)
  // exactly as the official CLI's "flop wallet agent create" does.
  const ps = await pairs();
  const owner = ps[ownerIdx - 1], agent = ps[agentIdx - 1];
  if (!owner || !agent) throw new Error(`wallets ${ownerIdx} and ${agentIdx} must exist (you have ${ps.length})`);
  const api = await connect();
  if (!api.tx.agentWallet?.createWallet) { console.log("this chain has no AgentWallet.createWallet call"); await api.disconnect(); return; }
  const existing = api.query.agentWallet?.wallets ? await api.query.agentWallet.wallets(agent.address) : null;
  if (existing && !existing.isEmpty && existing.toString() !== "null") {
    console.log(`agent wallet for ${agent.address} already exists:`, existing.toHuman ? JSON.stringify(existing.toHuman()) : existing.toString());
    await api.disconnect(); return;
  }
  const raw = (f) => BigInt(Math.round(f * 1e6)) * 10n ** (DECIMALS - 6n);
  console.log(`owner  wallet ${ownerIdx}: ${owner.address}\nagent  wallet ${agentIdx}: ${agent.address}\nlimits: ${txLimit} FLOP per tx, ${dailyCap} FLOP per day`);
  const r = await new Promise((resolve) => {
    api.tx.agentWallet.createWallet(agent.address, raw(txLimit), raw(dailyCap), [])
      .signAndSend(owner, ({ status, dispatchError }) => {
        if (dispatchError) {
          resolve("failed: " + (dispatchError.isModule
            ? (({ section, name }) => `${section}.${name}`)(api.registry.findMetaError(dispatchError.asModule))
            : dispatchError.toString()));
        } else if (status.isFinalized) resolve(`created, finalized in ${status.asFinalized.toHex()}`);
        else if (status.isDropped || status.isInvalid) resolve(status.type);
      }).catch((e) => resolve(`rejected: ${e.message || e}`));
  });
  console.log(r);
  if (api.query.agentWallet?.wallets) {
    const w = await api.query.agentWallet.wallets(agent.address);
    console.log("on chain:", w.toHuman ? JSON.stringify(w.toHuman()) : w.toString());
  }
  await api.disconnect();
}

async function miners() {
  // Counts entries in every map storage of the chain's miner pallets (registered miners, stakes,
  // calibrations...). Read-only.
  const api = await connect();
  const sections = Object.keys(api.query).filter((n) => /miner|calib/i.test(n));
  if (!sections.length) console.log("no miner pallets found; pallets:", Object.keys(api.query).join(", "));
  for (const sec of sections) {
    for (const [name, fn] of Object.entries(api.query[sec])) {
      if (!fn?.creator?.meta?.type?.isMap) continue;
      try {
        const keys = await Promise.race([fn.keys(), sleep(60_000).then(() => { throw new Error("timeout"); })]);
        console.log(`${sec}.${name}: ${keys.length}`);
      } catch (e) { console.log(`${sec}.${name}: ${e.message}`); }
    }
  }
  await api.disconnect();
}

async function caps(me) {
  // Reads every miner's calibration record and sums each numeric field, so one miner's share of the
  // network's calibrated capacity can be computed. Read-only.
  const api = await connect();
  const q = api.query.hwCalibration;
  if (!q) { console.log("no hwCalibration pallet"); await api.disconnect(); return; }
  for (const item of ["benchmarkBurstCaps", "lastInitialCalibration", "calibrationVersions"]) {
    if (!q[item]) continue;
    const entries = await q[item].entries();
    const sums = {}, mine = {};
    let sample = null;
    const vals = [];
    for (const [k, v] of entries) {
      const who = k.args[0]?.toString();
      const j = v.toJSON();
      sample ??= { who, j };
      const flat = {};
      const walk = (x, path) => {
        if (x !== null && typeof x === "object") { for (const [kk, vv] of Object.entries(x)) walk(vv, path ? `${path}.${kk}` : kk); }
        else if (typeof x === "number" || (typeof x === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(x))) flat[path || "value"] = Number(BigInt(x));
      };
      walk(j, "");
      for (const [f, n] of Object.entries(flat)) { sums[f] = (sums[f] || 0) + n; if (who === me) mine[f] = n; }
      vals.push({ who, flat });
    }
    console.log(`\n== hwCalibration.${item}: ${entries.length} miners; example ${JSON.stringify(sample?.j)}`);
    for (const [f, total] of Object.entries(sums)) {
      const line = `  ${f}: network total ${total}`;
      if (me && mine[f] !== undefined) {
        const rank = vals.filter((x) => (x.flat[f] ?? 0) > mine[f]).length + 1;
        console.log(`${line}; you ${mine[f]} = ${(100 * mine[f] / total).toFixed(3)}% (rank ${rank} of ${vals.length})`);
      } else console.log(line);
      if (item === "benchmarkBurstCaps" && f === "capGflopsPerSec") distribution(vals, f, total, me);
    }
  }
  await api.disconnect();
}

function distribution(vals, f, total, me) {
  // How the capacity is spread: a few big miners, or many small ones? Read-only, prints only.
  const xs = vals.map((v) => ({ who: v.who, n: v.flat[f] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (xs.length < 2) return;
  const at = (q) => xs[Math.min(xs.length - 1, Math.floor((1 - q) * (xs.length - 1)))].n;
  const pct = (n) => `${(100 * n / total).toFixed(2)}%`;
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const top = (k) => xs.slice(0, k).reduce((s, x) => s + x.n, 0);
  console.log(`     ${xs.length} miners with ${f} > 0; mean ${Math.round(total / xs.length)}, median ${at(0.5)}, ` +
              `p10 ${at(0.1)}, p90 ${at(0.9)}, max ${xs[0].n}`);
  console.log(`     top 1 holds ${pct(top(1))}, top 10 ${pct(top(10))}, top 50 ${pct(top(50))} of the total`);
  const edges = [0, 100, 200, 500, 1000, 2000, 5000, 10000, Infinity];
  const rows = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inb = xs.filter((x) => x.n >= edges[i] && x.n < edges[i + 1]);
    if (!inb.length) continue;
    const label = edges[i + 1] === Infinity ? `>= ${edges[i]}` : `${edges[i]}-${edges[i + 1] - 1}`;
    const sum = inb.reduce((s, x) => s + x.n, 0);
    rows.push(`       ${label.padEnd(12)} ${String(inb.length).padStart(4)} miners  ${pct(sum).padStart(7)} of total` +
              (me && inb.some((x) => x.who === me) ? "   <- you" : ""));
  }
  console.log("     by size:"); rows.forEach((r) => console.log(r));
  console.log("     top 10:");
  xs.slice(0, 10).forEach((x, i) => console.log(`       ${String(i + 1).padStart(2)}. ${short(x.who)}  ${String(x.n).padStart(8)}  ${pct(x.n).padStart(7)}` +
                                                 (x.who === me ? "   <- you" : "")));
}

async function fund(only) {
  const ps = (await pairs()).slice(0, only || undefined);
  const api = await connect();
  for (const [i, p] of ps.entries()) {
    const { data } = await api.query.system.account(p.address);
    if (data.free.toBigInt() > 0n) { console.log(`${i + 1}. ${p.address} already has ${fmt(data.free.toBigInt())} FLOP`); continue; }
    const res = await fetch(`${FAUCET}/fund`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: p.address }) });
    const body = await res.json().catch(() => ({}));
    console.log(`${i + 1}. ${p.address} faucet HTTP ${res.status}`, JSON.stringify(body));
    if (res.status === 429) { console.log("faucet rate limit reached: stopping. Try again later."); break; }
    if (i < ps.length - 1) await sleep(FAUCET_GAP_MS);
  }
  await api.disconnect();
}

async function balances() {
  const ps = await pairs();
  const api = await connect();
  for (const [i, p] of ps.entries()) {
    const { data, nonce } = await api.query.system.account(p.address);
    console.log(`${i + 1}. ${p.address}  ${fmt(data.free.toBigInt())} FLOP  nonce ${nonce}`);
  }
  await api.disconnect();
}

function send(api, from, to) {
  // resolves with timings; never rejects
  return new Promise((resolve) => {
    const r = { t: new Date().toISOString(), from: from.address, to: to.address, submit_ms: now(),
      inblock_ms: "", final_ms: "", block: "", status: "pending", error: "" };
    let unsub = null;
    const done = () => { if (unsub) unsub(); resolve(r); };
    const timer = setTimeout(() => { r.status = r.inblock_ms ? "not_finalized" : "timeout"; done(); }, 180_000);
    api.tx.balances.transferKeepAlive(to.address, AMOUNT)
      .signAndSend(from, ({ status, dispatchError }) => {
        if (dispatchError) {
          r.status = "failed";
          r.error = dispatchError.isModule
            ? (({ section, name }) => `${section}.${name}`)(api.registry.findMetaError(dispatchError.asModule))
            : dispatchError.toString();
        }
        if (status.isInBlock && !r.inblock_ms) { r.inblock_ms = now() - r.submit_ms; r.block = status.asInBlock.toHex(); }
        if (status.isFinalized) { r.final_ms = now() - r.submit_ms; if (r.status === "pending") r.status = "ok"; clearTimeout(timer); done(); }
        if (status.isDropped || status.isInvalid || status.isUsurped) { r.status = status.type; clearTimeout(timer); done(); }
      })
      .then((u) => { unsub = u; })
      .catch((e) => { r.status = "rejected"; r.error = String(e.message || e).slice(0, 200); clearTimeout(timer); done(); });
  });
}

async function run(minutes, intervalS) {
  intervalS = Math.max(MIN_INTERVAL_S, intervalS);
  const ps = await pairs();
  if (ps.length < 2) throw new Error("need at least 2 wallets");
  const api = await connect();
  if (!fs.existsSync(RESULTS)) fs.writeFileSync(RESULTS, "time,from,to,status,inblock_ms,final_ms,block,error\n");
  const end = now() + minutes * 60_000;
  const busy = new Set();
  const inflight = [];
  let i = 0, sent = 0;
  console.log(`sending 0.001 FLOP every ${intervalS}s for ${minutes} min; Ctrl+C to stop early`);
  while (now() < end) {
    const from = ps[i % ps.length], to = ps[(i + 1) % ps.length];
    i++;
    if (busy.has(from.address)) { await sleep(intervalS * 1000); continue; }   // one tx per sender at a time
    busy.add(from.address);
    sent++;
    const n = sent;
    inflight.push(send(api, from, to).then((r) => {
      busy.delete(from.address);
      fs.appendFileSync(RESULTS, [r.t, r.from, r.to, r.status, r.inblock_ms, r.final_ms, r.block, JSON.stringify(r.error)].join(",") + "\n");
      console.log(`#${n} ${r.status} inBlock ${r.inblock_ms || "-"} ms, finalized ${r.final_ms || "-"} ms ${r.error}`);
    }));
    await sleep(intervalS * 1000);
  }
  console.log("waiting for the last transfers to finish...");
  await Promise.all(inflight);
  await api.disconnect();
  report();
}

function report() {
  if (!fs.existsSync(RESULTS)) { console.log("no results yet"); return; }
  const rows = fs.readFileSync(RESULTS, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const by = {};
  rows.forEach((c) => { by[c[3]] = (by[c[3]] || 0) + 1; });
  const pct = (arr, p) => arr.length ? arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : "-";
  const inb = rows.map((c) => +c[4]).filter((x) => x > 0);
  const fin = rows.map((c) => +c[5]).filter((x) => x > 0);
  console.log(`transfers: ${rows.length}  by status: ${JSON.stringify(by)}`);
  console.log(`success rate: ${((by.ok || 0) / Math.max(1, rows.length) * 100).toFixed(1)}%`);
  console.log(`time to block:     p50 ${pct([...inb], 0.5)} ms, p95 ${pct([...inb], 0.95)} ms, max ${inb.length ? Math.max(...inb) : "-"} ms`);
  console.log(`time to finalized: p50 ${pct([...fin], 0.5)} ms, p95 ${pct([...fin], 0.95)} ms, max ${fin.length ? Math.max(...fin) : "-"} ms`);
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === "setup") await setup(parseInt(a || "5", 10));
  else if (cmd === "fund") await fund(parseInt(a || "0", 10));
  else if (cmd === "limits") await limits();
  else if (cmd === "miners") await miners();
  else if (cmd === "caps") await caps(a);
  else if (cmd === "agent-wallet") await agentWallet(parseInt(a || "1", 10), parseInt(b || "2", 10), 50, 5);
  else if (cmd === "spread") await spread(parseFloat(a || "1"));
  else if (cmd === "balances") await balances();
  else if (cmd === "run") await run(parseFloat(a || "30"), parseFloat(b || "20"));
  else if (cmd === "report") report();
  else console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 14).join("\n"));
} catch (e) {
  console.error("error:", e.message || e);
  process.exitCode = 1;
}
process.exit();
