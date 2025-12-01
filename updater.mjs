import fetch from "node-fetch";

/* ---------------------------------------------
 * 1) 최신 회차 감지 — 가장 안정적인 2단계 파서
 * --------------------------------------------- */
async function fetchLatestRound() {
  // 1순위: 메인 페이지 파싱
  try {
    const res = await fetch("https://www.dhlottery.co.kr/common.do?method=main");
    const text = await res.text();
    const match = text.match(/"drwNo":"(\d+)"/);
    if (match) {
      const latest = parseInt(match[1]);
      console.log(`Latest round detected via main page: ${latest}`);
      return latest;
    }
  } catch (e) {
    console.log("Main page parse failed:", e);
  }

  // 2순위: 9999 트릭
  try {
    const res2 = await fetch(
      "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=9999"
    );
    const data2 = await res2.json();
    if (data2 && data2.drwNo) {
      console.log(`Fallback latest round: ${data2.drwNo}`);
      return data2.drwNo;
    }
  } catch (e) {
    console.log("9999 fallback failed:", e);
  }

  // 최후의 보루
  console.log("Using final fallback latest round: 1200");
  return 1200;
}

/* ---------------------------------------------
 * 2) 특정 회차 번호 가져오기 (재시도 3회)
 * --------------------------------------------- */
async function fetchLotto(drawNo) {
  for (let i = 1; i <= 3; i++) {
    try {
      const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${drawNo}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data && data.returnValue === "success") {
        return [
          data.drwtNo1, data.drwtNo2, data.drwtNo3,
          data.drwtNo4, data.drwtNo5, data.drwtNo6,
          data.bnusNo
        ];
      }
    } catch (e) {
      console.log(`fetchLotto(${drawNo}) retry ${i} failed`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return null;
}

/* ---------------------------------------------
 * 3) MAIN
 * --------------------------------------------- */
async function main() {
  const latestRound = await fetchLatestRound();
  console.log("Detected latest round:", latestRound);

  const weeks = 10;
  const result = [];

  for (let i = 0; i < weeks; i++) {
    const round = latestRound - i;
    const nums = await fetchLotto(round);

    // 미발표 회차이면 즉시 중단
    if (!nums) {
      console.log(`${round}회차 미발표 → ${result.length}개만 저장하고 종료`);
      break;
    }

    result.push(nums);
    console.log(`${round}회차 OK`);
  }

  if (result.length === 0) {
    console.log("최근 회차 정보를 하나도 가져오지 못함 → 실패 처리");
    process.exit(1);
  }

  // 시간(KST)
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString().replace("Z", "+09:00");

  const payload = {
    timestamp: nowKST,
    weeks: result.length,
    recent_numbers: result
  };

  console.log("PAYLOAD:", payload);

  /* ---------------------------------------------
   * 4) Cloudflare KV 업데이트
   * --------------------------------------------- */
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_NAMESPACE_ID}/values/recent_numbers`;

  const updateRes = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${process.env.CF_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!updateRes.ok) {
    console.error("⚠ KV 업데이트 실패:", updateRes.status, await updateRes.text());
    process.exit(1);
  }

  console.log("KV 업데이트 성공!");

  /* ---------------------------------------------
   * 5) 업데이트 후 GET 테스트 (추가 안정성)
   * --------------------------------------------- */
  try {
    const check = await fetch("https://lotto-recent.gjmg91.workers.dev/recent");
    const json = await check.json();

    if (!json.recent_numbers || json.recent_numbers.length === 0) {
      console.error("⚠ GET 검증 실패 — recent_numbers 없음");
      process.exit(1);
    }

    console.log("GET 검증 성공:", json.timestamp);
  } catch (e) {
    console.error("⚠ GET 검증 중 에러:", e);
    process.exit(1);
  }

  console.log("🎉 모든 작업 성공!");
}

main().catch(err => {
  console.error("치명적 에러:", err);
  process.exit(1);
});
