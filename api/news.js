export default async function handler(req, res) {
  try {
    const rss = "https://www.bitget.com/academy/en/rss.xml";
    const r = await fetch(rss, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await r.text();
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(xml);
  } catch (e) {
    return res.status(200).json({ fallback: true, items: [] });
  }
}
