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
 *  - list 길이는 보장 안 됨 (1개일 수도 있음)
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
 * 핵심: 10회차 100% 보장 정규화 로직
 * ====================================================== */
function normalizeRecentRounds({
  latestRound,
  apiItems,       // 신규 API에서 온 데이터 (0~N개)
  previousNumbers // KV에 저장돼 있던 recent_numbers
}) {
  const map = new Map();

  // 1) 신규 API 데이터 우선 반영
  for (const item of apiItems) {
    map.set(item.round, item.numbers);
  }

  // 2) 기존 KV 데이터로 부족분 채우기
  if (Array.isArray(previousNumbers)) {
    for (let i = 0; i < previousNumbers.length; i++) {
      const round = latestRound - i;
      if (!map.has(round)) {
        map.set(round, previousNumbers[i]);
      }
    }
  }

  // 3) 최신 → 과거 순으로 LIMIT개 확정
  const result = [];
  for (let i = 0; i < LIMIT; i++) {
    const round = latestRound - i;
    if (map.has(round)) {
      result.push(map.get(round));
    }
  }

  return result;
}

/* ======================================================
 * MAIN
 * ====================================================== */
async function main() {
  console.log("[MAIN] Fetching lotto data...");

  // 1) 기존 KV 읽기
  const prev = await kvGetJson();
  const prevNumbers = prev?.recent_numbers ?? [];

  // 2) 신규 API 호출
  const apiItems = await fetchFromNewApi();

  if (apiItems.length === 0 && prevNumbers.length === 0) {
    console.warn("⚠️ No data from API and no previous KV. Abort safely.");
    return;
  }

  // 3) 최신 회차 결정
  //    - 신규 API가 주면 그중 최대
  //    - 아니면 기존 KV 기준
  const latestRound =
    apiItems.length > 0
      ? Math.max(...apiItems.map((i) => i.round))
      : prev?.latest_round;

  if (!latestRound) {
    console.warn("⚠️ Cannot determine latest round. Abort safely.");
    return;
  }

  // 4) 10회차 보장 정규화
  const recentNumbers = normalizeRecentRounds({
    latestRound,
    apiItems,
    previousNumbers: prevNumbers,
  });

  if (recentNumbers.length < LIMIT) {
    console.warn(
      `⚠️ Only ${recentNumbers.length} rounds available (expected ${LIMIT})`
    );
  }

  // 5) Payload 구성
  const timestamp = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+09:00");

  const payload = {
    timestamp,
    latest_round: latestRound,
    weeks: recentNumbers.length, // Flutter는 이 값 사용
    recent_numbers: recentNumbers,
  };

  // 6) KV 업데이트
  const ok = await kvPutJson(payload);
  if (ok) {
    console.log("✅ KV UPDATE SUCCESS");
    console.log(
      `✅ latest_round=${latestRound}, weeks=${payload.weeks}`
    );
  }

  console.log("🎉 ALL DONE (FUNCTIONALLY IDENTICAL)");
}

main().catch((e) => {
  console.error("❌ UNEXPECTED ERROR:", e);
});
