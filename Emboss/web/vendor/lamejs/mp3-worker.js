// BrlDuet's wrapper around the vendored lamejs (see NOTICE.txt): encodes 16-bit
// mono PCM chunks to MP3 off the page's thread, so Save as MP3 never freezes the
// page. A classic worker (lame.min.js is a classic script, not a module).
importScripts('lame.min.js');
let enc = null, parts = [];
self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      enc = new lamejs.Mp3Encoder(1, m.sampleRate, m.kbps); parts = [];
    } else if (m.type === 'pcm') {
      const out = enc.encodeBuffer(m.samples);
      if (out.length) parts.push(new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length)));
      self.postMessage({ type: 'ack' });
    } else if (m.type === 'finish') {
      const out = enc.flush();
      if (out.length) parts.push(new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length)));
      self.postMessage({ type: 'done', parts }, parts.map((p) => p.buffer));
      enc = null; parts = [];
    }
  } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }
};
