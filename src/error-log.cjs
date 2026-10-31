const fs = require('node:fs');
const path = require('node:path');
function clean(value) {
  return String(value ?? '').slice(0, 12000)
    .replace(/(-EncodedCommand\s+)[A-Za-z0-9+/=]+/gi, '$1[redacted]')
    .replace(/((?:token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]');
}
class ErrorLog {
  constructor(directory, { maxBytes = 1048576, backups = 3, now = Date.now } = {}) {
    this.directory = directory; this.file = path.join(directory, 'errors.jsonl');
    this.maxBytes = maxBytes; this.backups = backups; this.now = now; this.recent = new Map();
  }
  write(source, error) {
    try {
      const message = clean(error instanceof Error ? error.message : error);
      const stack = error instanceof Error ? clean(error.stack) : undefined;
      const key = source + ':' + message, time = this.now();
      if (this.recent.has(key) && time - this.recent.get(key) < 60000) return false;
      fs.mkdirSync(this.directory, { recursive: true });
      const line = JSON.stringify({ at: new Date(time).toISOString(), source: clean(source).slice(0, 100), message, stack }) + '\n';
      if (fs.existsSync(this.file) && fs.statSync(this.file).size + Buffer.byteLength(line) > this.maxBytes) {
        for (let n = this.backups; n >= 1; n--) {
          const from = n === 1 ? this.file : this.file + '.' + (n - 1), to = this.file + '.' + n;
          if (fs.existsSync(to)) fs.unlinkSync(to);
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      }
      fs.appendFileSync(this.file, line, { mode: 0o600 });
      if (this.recent.size >= 200) this.recent.delete(this.recent.keys().next().value);
      this.recent.set(key, time); return true;
    } catch { return false; } // Logging must not interrupt settings recovery when storage is unavailable.
  }
}
module.exports = { ErrorLog, clean };
