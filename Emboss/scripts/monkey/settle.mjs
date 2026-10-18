// Waiting for the page to settle after an action (Emboss/scripts/monkey-test.mjs). Shared by session.mjs and monkey/checks.mjs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- settling
// Editor: wait until the last render has finished and no new one has started for a moment (renders start ~200 ms after an edit).
export async function settleEditor(env, maxMs = 15000, quietMs = 350) {
  const { page } = env;
  const t0 = Date.now();
  let last = null, lastChange = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({ id: window.__mk.modelId(), r: window.__mk.renders() }));
    const sig = `${st.id}:${st.r[0]}/${st.r[1]}`;
    if (sig !== last) { last = sig; lastChange = Date.now(); }
    const pending = st.r[0] - st.r[1] > env.renderBias;
    const quiet = Date.now() - lastChange;
    if (!pending && quiet >= quietMs) return { settled: true };
    if (pending && quiet >= 4000) { env.renderBias = st.r[0] - st.r[1]; return { settled: false, why: 'a render started and never reported that it finished' }; }
    if (Date.now() - t0 > maxMs) return { settled: false, why: `the render had not settled after ${maxMs} ms` };
    await sleep(60);
  }
}
// Quick Mode: wait until the status line stops saying it is working.
export async function settleQuick(env, maxMs = 20000) {
  const { page } = env;
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => (document.getElementById('status') || {}).textContent || '');
    if (/^(Transcribing|Reading “|Loading|Connecting)/.test(s)) calm = 0; else calm += 100;
    if (calm >= 400) return { settled: true };
    await sleep(100);
  }
  return { settled: false, why: `Quick Mode still busy after ${maxMs} ms` };
}

