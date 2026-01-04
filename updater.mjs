import fetch from "node-fetch";

/* ======================================================
 * 설정
 * ====================================================== */
const LOTTO_API =
  "https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do";

const KV_KEY = "recent_numbers";
const LIMIT = 10;

const FETCH_OPTIONS = {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": "https://www.dhlottery.co.kr/",
    "Accept": "application/json",
  },
  timeout: 8000,
};

/* ======================================================
 * Cloudflare KV helpers
 * ====================================================== */
function kvEndpoint() {
  const { CF_ACCOUNT_ID, CF_NAMESPACE_ID } = process.env;
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/${KV_KEY}`;
}

async function kvGetJson() {
  const { CF_API_TOKEN } = process.env;
  const res = await fetch(kvEndpoint(), {
    method: "GET",
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
  });
  if (!res.ok) return null;
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

async function kvPutJson(payload) {
  const { CF_API_TOKEN } = process.env;
  const res = await fetch(kvEndpoint(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("❌ KV UPDATE FAIL:", await res.text());
    return false;
  }
  return true;
}

/* ======================================================
 * 신규 API에서 데이터 가져오기
 * ====================================================== */
async function fetchFromNewApi() {
  const res = await fetch(LOTTO_API, FETCH_OPTIONS);
  const json = await res.json();

  if (!json?.data?.list || json.data.list.length === 0) {
    return [];
  }

  return json.data.list.map((item) => ({
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
  }));
}

/* ======================================================
 * 핵심: round 기준 10회차 정규화 (밀림 보장)
 * ====================================================== */
function normalizeRecentRounds({
  latestRound,
  apiItems,        // [{ round, numbers }]
  previousItems,   // [{ round, numbers }]
}) {
  const map = new Map();

  // 1) 신규 API 데이터 (최우선)
  for (const item of apiItems) {
    map.set(item.round, item.numbers);
  }

  // 2) 기존 KV 데이터 (round 기준)
  for (const item of previousItems) {
    if (!map.has(item.round)) {
      map.set(item.round, item.numbers);
    }
  }

  // 3) 최신 → 과거 순으로 정확히 LIMIT개
  const result = [];
  for (let r = latestRound; r > latestRound - LIMIT; r--) {
    if (map.has(r)) {
      result.push({ round: r, numbers: map.get(r) });
    }
  }

  return result;
}

/* ======================================================
 * MAIN
 * ====================================================== */
async function main() {
  console.log("[MAIN] Start updater (round-aware)");

  // 1) 기존 KV 읽기
  const prev = await kvGetJson();

  /**
   * 🔄 마이그레이션 처리
   * - 이전 구조: recent_numbers: [[...]]
   * - 신규 구조: recent_items: [{ round, numbers }]
   */
  let previousItems = [];
  let previousLatestRound = prev?.latest_round;

  if (Array.isArray(prev?.recent_items)) {
    // 이미 신규 구조
    previousItems = prev.recent_items;
  } else if (Array.isArray(prev?.recent_numbers) && previousLatestRound) {
    // 구 구조 → 신규 구조로 변환 (1회)
    previousItems = prev.recent_numbers.map((nums, idx) => ({
      round: previousLatestRound - idx,
      numbers: nums,
    }));
    console.log("🔄 Migrated legacy KV structure → round-aware");
  }

  // 2) 신규 API 호출
  const apiItems = await fetchFromNewApi();

  if (apiItems.length === 0 && previousItems.length === 0) {
    console.warn("⚠️ No data source available. Abort safely.");
    return;
  }

  // 3) 최신 회차 결정
  const latestRound =
    apiItems.length > 0
      ? Math.max(...apiItems.map((i) => i.round))
      : previousLatestRound;

  if (!latestRound) {
    console.warn("⚠️ Cannot determine latest round. Abort.");
    return;
  }

  // 4) round 기준 정규화 (정확한 밀림)
  const normalized = normalizeRecentRounds({
    latestRound,
    apiItems,
    previousItems,
  });

  // 5) Flutter 호환 payload 구성
  const timestamp = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+09:00");

  const payload = {
    timestamp,
    latest_round: latestRound,
    weeks: normalized.length,
    // ✅ Flutter가 쓰는 필드 (기존과 동일)
    recent_numbers: normalized.map((i) => i.numbers),
    // 🔒 내부 안정성용 (Flutter 미사용)
    recent_items: normalized,
  };

  // 6) KV 업데이트
  const ok = await kvPutJson(payload);
  if (ok) {
    console.log(
      `✅ KV UPDATE SUCCESS (latest_round=${latestRound}, weeks=${payload.weeks})`
    );
  }

  console.log("🎉 ALL DONE (ROUND-SAFE, SHIFT-CORRECT)");
}

main().catch((e) => {
  console.error("❌ UNEXPECTED ERROR:", e);
});
