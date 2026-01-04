import fetch from "node-fetch";

/* ======================================================
 * 설정
 * ====================================================== */
const LOTTO_API =
  "https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do";

const KV_KEY = "recent_numbers";
const LIMIT = 10;

/* ======================================================
 * Cloudflare KV helpers
 * ====================================================== */
function kvEndpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_NAMESPACE_ID}/values/${KV_KEY}`;
}

async function kvGet() {
  const res = await fetch(kvEndpoint(), {
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
    },
  });

  if (!res.ok) {
    console.error("❌ KV GET FAIL");
    return null;
  }

  return JSON.parse(await res.text());
}

async function kvPut(payload) {
  const res = await fetch(kvEndpoint(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("❌ KV PUT FAIL:", await res.text());
    return false;
  }

  return true;
}

/* ======================================================
 * 신규 API: 최신 회차 1개만 신뢰
 * ====================================================== */
async function fetchLatestOnly() {
  const res = await fetch(LOTTO_API, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://www.dhlottery.co.kr/",
      "Accept": "application/json",
    },
  });

  if (!res.ok) return null;

  const json = await res.json();
  const item = json?.data?.list?.[0];

  if (!item || !Number.isInteger(item.ltEpsd)) return null;

  return {
    round: item.ltEpsd,
    numbers: [
      item.tm1WnNo,
      item.tm2WnNo,
      item.tm3WnNo,
      item.tm4WnNo,
      item.tm5WnNo,
      item.tm6WnNo,
      item.bnsWnNo,
    ],
  };
}

/* ======================================================
 * MAIN
 * ====================================================== */
async function main() {
  console.log("[MAIN] updater start");

  // 1) KV 읽기
  const prev = await kvGet();

  if (!prev || !Array.isArray(prev.recent_items)) {
    console.error("❌ KV invalid. recent_items not found.");
    return;
  }

  let items = [...prev.recent_items];

  // 2) 최신 회차 1개 감지
  const latestApi = await fetchLatestOnly();

  if (
    latestApi &&
    Number.isInteger(latestApi.round) &&
    latestApi.round > prev.latest_round
  ) {
    console.log(
      `[MAIN] New round detected: ${latestApi.round} (prev ${prev.latest_round})`
    );
    items.unshift(latestApi);
  } else {
    console.log("[MAIN] No new round. Keep KV as-is.");
  }

  // 3) round 기준 정렬 + 10개 유지
  items = items
    .sort((a, b) => b.round - a.round)
    .slice(0, LIMIT);

  // 4) payload 구성 (Flutter 호환 유지)
  const payload = {
    timestamp: new Date(Date.now() + 9 * 3600 * 1000)
      .toISOString()
      .replace("Z", "+09:00"),
    latest_round: items[0].round,
    weeks: items.length,
    recent_items: items,
    recent_numbers: items.map((i) => i.numbers),
  };

  // 5) KV 업데이트
  const ok = await kvPut(payload);

  if (ok) {
    console.log(
      `✅ UPDATE OK (latest=${payload.latest_round}, weeks=${payload.weeks})`
    );
  }
}

main().catch((e) => {
  console.error("❌ UNEXPECTED ERROR:", e);
});
