// Thin WebSocket client for the relay in server.js
export class Net {
  constructor() { this.ws = null; this.handlers = {}; this.id = null; this.connected = false; }
  on(t, fn) { this.handlers[t] = fn; }
  connect(room, name) {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`));
      const to = setTimeout(() => reject(new Error('timeout')), 5000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { this.id = m.id; this.connected = true; clearTimeout(to); resolve(m); }
        this.handlers[m.t]?.(m);
      };
      ws.onclose = () => { this.connected = false; this.handlers.close?.(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('connection failed')); };
    });
  }
  send(o) { if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { this.ws?.close(); this.connected = false; }
}
