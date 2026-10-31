const net = require('node:net');
const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
class GpuControl {
  constructor(root) { this.root = root; this.pending = new Map(); this.sequence = 0; this.socket = null; this.state = null; this.error = null; }
  async enable() {
    if (this.socket && !this.socket.destroyed) return this.request('state');
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async connect() {
    const token = crypto.randomBytes(32).toString('hex');
    const pipe = 'aether-' + crypto.randomBytes(16).toString('hex');
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen('\\\\.\\pipe\\' + pipe, resolve); });
    const connected = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { server.close(); reject(Error('Administrator approval timed out. Try enabling GPU controls again.')); }, 300000);
      this.cancelConnect = error => { clearTimeout(timeout); server.close(); reject(error); };
      server.on('connection', socket => {
        const lines = readline.createInterface({ input: socket });
        let authenticated = false;
        lines.on('line', line => {
          try {
            const value = JSON.parse(line);
            if (!authenticated) {
              if (value.token !== token || !value.ready || this.socket) { socket.destroy(); return; }
              authenticated = true; this.socket = socket; server.close(); clearTimeout(timeout); resolve(); return;
            }
            const pending = this.pending.get(value.id); if (!pending) return;
            this.pending.delete(value.id); clearTimeout(pending.timeout);
            if (value.ok) { this.state = value.data; this.error = null; pending.resolve(value.data); }
            else { this.error = value.error; pending.reject(Error(value.error)); }
          } catch { socket.destroy(); }
        });
        const closed = () => {
          if (socket !== this.socket) return;
          this.socket = null; this.state = null;
          this.error = 'GPU helper disconnected. Its watchdog restores Aether offsets; reconnect to verify recovery.';
          for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(Error(this.error)); }
          this.pending.clear();
        };
        socket.on('close', closed); socket.on('error', closed);
      });
    });
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const helper = path.join(this.root, 'gpu-helper.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    const quote = text => "'" + text.replaceAll("'", "''") + "'";
    const argumentsText = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '"' + helper + '"', '-Pipe', pipe, '-Token', token, '-ParentId', String(process.pid)].map(quote).join(',');
    const command = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${quote(powershell)} -ArgumentList @(${argumentsText}) -Verb RunAs -WindowStyle Hidden`;
    // RunAs asks Windows for UAC approval; only the small clock helper is elevated.
    const launch = exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 300000 });
    try { await Promise.all([connected, launch]); }
    catch (e) {
      this.cancelConnect?.(e); this.socket?.destroy();
      if (/cancel(?:ed|led) by the user/i.test((e.stderr || '') + e.message)) throw Error('Windows administrator approval was cancelled. Enable GPU controls again when ready; any pending recovery backup is retained.');
      if (/approval timed out/.test(e.message)) throw e;
      throw Error('Windows could not start the GPU helper. Check the administrator prompt and try again.');
    }
    return this.request('state');
  }
  request(action, payload = {}) {
    if (!this.socket || this.socket.destroyed) return Promise.reject(Error('Enable GPU controls first. Windows administrator approval is required.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => { this.pending.delete(id); this.socket?.destroy(); reject(Error('GPU command timed out; watchdog recovery requested.')); }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.write(JSON.stringify({ ...payload, action, id }) + '\n');
    });
  }
  async close() {
    if (this.socket && !this.socket.destroyed) {
      try { await this.request('restore'); } finally { this.socket?.end(); }
    }
  }
}
module.exports = { GpuControl };
