import fetch from "node-fetch";

async function fetchLotto(drawNo) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${drawNo}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.returnValue !== "success") return null;

  return [
    data.drwtNo1,
    data.drwtNo2,
    data.drwtNo3,
    data.drwtNo4,
    data.drwtNo5,
    data.drwtNo6,
    data.bnusNo
  ];
}

async function main() {
  const latest = 1200;
  const weeks = 10;

  const result = [];

  for (let i = 0; i < weeks; i++) {
    const draw = latest - i;
    const nums = await fetchLotto(draw);
    result.push(nums);
  }

  // ⭐ KST 기준 타임스탬프 생성
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = nowKST.toISOString().replace("Z", "+09:00");

  const payload = {
    timestamp,       // ← 한국시간
    weeks,
    recent_numbers: result
  };

  console.log("SAVE:", payload);

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_NAMESPACE_ID}/values/recent_numbers`;

  await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${process.env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

main();
