import fetch from "node-fetch";

/* ---------------------------------------------
 * 1) 최신 회차 감지 — 가장 안정적인 3단계 구조 (9999 → main → fallback)
 * --------------------------------------------- */
async function fetchLatestRound() {
  // (1) 9999 방식 (가장 안정적)
  try {
    const res = await fetch(
      "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=9999"
    );
    const json = await res.json();

    if (json.returnValue === "success" && json.drwNo > 0) {
      console.log(`[LATEST] via 9999 → ${json.drwNo}`);
      return json.drwNo;
    }
  } catch (e) {
    console.log("[LATEST] 9999 error:", e);
  }

  // (2) 메인 페이지 fallback
  try {
    const res = await fetch(
      "https://www.dhlottery.co.kr/common.do?method=main"
    );
    const text = await res.text();
    const match = text.match(/"drwNo":"(\d+)"/);

    if (match) {
      const latest = parseInt(match[1]);
      console.log(`[LATEST] via main page → ${latest}`);
      return latest;
    }
  } catch (e) {
    console.log("[LATEST] main page error:", e);
  }

  // (3) 날짜 기반 회차 예측 fallback
  const start = new Date("2002-12-07");
  const now = new Date();
  const weeks = Math.floor((now - start) / (1000 * 60 * 60 * 24 * 7));
  const guess = weeks + 1;
  console.log(`[LATEST] FINAL fallback guess → ${guess}`);
  return guess;
}

/* ---------------------------------------------
 * 2) 특정 회차 번호 가져오기 (재시도 3회)
 * --------------------------------------------- */
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
      console.log(`[ROUND] ${round} fetch error (attempt ${i}):`, e);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`[ROUND] ${round} FAILED`);
  return null;
}

/* ---------------------------------------------
 * 3) MAIN
 * --------------------------------------------- */
async function main() {
  const latest = await fetchLatestRound();
  console.log("[MAIN] Latest round:", latest);

  const weeks = 10;
  const out = [];

  for (let i = 0; i < weeks; i++) {
    const round = latest - i;
    const nums = await fetchRoundNumbers(round);

    if (!nums) {
      console.log(`[MAIN] ${round} unavailable → stop`);
      break;
    }

    out.push(nums);
  }

  if (out.length === 0) {
    console.log("❌ No valid numbers fetched. Exit.");
    process.exit(1);
  }

  // timestamp (KST)
  const timestamp = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+09:00");

  const payload = {
    timestamp,
    weeks: out.length,
    recent_numbers: out,
  };

  // KV 업데이트
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

  // GET 검증
  try {
    const check = await fetch("https://lotto-recent.gjmg91.workers.dev/recent");
    const json = await check.json();

    if (!json.recent_numbers || json.recent_numbers.length === 0) {
      console.log("❌ GET VERIFY FAIL");
      process.exit(1);
    }

    console.log("✅ GET VERIFY OK:", json.timestamp);
  } catch (e) {
    console.log("❌ GET VERIFY ERR:", e);
    process.exit(1);
  }

  console.log("🎉 ALL DONE");
}

main();