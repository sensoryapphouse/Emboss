// Build identity shown in Help ("Version <hash>, built <date>").
//
// build-dist.mjs writes dist/build-info.json (git short hash, "+dirty" if the
// working tree had uncommitted changes when built, and the build date) as part
// of assembling dist/. That file does not exist in the project source, so in
// the dev server (serving Emboss/ unbuilt) this fetch 404s and callers should
// show "development" instead of guessing a version.
export async function getBuildInfo() {
  try {
    const res = await fetch('/build-info.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.hash) ? data : null;
  } catch {
    return null;
  }
}
