import { useEffect, useMemo, useRef, useState } from "react";

// === UTILITIES ===
const fmt = (n, d = 2) => {
  if (n === undefined || n === null || isNaN(n)) return "-";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Math.abs(num) >= 1_000_000_000) return (num / 1_000_000_000).toFixed(d) + "B";
  if (Math.abs(num) >= 1_000_000) return (num / 1_000_000).toFixed(d) + "M";
  if (Math.abs(num) >= 1_000) return (num / 1_000).toFixed(d) + "K";
  return num.toFixed(d);
};

const pct = (open, last) => {
  if (!open || !last) return 0;
  const o = parseFloat(open), l = parseFloat(last);
  return ((l - o) / o) * 100;
};

const Card = ({ title, children, right }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

const DepthBars = ({ side, levels, max }) => {
  return (
    <div className="space-y-1">
      {levels.slice(0, 12).map((lv, i) => {
        const [price, size] = lv.map(parseFloat);
        const w = Math.min(100, (size / (max || 1)) * 100);
        const color = side === "bids" ? "bg-emerald-100" : "bg-rose-100";
        return (
          <div key={i} className="relative text-xs">
            <div className={`absolute inset-y-0 ${side === "bids" ? "right-0" : "left-0"} ${color}`} style={{ width: `${w}%` }} />
            <div className="relative z-10 flex justify-between px-2 py-1">
              <span className={side === "bids" ? "text-emerald-700" : "text-rose-700"}>{price}</span>
              <span className="text-slate-600">{fmt(size, 4)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default function App() {
  const [symbols, setSymbols] = useState([]);
  const [selected, setSelected] = useState("BTCUSDT");
  const [tickers, setTickers] = useState([]);
  const [spotTicker, setSpotTicker] = useState(null);
  const [depth, setDepth] = useState({ bids: [], asks: [] });
  const [futures, setFutures] = useState([]);
  const [news, setNews] = useState([]);
  const wsRef = useRef(null);
  const wsDepthRef = useRef(null);

  // Token listing (spot symbols)
  useEffect(() => {
    fetch("https://api.bitget.com/api/v2/spot/public/symbols")
      .then(r => r.json())
      .then(j => {
        const arr = (j?.data || []).filter(x => x.quoteCoin === "USDT");
        setSymbols(arr);
      })
      .catch(err => console.warn("symbols error", err));
  }, []);

  // Spot tickers refresh 10s
  useEffect(() => {
    let alive = true;
    const load = () => fetch("https://api.bitget.com/api/v2/spot/market/tickers")
      .then(r => r.json())
      .then(j => { if (!alive) return; setTickers(j?.data || []); })
      .catch(err => console.warn("tickers error", err));
    load();
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Resolve selected ticker
  useEffect(() => {
    const t = tickers.find(t => t.symbol === selected);
    setSpotTicker(t || null);
  }, [tickers, selected]);

  // WS ticker realtime
  useEffect(() => {
    if (!selected) return;
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
    wsRef.current = ws;
    ws.onopen = () => {
      console.log("WS ticker connected", selected);
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "ticker", instId: `${selected}_SPBL` }] }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const item = msg?.data?.[0];
        if (item?.lastPr) {
          setSpotTicker(prev => ({
            ...(prev || { symbol: selected }),
            last: item.lastPr,
            open24h: item.open24h || prev?.open24h,
            high24h: item.high24h || prev?.high24h,
            low24h: item.low24h || prev?.low24h,
            baseVol: item.baseVol || prev?.baseVol,
            quoteVol: item.quoteVol || prev?.quoteVol,
          }));
        }
      } catch (e) { console.warn("WS ticker parse", e); }
    };
    ws.onerror = e => console.warn("WS ticker error", e);
    return () => ws.close();
  }, [selected]);

  // WS order book
  useEffect(() => {
    if (!selected) return;
    if (wsDepthRef.current) wsDepthRef.current.close();
    const ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
    wsDepthRef.current = ws;
    ws.onopen = () => {
      console.log("WS book connected", selected);
      ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "books", instId: `${selected}_SPBL` }] }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg?.data?.[0];
        if (d?.bids && d?.asks) setDepth({ bids: d.bids, asks: d.asks });
      } catch (e) { console.warn("WS book parse", e); }
    };
    ws.onerror = e => console.warn("WS book error", e);
    return () => ws.close();
  }, [selected]);

  // Futures tickers (USDT-margined perpetual: UMCBL)
  useEffect(() => {
    const load = () => fetch("https://api.bitget.com/api/v2/mix/market/tickers?productType=umcbl")
      .then(r => r.json())
      .then(j => setFutures(j?.data || []))
      .catch(err => console.warn("futures error", err));
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  // News (Bitget Academy RSS)
  useEffect(() => {
    const url = "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://www.bitget.com/academy/en/rss.xml");
    fetch(url)
      .then(r => r.text())
      .then(xml => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "text/xml");
        const items = [...doc.querySelectorAll("item")].slice(0, 8).map(it => ({
          title: it.querySelector("title")?.textContent || "",
          link: it.querySelector("link")?.textContent || "#",
          pub: it.querySelector("pubDate")?.textContent || ""
        }));
        setNews(items);
      })
      .catch(() => setNews([
        { title: "What is Perpetual Futures?", link: "https://www.bitget.com/academy/en" },
        { title: "Funding Rate Explained", link: "https://www.bitget.com/academy/en" },
      ]));
  }, []);

  const depthMax = useMemo(() => {
    const all = [...(depth?.bids || []), ...(depth?.asks || [])].map(x => parseFloat(x?.[1] || 0));
    return all.length ? Math.max(...all) : 0;
  }, [depth]);

  const topFutures = useMemo(() => {
    const arr = [...futures];
    arr.sort((a,b) => parseFloat(b.quoteVol24h||0) - parseFloat(a.quoteVol24h||0));
    return arr.slice(0, 10);
  }, [futures]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-bold tracking-tight">Bitget Mini Dashboard</div>
          <div className="text-xs text-slate-500">Demo — data publik Bitget (WS + REST)</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="grid md:grid-cols-3 gap-4">
          <Card title="Pilih Pasangan (USDT)">
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="w-full rounded-xl border-slate-300 focus:ring-2 focus:ring-emerald-400"
            >
              {symbols.map(s => (
                <option key={s.symbol} value={s.symbol}>{s.symbol}</option>
              ))}
            </select>
          </Card>

          <Card title="Harga & Volume (Spot)">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500">Last Price</div>
                <div className="text-lg font-semibold">{spotTicker?.last || "-"}</div>
              </div>
              <div>
                <div className="text-slate-500">24h Change</div>
                <div className={"text-lg font-semibold " + ((pct(spotTicker?.open24h, spotTicker?.last) >= 0) ? "text-emerald-600" : "text-rose-600") }>
                  {fmt(pct(spotTicker?.open24h, spotTicker?.last), 2)}%
                </div>
              </div>
              <div>
                <div className="text-slate-500">24h High</div>
                <div className="font-medium">{spotTicker?.high24h || "-"}</div>
              </div>
              <div>
                <div className="text-slate-500">24h Low</div>
                <div className="font-medium">{spotTicker?.low24h || "-"}</div>
              </div>
              <div>
                <div className="text-slate-500">Base Vol 24h</div>
                <div className="font-medium">{fmt(spotTicker?.baseVol)}</div>
              </div>
              <div>
                <div className="text-slate-500">Quote Vol 24h</div>
                <div className="font-medium">{fmt(spotTicker?.quoteVol)}</div>
              </div>
            </div>
          </Card>

          <Card title="Futures — Top by Vol(24h)" right={<span className="text-xs text-slate-500">UMCBL</span>}>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Inst</th>
                    <th className="py-1">Last</th>
                    <th className="py-1">24h %</th>
                    <th className="py-1">Vol24h</th>
                  </tr>
                </thead>
                <tbody>
                  {topFutures.map(f => (
                    <tr key={f.instId} className="border-t border-slate-100">
                      <td className="py-1">{f.instId.replace("_UMCBL", "")}</td>
                      <td className="py-1">{f.lastPr}</td>
                      <td className={"py-1 " + (parseFloat(f.change24h||0) >= 0 ? "text-emerald-600" : "text-rose-600")}>{fmt(parseFloat(f.change24h||0),2)}%</td>
                      <td className="py-1">{fmt(f.quoteVol24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card title={`Order Book — ${selected}`}>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-emerald-700 mb-1">Bids</div>
                <DepthBars side="bids" levels={depth.bids || []} max={depthMax} />
              </div>
              <div>
                <div className="text-xs font-semibold text-rose-700 mb-1">Asks</div>
                <DepthBars side="asks" levels={depth.asks || []} max={depthMax} />
              </div>
            </div>
          </Card>

          <Card title="Token Listing (USDT)">
            <div className="h-[320px] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Symbol</th>
                    <th className="py-1">Min Trade</th>
                    <th className="py-1">Maker/Taker</th>
                  </tr>
                </thead>
                <tbody>
                  {symbols.slice(0, 200).map(s => (
                    <tr key={s.symbol} className="border-t border-slate-100">
                      <td className="py-1 font-medium">{s.symbol}</td>
                      <td className="py-1">{s.minTradeAmount}</td>
                      <td className="py-1">{s.makerFeeRate}/{s.takerFeeRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Card title="News (Bitget Academy)">
            <div className="space-y-2 h-[280px] overflow-auto">
              {news.map((n, i) => (
                <a key={i} href={n.link} target="_blank" rel="noreferrer" className="block group">
                  <div className="text-sm font-medium group-hover:text-emerald-600">{n.title}</div>
                  {n.pub && <div className="text-xs text-slate-500">{n.pub}</div>}
                </a>
              ))}
            </div>
          </Card>

          <Card title="Akademi — Topik Dasar">
            <ul className="list-disc pl-5 text-sm space-y-1">
              <li><a className="text-emerald-700 hover:underline" href="https://www.bitget.com/academy/en/articles/what-is-spot-trading" target="_blank" rel="noreferrer">Apa itu Spot Trading?</a></li>
              <li><a className="text-emerald-700 hover:underline" href="https://www.bitget.com/academy/en/articles/what-is-futures-trading" target="_blank" rel="noreferrer">Apa itu Futures?</a></li>
              <li><a className="text-emerald-700 hover:underline" href="https://www.bitget.com/academy/en/articles/what-is-funding-rate" target="_blank" rel="noreferrer">Funding Rate, singkatnya</a></li>
              <li><a className="text-emerald-700 hover:underline" href="https://www.bitget.com/academy/en" target="_blank" rel="noreferrer">Lihat semua materi →</a></li>
            </ul>
          </Card>

          <Card title="Catatan Teknis">
            <ul className="list-disc pl-5 text-sm space-y-1 text-slate-700">
              <li>Data harga & order book real-time via WebSocket publik Bitget.</li>
              <li>Refresh REST: Spot 10s, Futures 15s.</li>
              <li>Untuk data akun, gunakan backend (jangan expose key di browser).</li>
              <li>News memakai RSS proxy; untuk produksi pakai proxy backend sendiri.</li>
            </ul>
          </Card>
        </div>
      </main>

      <footer className="py-10 text-center text-xs text-slate-500">
        Built for demo • Bitget Public API • React + Tailwind • Vite
      </footer>
    </div>
  );
}
