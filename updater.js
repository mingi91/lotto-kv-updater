import fetch from "node-fetch";

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_NAMESPACE_ID = process.env.CF_NAMESPACE_ID;

async function fetchLatestDraw() {
  const api = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=0";
  const res = await fetch(api);
  const data = await res.json();
  return data.drwNo;
}

async function fetchDrawNumbers(drawNo) {
  const api = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${drawNo}`;
  const res = await fetch(api);
  const data = await res.json();
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

async function run() {
  const latest = await fetchLatestDraw();
  const weeks = 4;

  const tasks = [];
  for (let i = 0; i < weeks; i++) {
    tasks.push(fetchDrawNumbers(latest - i));
  }

  const results = await Promise.all(tasks);

  const nums = new Set();
  results.forEach(arr => arr.forEach(n => nums.add(n)));

  const body = {
    timestamp: new Date().toISOString(),
    latest_draw: latest,
    weeks,
    recent_numbers: [...nums],
  };

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_NAMESPACE_ID}/values/recent_numbers`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CF_API_TOKEN}`,
      },
      body: JSON.stringify(body),
    }
  );

  console.log("DONE");
}

run();
