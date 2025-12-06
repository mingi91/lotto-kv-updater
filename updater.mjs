import fetch from "node-fetch";

/* ------------------------------------------------------
 * 1) 최신 회차 자동 탐지 (가장 안정적인 방식)
 *    - 1190~1300까지 순회하며 success 반환된 가장 큰 회차를 최신으로 판단
 *    - HTML 파싱 필요 없음
 *    - 환경 차단 영향 없음
 * ------------------------------------------------------ */
async function fetchLatestRound() {
  console.log("[LATEST] Searching latest round...");

  let latest = 0;

  for (let round = 1190; round < 1300; round++) {
    try {
      const res = await fetch(
        `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`
      );
      const json = await res.json();

      if (json.returnValue === "success") {
        latest = round; // 성공할 때마다 업데이트
      } else {
        break; // 실패한 지점에서 종료
      }
    } catch (e) {
      console.log(`[ERROR] Fetch round ${round} failed`);
      break;
    }
  }

  console.log(`[LATEST] FINAL detected latest round = ${latest}`);
  return latest;
}

/* ------------------------------------------------------
 * 2) 개별 회차 번호 가져오기 (재시도 포함)
 * ------------------------------------------------------ */
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

      console.log(`[ROUND] ${round} not ready yet (attempt ${i})`);
    } catch (e) {
      console.log(`[ROUND] ${round} fetch error attempt ${i}:`, e);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`[ROUND] ${round} FAILED`);
  return null;
}

/* ------------------------------------------------------
 * 3) MAIN
 * ------------------------------------------------------ */
async function main() {
  const latest = await fetchLatestRound();

  if (!latest || latest < 1000) {
    console.log("❌ Invalid latest round detected");
    process.exit(1);
  }

  console.log(`[MAIN] Latest round = ${latest}`);

  const out = [];
  const weeks = 10;

  for (let i = 0; i < weeks; i++) {
    const round = latest - i;
    const nums = await fetchRoundNumbers(round);

    if (!nums) {
      console.log(`[MAIN] Stop at round ${round}`);
      break;
    }

    out.push(nums);
  }

  if (out.length === 0) {
    console.log("❌ No valid rounds fetched");
    process.exit(1);
  }

  // Timestamp (KST)
  const timestamp = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+09:00");

  const payload = {
    timestamp,
    weeks: out.length,
    recent_numbers: out,
  };

  /* ------------------------------------------------------
   * 4) Cloudflare KV 업데이트
   * ------------------------------------------------------ */
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

  /* ------------------------------------------------------
   * 5) 업데이트 후 GET 검증
   * ------------------------------------------------------ */
  try {
    const res = await fetch("https://lotto-recent.gjmg91.workers.dev/recent");
    const json = await res.json();

    if (!json.recent_numbers || json.recent_numbers.length === 0) {
      console.log("❌ GET VERIFY FAIL");
      process.exit(1);
    }

    console.log("✅ GET VERIFY SUCCESS:", json.timestamp);
  } catch (e) {
    console.log("❌ GET VERIFY ERROR:", e);
    process.exit(1);
  }

  console.log("🎉 ALL DONE");
}

main();