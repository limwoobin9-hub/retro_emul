export const BUTTONS = [
  { id: 8, label: 'A', key: 'KeyX', button: 1 },
  { id: 0, label: 'B', key: 'KeyZ', button: 0 },
  { id: 9, label: 'X', key: 'KeyS', button: 3 },
  { id: 1, label: 'Y', key: 'KeyA', button: 2 },
  { id: 10, label: 'L', key: 'KeyQ', button: 4 },
  { id: 11, label: 'R', key: 'KeyW', button: 5 },
  { id: 2, label: 'SELECT', key: 'ShiftRight', button: 8 },
  { id: 3, label: 'START', key: 'Enter', button: 9 },
  { id: 4, label: '↑', key: 'ArrowUp', button: 12 },
  { id: 5, label: '↓', key: 'ArrowDown', button: 13 },
  { id: 6, label: '←', key: 'ArrowLeft', button: 14 },
  { id: 7, label: '→', key: 'ArrowRight', button: 15 },
  { id: 12, label: 'ZL', key: 'KeyE', button: 6 },
  { id: 13, label: 'ZR', key: 'KeyR', button: 7 }
];
export const padDefault = () => Object.fromEntries(BUTTONS.map(item => [item.id, { type: 'button', index: item.button }]));
export const keyDefault = () => Object.fromEntries(BUTTONS.map(item => [item.id, item.key]));
export function keyLabel(code) { return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ShiftRight', 'R Shift').replace('ShiftLeft', 'L Shift'); }
export function bindingLabel(binding) { return !binding ? '미지정' : binding.type === 'button' ? `버튼 ${binding.index + 1}` : `축 ${binding.index + 1} ${binding.sign > 0 ? '+' : '−'}`; }
export function padValues(pad, profile, deadzone = .22, stickToDpad = true, system = 'nds') {
  const result = new Map();
  for (const item of BUTTONS) {
    if (system === 'gba' && [1, 9, 12, 13].includes(item.id)) continue;
    if (system !== '3ds' && [12, 13].includes(item.id)) continue;
    const binding = profile[item.id];
    const active = binding?.type === 'button' ? (pad.buttons[binding.index]?.value || 0) > .5 : binding?.type === 'axis' ? (pad.axes[binding.index] || 0) * binding.sign > Math.max(.5, deadzone) : false;
    if (active) result.set(item.id, 1);
  }
  if (stickToDpad && system !== '3ds') {
    const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    if (x < -deadzone) result.set(6, 1); if (x > deadzone) result.set(7, 1);
    if (y < -deadzone) result.set(4, 1); if (y > deadzone) result.set(5, 1);
  }
  if (system === '3ds') {
    // Libretro analog inputs use signed 16-bit magnitude, represented as separate directions.
    for (const [axis, positive, negative] of [[0, 16, 17], [1, 18, 19], [2, 20, 21], [3, 22, 23]]) {
      const value = Math.max(-1, Math.min(1, pad.axes[axis] || 0));
      if (Math.abs(value) > deadzone) result.set(value > 0 ? positive : negative, Math.round(Math.abs(value) * 32767));
    }
  }
  return result;
}
export class InputManager {
  constructor(send, changed) {
    this.send = send; this.changed = changed; this.enabled = false; this.system = 'nds';
    this.keyboard = keyDefault(); this.profiles = {}; this.activePad = null;
    this.keys = new Set(); this.touch = new Set(); this.sent = new Map();
    this.deadzone = .22; this.stickToDpad = true; this.capture = null; this.captureBlocked = new Set();
    this.lastSignature = ''; this.preferred = null;
    window.addEventListener('keydown', event => this.handleKey(event));
    window.addEventListener('keyup', event => this.handleKey(event));
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    const tick = () => { this.tick(); this.raf = requestAnimationFrame(tick); }; this.raf = requestAnimationFrame(tick);
  }
  handleKey(event) {
    if (event.type === 'keydown' && event.repeat) return;
    if (this.capture?.kind === 'key' && event.type === 'keydown') {
      event.preventDefault?.(); this.finishCapture(event.code); return;
    }
    const target = event.target;
    if (target?.matches?.('input,select,textarea,[contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    if (Object.values(this.keyboard).includes(event.code)) {
      if (this.enabled) event.preventDefault?.();
      if (event.type === 'keydown') this.keys.add(event.code); else this.keys.delete(event.code);
    }
  }
  tick() {
    const pads = Array.from(navigator.getGamepads?.() || []).filter(pad => pad?.connected);
    const signature = pads.map(pad => `${pad.index}:${pad.id}`).join('|');
    if (signature !== this.lastSignature) { this.lastSignature = signature; this.changed(pads); }
    this.activePad = pads.find(pad => pad.id === this.preferred) || pads[0] || null;
    if (this.capture?.kind === 'pad' && this.activePad) {
      const pad = this.activePad;
      for (let i = 0; i < pad.buttons.length; i++) {
        const code = `b${i}`;
        if ((pad.buttons[i]?.value || 0) <= .5) this.captureBlocked.delete(code);
        else if (!this.captureBlocked.has(code)) { this.finishCapture({ type: 'button', index: i }); break; }
      }
      if (this.capture) for (let i = 0; i < pad.axes.length; i++) {
        const code = `a${i}`;
        if (Math.abs(pad.axes[i]) < .3) this.captureBlocked.delete(code);
        else if (Math.abs(pad.axes[i]) > .7 && !this.captureBlocked.has(code)) { this.finishCapture({ type: 'axis', index: i, sign: Math.sign(pad.axes[i]) }); break; }
      }
    }
    const values = new Map();
    if (this.enabled && !document.hidden && !document.querySelector('dialog[open]')) {
      for (const item of BUTTONS) if (this.keys.has(this.keyboard[item.id]) || this.touch.has(item.id)) values.set(item.id, 1);
      if (this.activePad && !this.capture) {
        const profile = this.profiles[this.activePad.id] || padDefault();
        for (const [key, value] of padValues(this.activePad, profile, this.deadzone, this.stickToDpad, this.system)) values.set(key, Math.max(values.get(key) || 0, value));
      }
    }
    for (const key of new Set([...this.sent.keys(), ...values.keys()])) {
      const value = values.get(key) || 0;
      if (value !== (this.sent.get(key) || 0)) this.send(key, value);
    }
    this.sent = values;
  }
  release() {
    this.keys.clear(); this.touch.clear();
    for (const key of this.sent.keys()) this.send(key, 0);
    this.sent.clear();
  }
  startCapture(kind, id, callback) {
    this.release(); this.cancelCapture();
    this.capture = { kind, id, callback }; this.captureBlocked.clear();
    const pad = this.activePad;
    if (pad) {
      pad.buttons.forEach((button, index) => { if (button.value > .5) this.captureBlocked.add(`b${index}`); });
      pad.axes.forEach((value, index) => { if (Math.abs(value) > .3) this.captureBlocked.add(`a${index}`); });
    }
    this.captureTimer = setTimeout(() => this.finishCapture(null), 15000);
  }
  finishCapture(value) { const capture = this.capture; this.cancelCapture(); capture?.callback(value); }
  cancelCapture() { clearTimeout(this.captureTimer); this.capture = null; }
}
