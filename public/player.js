import {NativeDS} from './native-ds.js';
let initialized = false, started = false, config, objectUrls = [], paused = false, native = null;
const parentOrigin = location.origin;
const send = (type, data = {}) => parent.postMessage({channel:'retro-player',type,...data},parentOrigin);
const emu = () => window.EJS_emulator;
const manager = () => emu()?.gameManager;
const objectUrl = blob => { const url = URL.createObjectURL(blob); objectUrls.push(url); return url; };
function error(message) { send('error',{message}); }
function clearInputs() { for (let index = 0; index < 24; index++) manager()?.simulateInput(0,index,0); }
function layout(value) {
  if (!started || config.game.system !== 'nds') return;
  const gm = manager(); const raw = gm.getCoreOptions();
  // Option names and values vary across cores. Apply only values advertised by this core.
  const label = { vertical:['top/bottom','Top/Bottom','top-bottom','vertical'], horizontal:['left/right','Left/Right','left-right','horizontal'], top:['top only','Top Only','top','Top'], bottom:['bottom only','Bottom Only','bottom','Bottom'] }[value] || [];
  const options = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
  for (const [key, option] of Object.entries(options || {})) {
    if (!/screen.*layout|screens.*layout/i.test(key)) continue;
    const values = Array.isArray(option) ? option : option?.values || option?.options || [];
    const entries = Array.isArray(values) ? values.map(item => typeof item === 'string' ? item : item.value) : Object.keys(values);
    const selected = entries.find(item => label.some(match => String(item).toLowerCase() === match.toLowerCase()));
    if (selected) gm.setVariable(key,selected);
  }
  // Current libretro cores expose the same layout options through their text interface.
  if (!Object.keys(options || {}).length) {
    const mapping = config.core.startsWith('desmume') ? {vertical:'top/bottom',horizontal:'left/right',top:'top only',bottom:'bottom only'} : {vertical:'Top/Bottom',horizontal:'Left/Right',top:'Top Only',bottom:'Bottom Only'};
    gm.setVariable(config.core.startsWith('desmume') ? 'desmume_screens_layout' : 'melonds_screen_layout',mapping[value]);
  }
  setTimeout(() => emu()?.handleResize?.(),100);
}
function sharp(value) { const canvas = document.querySelector('canvas'); if (canvas) canvas.style.imageRendering = value ? 'pixelated' : 'auto'; }
function volume(value) {
  const emulator = emu();
  if (emulator?.setVolume) emulator.setVolume(value);
  else if (emulator?.frontend?.setVolume) emulator.frontend.setVolume(value);
}
async function persist() {
  const gm = manager(); if (!gm) return;
  gm.saveSaveFiles();
  await new Promise((resolve,reject) => gm.FS.syncfs(false,error => error ? reject(error) : resolve()));
}
function sram() { const gm = manager(); gm.saveSaveFiles(); const bytes = gm.getSaveFile(); return bytes ? bytes.slice().buffer : null; }
async function init(data) {
  if (initialized) return; initialized = true; config = data;
  if (data.core === 'melonds-native') {
    native = await NativeDS.create(data); started = true; send('ready',{supportsStates:true}); return;
  }
  const is3ds = data.game.system === '3ds';
  if (is3ds && (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function')) return error('3DS에 필요한 멀티스레드 환경을 사용할 수 없어요.');
  const root = is3ds ? '/engine/next/' : '/engine/stable/';
  window.EJS_player = '#game'; window.EJS_core = data.core; window.EJS_controlScheme = is3ds ? 'nds' : data.game.system;
  // Blob-backed ROMs stay on this device and never go through the engine proxy.
  window.EJS_gameUrl = objectUrl(data.blob);
  const filename = data.game.filename.replace(/\.3ds$/i,'.cci');
  const ext = filename.split('.').pop().toLowerCase();
  window.EJS_gameName = `${data.game.id}.${ext}`;
  window.EJS_gameID = parseInt(data.game.id.slice(0,12),16);
  window.EJS_pathtodata = root;
  window.EJS_threads = is3ds;
  window.EJS_startOnLoaded = true;
  window.EJS_noAutoFocus = false;
  window.EJS_language = 'en-US'; window.EJS_disableAutoLang = false;
  window.EJS_color = '#a3b5ff'; window.EJS_backgroundColor = '#090b10'; window.EJS_volume = data.settings.volume;
  window.EJS_disableDatabases = true;
  window.EJS_hideSettings = true;
  window.EJS_defaultControls = {0:{},1:{},2:{},3:{}};
  for (let index=0;index<30;index++) window.EJS_defaultControls[0][index] = {value:'',value2:''};
  window.EJS_Buttons = {playPause:false,restart:false,mute:false,settings:false,fullscreen:false,saveState:false,loadState:false,screenRecord:false,gamepad:false,cheat:false,volume:false,saveSavFiles:false,loadSavFiles:false,exitEmulation:false,screenshot:false};
  window.EJS_VirtualGamepadSettings = [{type:'button',text:'',id:'retro-hidden',location:'left',input_value:0,css:{display:'none'}}];
  window.EJS_defaultOptions = {shader:data.settings.sharp ? 'disabled' : 'disabled', 'retroarch_core':data.core, webgl2Enabled:'enabled', ejs_threads:is3ds ? 'enabled' : 'disabled', 'virtual-gamepad':'disabled'};
  if (data.sram) {
    window.EJS_gameParentUrl = objectUrl(new Blob([new Uint8Array(data.sram)]));
  }
  const bios = data.assets.filter(asset => data.core === 'melonds' ? ['bios7.bin','bios9.bin','firmware.bin'].includes(asset.id) : data.game.system === 'gba' ? asset.id === 'gba_bios.bin' : false);
  if (bios.length) {
    window.EJS_externalFiles = Object.fromEntries(bios.map(asset => [`/system/${asset.id}`,objectUrl(asset.blob)]));
  }
  window.EJS_ready = () => {
    const instance = emu();
    instance.controls = {0:{},1:{},2:{},3:{}};
    instance.gamepadSelection = ['', '', '', ''];
    instance.on?.('start-error',() => error('게임을 실행하지 못했어요. ROM과 BIOS 파일을 확인해주세요.'));
  };
  window.EJS_onGameStart = () => {
    started = true; paused = false;
    const instance = emu(), gm = manager();
    instance.controls = {0:{},1:{},2:{},3:{}}; instance.gamepadSelection = ['', '', '', ''];
    // Prevent the engine's stored controller profile from competing with RETRO's input manager.
    if (instance.gamepadEvent) instance.gamepadEvent = () => {};
    try {
      if (data.sram?.byteLength) { gm.FS.writeFile(gm.getSaveFilePath(),new Uint8Array(data.sram)); gm.loadSaveFiles(); gm.restart(); }
      gm.setFastForwardRatio(2); layout(data.settings.layout); sharp(data.settings.sharp); volume(data.settings.volume);
      send('ready',{supportsStates:gm.supportsStates()});
    } catch (cause) { error(`실행 초기화 실패: ${cause.message}`); }
  };
  const script = document.createElement('script'); script.src = root + 'loader.js';
  if (is3ds) script.type = 'module';
  script.onerror = () => error('실행 엔진을 내려받지 못했어요. 네트워크 연결을 확인해주세요.'); document.head.append(script);
  let lastProgress = '';
  const progress = setInterval(() => {
    if (started) { clearInterval(progress); return; }
    const text = document.querySelector('.ejs_loading_text,.ejs_start_button')?.textContent || emu()?.textElem?.textContent || emu()?.frontend?.textElem?.textContent;
    if (text && text !== lastProgress) { lastProgress = text; send('progress',{message:text}); }
    if (emu()?.failedToStart) { clearInterval(progress); error('엔진이 시작되지 않았어요. 다른 실행 엔진이나 게임 파일을 선택해주세요.'); }
  },500);
}
window.addEventListener('message',async event => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== 'retro-host') return;
  const data = event.data;
  try {
    if (data.command === 'init') { await init(data); return; }
    if (!started) throw new Error('실행 엔진이 아직 준비되지 않았어요.');
    if (native) {const result = await native.command(data);if(data.requestId)send('response',{requestId:data.requestId,result});return;}
    const gm = manager(), instance = emu(); let result;
    switch (data.command) {
      case 'input': gm.simulateInput(0,data.index,data.value); break;
      case 'pause': paused = data.paused; clearInputs(); gm.toggleMainLoop(paused ? 0 : 1); break;
      case 'reset': clearInputs(); gm.restart(); break;
      case 'volume': volume(data.volume); break;
      case 'speed': gm.setFastForwardRatio(data.speed); gm.toggleFastForward(data.speed === 1 ? 0 : 1); break;
      case 'layout': layout(data.layout); break;
      case 'sharp': sharp(data.sharp); break;
      case 'sram': result = sram(); await persist(); break;
      case 'persist': await persist(); break;
      case 'importSram': {
        const bytes = new Uint8Array(data.bytes); if (!bytes.length) throw new Error('세이브 파일이 비어 있어요.');
        gm.FS.writeFile(gm.getSaveFilePath(),bytes); gm.loadSaveFiles(); gm.restart(); await persist(); break;
      }
      case 'getState': {
        if (!gm.supportsStates()) throw new Error('이 엔진에서는 빠른 저장을 지원하지 않아요.');
        result = new Uint8Array(await gm.getState()).slice().buffer; break;
      }
      case 'loadState': {
        if (!gm.supportsStates()) throw new Error('이 엔진에서는 빠른 저장을 지원하지 않아요.');
        gm.loadState(new Uint8Array(data.bytes)); break;
      }
      case 'screenshot': {
        const canvas = instance.canvas || document.querySelector('canvas'); if (!canvas) throw new Error('화면이 아직 준비되지 않았어요.');
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png')); if (!blob) throw new Error('화면을 캡처하지 못했어요.');
        const small = document.createElement('canvas'); small.width = 320; small.height = Math.round(canvas.height / canvas.width * 320); small.getContext('2d').drawImage(canvas,0,0,small.width,small.height);
        result = {bytes:await blob.arrayBuffer(),preview:small.toDataURL('image/webp',.7)}; break;
      }
      default: throw new Error('알 수 없는 플레이어 요청이에요.');
    }
    if (data.requestId) send('response',{requestId:data.requestId,result});
  } catch (cause) {
    if (data.requestId) send('response',{requestId:data.requestId,error:cause.message});
    else if (data.command === 'init') error(cause.message);
  }
});
window.addEventListener('keydown',event => {
  if (event.repeat) return;
  if (event.code === 'Space' || event.code === 'F5') { event.preventDefault(); send('hotkey',{key:event.code === 'Space' ? 'pause' : 'save'}); return; }
  const keys = Object.values(config?.settings?.keyboard || {a:'KeyX',b:'KeyZ',x:'KeyS',y:'KeyA',l:'KeyQ',r:'KeyW',select:'ShiftRight',start:'Enter',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'});
  if (keys.includes(event.code)) event.preventDefault();
  send('key',{event:'keydown',code:event.code,repeat:event.repeat});
});
window.addEventListener('keyup',event => send('key',{event:'keyup',code:event.code}));
window.addEventListener('blur',() => { if (started) clearInputs(); send('blur'); });
window.addEventListener('error',event => { if (event.message && !/ResizeObserver/.test(event.message)) error(`실행 오류: ${event.message}`); });
window.addEventListener('unhandledrejection',event => {
  const message = String(event.reason?.message || event.reason);
  // Optional wake lock and update checks must not stop an otherwise running core.
  if (/wake.?lock|Failed to fetch/i.test(message) && !emu()?.failedToStart) { event.preventDefault(); console.warn(message); return; }
  error(`실행 오류: ${message}`);
});
window.addEventListener('pagehide',() => objectUrls.forEach(url => URL.revokeObjectURL(url)));
