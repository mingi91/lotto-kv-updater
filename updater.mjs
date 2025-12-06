import fetch from "node-fetch";

// -----------------------------
// 1) 최신 회차 안정 감지
// -----------------------------
async function fetchLatestRound() {
  // (1) 9999 방식이 가장 신뢰도 높음
  try {
    const res = await fetch(
      "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=9999"
    );
    const json = await res.json();

    if (json.returnValue === "success" && json.drwNo > 0) {
      console.log(`[LATEST] Detected by 9999 trick → ${json.drwNo}`);
      return json.drwNo;
    }
  } catch (e) {
    console.log("[LATEST] 9999 detect failed:", e);
  }

  // (2) 메인 페이지 백업 감지
  try {
    const res = await fetch(
      "https://www.dhlottery.co.kr/common.do?method=main"
    );
    const text = await res.text();
    const match = text.match(/"drwNo":"(\d+)"/);

    if (match) {
      const latest = parseInt(match[1]);
      console.log(`[LATEST] Detected via main page → ${latest}`);
      return latest;
    }
  } catch (e) {
    console.log("[LATEST] Main page detect failed:", e);
  }

  // (3) 최종 fallback — 날짜 기반 예측
  const start = new Date("2002-12-07");
  const now = new Date();
  const weeks = Math.floor((now - start) / (1000 * 60 * 60 * 24 * 7));
  const guess = 1 + weeks;
  console.log(`[LATEST] FINAL fallback guess → ${guess}`);
  return guess;
}

// -----------------------------
// 2) 특정 회차 번호 받아오기
// -----------------------------
async function fetchRoundNumbers(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;

  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url);
      const json = await res.json();

      if (json.returnValue === "success") {
        console.log(`[ROUND] ${round} OK`);
        return [
          json.drwtNo1,
          json.drwtNo2,
          json.drwtNo3,
          json.drwtNo4,
          json.drwtNo5,
          json.drwtNo6,
          json.bnusNo,
        ];
      }

      console.log(`[ROUND] ${round} not ready (attempt ${i})`);
    } catch (e) {
      console.log(`[ROUND] ${round} fetch error attempt ${i}:`, e);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`[ROUND] ${round} FAILED`);
  return null;
}

// -----------------------------
// 3) Main
// -----------------------------
async function main() {
  const latest = await fetchLatestRound();
  console.log("[MAIN] Latest round:", latest);

  const weeks = 10;
  const out = [];

  for (let i = 0; i < weeks; i++) {
    const round = latest - i;
    const nums = await fetchRoundNumbers(round);

    if (!nums) {
      console.log(`[MAIN] ${round} is not available → stop`);
      break;
    }

    out.push(nums);
  }

  if (out.length === 0) {
    console.log("❌ No valid rounds. Exit.");
    process.exit(1);
  }

  // Time (KST)
  const timestamp = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+09:00");

  const payload = {
    timestamp,
    weeks: out.length,
    recent_numbers: out,
  };

  // -----------------------------
  // 4) KV 업데이트
  // -----------------------------
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_NAMESPACE_ID}/values/recent_numbers`;

  const resp = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    console.log("❌ KV UPDATE FAIL:", await resp.text());
    process.exit(1);
  }

  console.log("✅ KV UPDATE SUCCESS");

  // -----------------------------
  // 5) GET 검증
  // -----------------------------
  try {
    const check = await fetch(
      "https://lotto-recent.gjmg91.workers.dev/recent"
    );
    const json = await check.json();

    if (!json.recent_numbers || json.recent_numbers.length === 0) {
      console.log("❌ GET VERIFY FAIL");
      process.exit(1);
    }

    console.log("✅ GET VERIFY:", json.timestamp);
  } catch (e) {
    console.log("❌ GET VERIFY ERROR:", e);
    process.exit(1);
  }

  console.log("🎉 ALL DONE");
}

main();