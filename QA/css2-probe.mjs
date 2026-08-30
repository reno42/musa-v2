// QA/css2-probe.mjs — réplica 1:1 del fetch que hace el proxy desplegado
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function probe(label, url, headers) {
  try {
    const r = await fetch(url, { headers });
    console.log(`${label}: ${r.status}`);
    if (!r.ok) console.log(`  body: ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.log(`${label}: FETCH-ERROR ${e.message}`);
  }
}

const cruda = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap";
const codificada = "https://fonts.googleapis.com/css2?family=Instrument+Serif%3Aital%400%3B1&display=swap";

await probe("google-cruda [sin-UA]", cruda, {});
await probe("google-cruda [UA-chrome]", cruda, { "user-agent": UA });
await probe("google-codificada [UA-chrome]", codificada, { "user-agent": UA });

// Réplica exacta del código del proxy (URLSearchParams + undici + UA)
const params = new URLSearchParams();
params.append("family", "Instrument Serif:ital@0;1");
params.append("display", "swap");
console.log("proxy query:", params.toString());
await probe("proxy-replica [UA-chrome]", `https://fonts.googleapis.com/css2?${params.toString()}`, { "user-agent": UA });

// Y el proxy desplegado, para comparar en la misma corrida
await probe("via-proxy-deployado", "https://design.futuraria.com/api/fonts/css2?family=Instrument+Serif:ital@0;1&display=swap", {});