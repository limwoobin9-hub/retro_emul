import { SYSTEMS, MAX_ROM, extension, cleanName, formatSize, detectSystem, validateRom, hashBytes, dbGet, dbAll, dbPut, addGame, deleteGame, readSettings, writeSettings, database } from './model.js';
import { BUTTONS, InputManager, padDefault, keyDefault, keyLabel, bindingLabel, padValues } from './controls.js';
import { unzipSync } from './vendor/fflate.js';

const $ = id => document.getElementById(id);
const paths = {
  play:'m8 5 11 7-11 7z', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  plus:'M12 5v14 M5 12h14', folder:'M3 7h6l2-3h9a1 1 0 0 1 1 1v14H3z M3 7v-2h6',
  gamepad:'M7 7h10a4 4 0 0 1 4 3l1 7a2 2 0 0 1-3 2l-3-3H8l-3 3a2 2 0 0 1-3-2l1-7a4 4 0 0 1 4-3z M6 10v4 M4 12h4 M16 10h.01 M19 13h.01',
  settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  pause:'M8 5v14 M16 5v14', reset:'M3 10a9 9 0 1 1 1 7 M3 4v6h6',
  volume:'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14',
  mute:'M3 9h4l5-4v14l-5-4H3z M17 9l5 6 M22 9l-5 6',
  save:'M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',
  history:'M3 4v6h6 M3 10a9 9 0 1 1 1 7 M12 7v5l3 2',
  camera:'M3 7h5l2-3h4l2 3h5v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  fullscreen:'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  expand:'M8 3H3v5 M3 3l7 7 M16 21h5v-5 M21 21l-7-7',
  search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M15 15l6 6',
  close:'M6 6l12 12 M18 6 6 18', upload:'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',
  more:'M5 12h.01 M12 12h.01 M19 12h.01', trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.play}"/></svg>`; }
function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(element => { if (!element.querySelector('svg')) element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon)); }); }
icons();
const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function toast(message, error = false) {
  const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.textContent = message;
  $('toasts').append(element); setTimeout(() => element.remove(), error ? 7500 : 4000);
}
function guard(fn) { return async (...args) => { try { return await fn(...args); } catch (error) { console.warn(error); toast(error.message || '처리하지 못했어요. 다시 시도해주세요.', true); } }; }
let settings = { dsCore:'melonds-native', layout:'vertical', sharp:true, touch:'auto', pauseHidden:true, volume:.7, deadzone:.22, stickDpad:true, ...readSettings() };
let games = [], filter = 'all', query = '', view = 'play', current = null, frame = null, core = null, ready = false, paused = false, muted = false, speed = 1, importing = false, launching = false;
let requestCounter = 0, requests = new Map(), startupTimer, flushPromise = null, supportsStates = true;
const input = new InputManager((index, value) => notify('input', { index, value }), padsChanged);
input.keyboard = settings.keyboard || keyDefault(); input.profiles = settings.profiles || {}; input.deadzone = settings.deadzone; input.stickToDpad = settings.stickDpad; input.preferred = settings.preferredPad;
function saveSettings() {
  settings.keyboard = input.keyboard; settings.profiles = input.profiles; settings.preferredPad = input.preferred;
  try { writeSettings(settings); } catch { toast('설정 저장 공간이 부족해요.', true); }
}
function notify(command, data = {}) { frame?.contentWindow?.postMessage({ channel:'retro-host', command, ...data }, location.origin); }
function ask(command, data = {}, timeout = 20000) {
  if (!frame) return Promise.reject(new Error('먼저 게임을 실행해주세요.'));
  const requestId = ++requestCounter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(requestId); reject(new Error('게임의 응답이 늦어요. 다시 시도해주세요.')); }, timeout);
    requests.set(requestId, { resolve, reject, timer }); notify(command, { requestId, ...data });
  });
}
function setSession(text, playing = false) { $('sessionText').textContent = text; $('sessionPill').classList.toggle('playing', playing); }
function toolbar(enabled) {
  ['pauseBtn','resetBtn','soundBtn','speedBtn','saveBtn','loadBtn','shotBtn'].forEach(id => { $(id).disabled = !enabled; });
  $('saveBtn').disabled = !enabled || !supportsStates;
}
function updateTouch() {
  const visible = settings.touch === 'on' || (settings.touch === 'auto' && matchMedia('(pointer:coarse)').matches);
  $('touchControls').hidden = !(visible && current && ready);
  $('touchControls').querySelectorAll('[data-input="9"],[data-input="1"]').forEach(button => button.hidden = current?.system === 'gba');
}
function setView(next) {
  view = next; document.body.classList.toggle('library-view', next === 'library');
  $('navPlay').classList.toggle('active', next === 'play'); $('navLibrary').classList.toggle('active', next === 'library');
  $('pageTitle').textContent = next === 'play' ? '플레이' : '라이브러리';
  $('mainTitle').textContent = next === 'play' ? '다시, 플레이.' : '나만의 컬렉션.';
  $('mainDescription').textContent = next === 'play' ? '익숙한 게임, 편안한 자리. 파일을 열고 시작하세요.' : '다시 만나고 싶은 게임을 한곳에 모아두세요.';
  if (next === 'library' && ready && !paused) guard(() => togglePause(true))();
}
function renderGames() {
  $('libraryCount').textContent = games.length; $('gameCount').textContent = games.length;
  for (const type of ['all',...Object.keys(SYSTEMS)]) document.querySelector(`[data-count="${type}"]`).textContent = type === 'all' ? games.length : games.filter(game => game.system === type).length;
  const shown = games.filter(game => (filter === 'all' || game.system === filter) && `${game.name} ${game.filename}`.toLowerCase().includes(query));
  const sort = $('sortGames').value;
  shown.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name,'ko') : sort === 'added' ? b.added - a.added : (b.lastPlayed || b.added) - (a.lastPlayed || a.added));
  const grid = $('gameGrid'); grid.replaceChildren();
  for (const game of shown) {
    const system = SYSTEMS[game.system], style = game.system === '3ds' ? 'three' : game.system;
    const card = document.createElement('article'); card.className = 'game-card';
    card.innerHTML = `<button class="game-open" aria-label="${escape(game.name)} 실행"><div class="game-cover ${style}">${game.screenshot ? `<img src="${game.screenshot}" alt="${escape(game.name)} 최근 실행 화면" loading="lazy">` : `<span class="game-monogram">${escape(game.name.slice(0,2).toUpperCase())}</span>`}<span class="console-badge ${style}">${system.short}</span></div><div class="game-body"><strong>${escape(game.name)}</strong><p>${formatSize(game.size)}<span> · ${game.lastPlayed ? new Date(game.lastPlayed).toLocaleDateString('ko-KR',{month:'short',day:'numeric'}) : '새로 추가됨'}</span></p></div></button><button class="icon-button game-menu" aria-label="${escape(game.name)} 삭제" title="게임 삭제">${icon('trash')}</button>`;
    card.querySelector('.game-open').addEventListener('click', guard(() => playGame(game)));
    card.querySelector('.game-menu').addEventListener('click', guard(async () => {
      if (!await confirm('게임을 삭제할까요?', `${game.name}과 이 게임의 저장 파일이 브라우저에서 삭제돼요.`, '삭제')) return;
      if (current?.id === game.id) await stopGame();
      await deleteGame(game.id); games = games.filter(entry => entry.id !== game.id); renderGames();
    })); grid.append(card);
  }
  $('libraryEmpty').hidden = shown.length > 0;
  $('libraryEmpty').querySelector('strong').textContent = games.length ? '일치하는 게임이 없어요' : '첫 게임을 기다리고 있어요';
  $('libraryEmpty').querySelector('p').textContent = games.length ? '다른 기종이나 검색어를 선택해보세요.' : '한 번 불러오면 다음엔 여기서 바로 이어갈 수 있어요.';
}
async function importFiles(files) {
  if (importing) return toast('파일을 추가하고 있어요. 잠시 기다려주세요.');
  importing = true; $('addTop').disabled = true;
  const added = [], failures = [];
  try {
    for (const file of files) {
      try {
        if (file.size > MAX_ROM) throw new Error(`${file.name}: 512 MB보다 큰 파일이에요.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let entries;
        if (extension(file.name) === 'zip') {
          let total = 0, count = 0;
          entries = Object.entries(unzipSync(bytes, { filter(entry) {
            const system = detectSystem(entry.name);
            if (!system || entry.name.startsWith('__MACOSX/')) return false;
            total += entry.originalSize; count++;
            if (entry.originalSize > MAX_ROM || total > MAX_ROM || count > 64) throw new Error('압축을 푼 게임의 합계가 512 MB를 넘거나 파일이 너무 많아요.');
            return true;
          } }));
          if (!entries.length) throw new Error('ZIP 안에 지원하는 게임 파일이 없어요.');
        } else entries = [[file.name, bytes]];
        for (const [name, data] of entries) {
          const system = detectSystem(name,data);
          if (!system) {
            if (extension(name) === 'cia') throw new Error('CIA는 설치용 파일이에요. CCI·CXI·3DSX 실행 파일을 선택해주세요.');
            throw new Error(`${name}: DS·GBA·3DS ROM인지 확인할 수 없어요.`);
          }
          validateRom(name,data,system);
          const id = await hashBytes(data);
          if (games.some(game => game.id === id)) { toast(`${cleanName(name)}은 이미 추가돼 있어요.`); continue; }
          const game = { id, system, name:cleanName(name), filename:name.split(/[\\/]/).pop(), size:data.length, added:Date.now(), lastPlayed:0 };
          await addGame(game,new Blob([data])); games.push(game); added.push(game);
        }
      } catch (error) { failures.push(error.message); }
    }
    renderGames(); if (added.length) toast(`${added.length}개 게임을 추가했어요.`);
    if (failures.length) toast(failures.join('\n'),true);
    if (added.length === 1 && !current) await playGame(added[0]);
    else if (added.length > 1) setView('library');
  } finally { importing = false; $('addTop').disabled = false; $('romInput').value = ''; }
}
async function stopGame() {
  input.enabled = false; input.release(); clearTimeout(startupTimer);
  if (ready) { try { await flushSram(); } catch (error) { toast(`세이브를 보관하지 못했어요: ${error.message}`,true); throw error; } }
  for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('게임 실행이 종료됐어요.')); } requests.clear();
  frame?.remove(); frame = null; current = null; ready = false; paused = false;
  $('runnerMount').hidden = true; $('emptyStage').hidden = false; $('loadingOverlay').hidden = true;
  $('playingTitle').textContent = '게임을 선택해주세요'; $('playingSystem').hidden = true;
  $('playerCard').classList.remove('running'); toolbar(false); updateTouch(); setSession('플레이 대기');
}
async function playGame(game) {
  if (launching) return;
  const chosenCore = game.system === 'nds' ? settings.dsCore : SYSTEMS[game.system].cores[0];
  if (current?.id === game.id && ready && core === chosenCore) { setView('play'); if (paused) await togglePause(false); return; }
  launching = true;
  try {
    if (game.system === '3ds') {
      if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw new Error('3DS는 멀티스레드를 지원하는 브라우저와 별도 창에서 실행해주세요.');
      const canvas = document.createElement('canvas'); if (!canvas.getContext('webgl2')) throw new Error('이 기기에서는 WebGL2를 사용할 수 없어 3DS를 실행할 수 없어요.');
    }
    const rom = await dbGet('roms',game.id); if (!rom?.blob) throw new Error('게임 파일이 없어요. ROM을 다시 추가해주세요.');
    const assets = await dbAll('assets');
    if (chosenCore === 'melonds' && !['bios7.bin','bios9.bin','firmware.bin'].every(name => assets.some(asset => asset.id === name))) {
      openDialog('settingsDialog'); throw new Error('melonDS에는 BIOS 3개가 필요해요. 설정에서 추가하거나 DeSmuME를 선택해주세요.');
    }
    await stopGame(); current = game; core = chosenCore; supportsStates = true; setView('play');
    $('playingTitle').textContent = game.name; $('playingSystem').textContent = SYSTEMS[game.system].short; $('playingSystem').className = `console-badge ${game.system === '3ds' ? 'three' : game.system}`; $('playingSystem').hidden = false;
    $('emptyStage').hidden = true; $('runnerMount').hidden = false; $('loadingOverlay').hidden = false;
    $('loadingTitle').textContent = `${SYSTEMS[game.system].short} 게임 준비 중`;
    $('loadingDescription').textContent = game.system === '3ds' ? 'Azahar 엔진을 불러오고 있어요. 3DS는 게임과 기기에 따라 실행 결과가 달라요.' : '처음에는 실행 엔진 다운로드에 시간이 걸릴 수 있어요.';
    setSession('불러오는 중');
    frame = document.createElement('iframe'); frame.title = `${game.name} 게임 화면`; frame.allow = 'gamepad; fullscreen; autoplay'; frame.src = '/player.html';
    const save = await dbGet('saves',`${game.id}:${core}:sram`);
    const backup = await dbGet('saves',`${game.id}:${core}:files`);
    frame.addEventListener('load', () => notify('init', { game, blob:rom.blob, core, assets, sram:save?.bytes || null, nativeFiles:backup?.files || [], settings } ), { once:true });
    $('runnerMount').replaceChildren(frame);
    startupTimer = setTimeout(() => handleEngineError('실행 응답을 받지 못했어요. 다른 DS 엔진을 선택하거나 게임 파일을 확인해주세요.'),120000);
  } finally { launching = false; }
}
function handleEngineError(message) {
  clearTimeout(startupTimer); ready = false; input.enabled = false; input.release(); toolbar(false); setSession('실행 확인 필요');
  $('loadingOverlay').hidden = true; toast(message,true);
}
window.addEventListener('message', guard(async event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== 'retro-player') return;
  const message = event.data;
  if (message.requestId) {
    const request = requests.get(message.requestId); if (!request) return;
    clearTimeout(request.timer); requests.delete(message.requestId);
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result); return;
  }
  if (message.type === 'ready') {
    clearTimeout(startupTimer); ready = true; paused = false; muted = false; speed = 1;
    input.system = current.system; input.enabled = true; supportsStates = message.supportsStates;
    toolbar(true); $('loadingOverlay').hidden = true; $('playerCard').classList.add('running'); setSession('플레이 중',true); updateTouch();
    current.lastPlayed = Date.now(); await dbPut('games',current); renderGames();
    $('pauseBtn').innerHTML = icon('pause'); $('soundBtn').innerHTML = icon('volume'); $('speedBtn').textContent = '1×';
    if (current.system === '3ds') toast('3DS는 실험적 지원이에요. 실행 속도와 호환성을 확인해주세요.');
  } else if (message.type === 'error') handleEngineError(message.message);
  else if (message.type === 'progress') $('loadingDescription').textContent = message.message;
  else if (message.type === 'key') input.handleKey({ type:message.event,code:message.code,repeat:message.repeat });
  else if (message.type === 'blur') input.release();
  else if (message.type === 'hotkey') {
    if (message.key === 'pause') await togglePause();
    if (message.key === 'save') await saveState(1);
  }
}));
async function togglePause(value) {
  if (!ready) return; input.release(); paused = typeof value === 'boolean' ? value : !paused;
  await ask('pause',{paused}); input.enabled = !paused;
  $('pauseBtn').innerHTML = icon(paused ? 'play' : 'pause'); $('pauseBtn').setAttribute('aria-label',paused ? '플레이 재개' : '일시 정지'); $('pauseBtn').title = paused ? '플레이 재개' : '일시 정지';
  setSession(paused ? '일시 정지' : '플레이 중',!paused);
  if (paused) await flushSram();
}
async function flushSram() {
  if (flushPromise) return flushPromise;
  if (!ready || !current) return;
  const game = current, engine = core;
  flushPromise = (async () => {
    const result = await ask('sram');
    const bytes = result?.files ? result.bytes : result;
    if (bytes?.byteLength) await dbPut('saves',{ id:`${game.id}:${engine}:sram`, gameId:game.id, core:engine, kind:'sram', bytes, date:Date.now() });
    if (result?.files) await dbPut('saves',{id:`${game.id}:${engine}:files`,gameId:game.id,core:engine,kind:'files',files:result.files,date:Date.now()});
  })();
  try { await flushPromise; } finally { flushPromise = null; }
}
async function saveState(slot) {
  if (!ready || !current || !supportsStates) throw new Error('이 엔진에서는 빠른 저장을 사용할 수 없어요.');
  const game = current, engine = core;
  const bytes = await ask('getState',{},45000);
  if (!bytes?.byteLength) throw new Error('저장 상태를 만들지 못했어요.');
  await dbPut('saves',{ id:`${game.id}:${engine}:state:${slot}`, gameId:game.id, core:engine, kind:'state', slot, bytes, date:Date.now() });
  await flushSram(); toast(`${slot}번 슬롯에 저장했어요.`); await renderSlots();
}
async function loadState(slot) {
  const record = await dbGet('saves',`${current.id}:${core}:state:${slot}`);
  if (!record) throw new Error('이 슬롯에는 저장된 기록이 없어요.');
  await ask('loadState',{bytes:record.bytes}); toast(`${slot}번 슬롯을 불러왔어요.`);
  $('savesDialog').close(); if (paused) await togglePause(false);
}
function download(blob,name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url),10000);
}
const stateMagic = 'RSTATE01';
async function exportState(slot) {
  const record = await dbGet('saves',`${current.id}:${core}:state:${slot}`); if (!record) throw new Error('저장 기록이 없어요.');
  const meta = new TextEncoder().encode(JSON.stringify({ gameId:current.id,core,date:record.date }));
  const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0,meta.length,true);
  download(new Blob([stateMagic,size,meta,record.bytes]),`${current.name}.${slot}.state`);
}
async function renderSlots() {
  if (!current) return;
  $('saveGameName').textContent = `${current.name} · ${core}`; $('saveSlots').replaceChildren();
  for (let slot = 1; slot <= 3; slot++) {
    const record = await dbGet('saves',`${current.id}:${core}:state:${slot}`);
    const row = document.createElement('div'); row.className = 'save-slot';
    row.innerHTML = `<span class="save-slot-icon">0${slot}</span><div><strong>${record ? `빠른 저장 ${slot}` : '비어 있는 슬롯'}</strong><p>${record ? new Date(record.date).toLocaleString('ko-KR') : '현재 장면을 저장할 수 있어요.'}</p></div><div class="slot-actions"><button data-action="save" ${!supportsStates ? 'disabled' : ''}>저장</button><button data-action="load" ${!record ? 'disabled' : ''}>불러오기</button><button data-action="export" ${!record ? 'disabled' : ''}>↓</button></div>`;
    row.querySelector('[data-action="save"]').onclick = guard(async () => {
      if (record && !await confirm('이 슬롯에 덮어쓸까요?', '기존 빠른 저장을 현재 장면으로 교체해요.','저장')) return;
      await saveState(slot);
    });
    row.querySelector('[data-action="load"]').onclick = guard(() => loadState(slot));
    row.querySelector('[data-action="export"]').onclick = guard(() => exportState(slot)); $('saveSlots').append(row);
  }
}
function openDialog(id) { input.release(); $(id).showModal(); if (id === 'controlsDialog') renderMapping(); }
function confirm(title,body,label='확인') {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title; $('confirmBody').textContent = body; $('confirmYes').textContent = label;
    const dialog = $('confirmDialog'); dialog.returnValue = ''; dialog.showModal();
    $('confirmYes').onclick = () => dialog.close('yes'); $('confirmNo').onclick = () => dialog.close('no');
    dialog.addEventListener('close',() => resolve(dialog.returnValue === 'yes'),{once:true});
  });
}
function padsChanged(pads) {
  const pad = pads.find(item => item.id === input?.preferred) || pads[0];
  $('padStatusText').textContent = pad ? '컨트롤러 연결됨' : '컨트롤러 연결'; $('padStatusDot').style.background = pad ? 'var(--success)' : '';
  $('deviceName').textContent = pad ? pad.id : '컨트롤러를 연결해주세요'; $('deviceHint').textContent = pad ? `${pad.mapping === 'standard' ? '표준 매핑' : '사용자 매핑 권장'} · 버튼 ${pad.buttons.length}개 · 스틱 축 ${pad.axes.length}개` : '연결 후 아무 버튼이나 누르면 인식돼요.';
  $('deviceTag').textContent = pad ? '연결됨' : '대기'; $('deviceTag').classList.toggle('good',!!pad);
  $('deviceSelect').replaceChildren();
  if (!pads.length) $('deviceSelect').append(new Option('연결된 컨트롤러 없음',''));
  for (const item of pads) $('deviceSelect').append(new Option(item.id,item.id)); if (pad) $('deviceSelect').value = pad.id;
  if ($('controlsDialog').open) renderMapping();
}
function renderMapping() {
  const pad = input.activePad, profile = pad ? (input.profiles[pad.id] || padDefault()) : padDefault();
  $('mappingRows').replaceChildren();
  for (const item of BUTTONS) {
    const row = document.createElement('div'); row.className = 'mapping-row';
    row.innerHTML = `<strong>${item.label}</strong><button class="mapping-button" data-kind="key">${escape(keyLabel(input.keyboard[item.id] || '미지정'))}</button><button class="mapping-button" data-kind="pad" ${!pad ? 'disabled' : ''}>${bindingLabel(profile[item.id])}</button>`;
    row.querySelectorAll('button').forEach(button => button.onclick = () => {
      const kind = button.dataset.kind; input.cancelCapture(); document.querySelectorAll('.listening').forEach(element => element.classList.remove('listening'));
      button.classList.add('listening'); button.textContent = '입력 대기…'; $('captureNote').textContent = `${item.label}에 사용할 ${kind === 'key' ? '키' : '컨트롤러 버튼 또는 스틱'}를 눌러주세요. (15초)`;
      input.startCapture(kind,item.id,value => {
        if (value) {
          if (kind === 'key') {
            for (const id of Object.keys(input.keyboard)) if (input.keyboard[id] === value) input.keyboard[id] = '';
            input.keyboard[item.id] = value;
          } else {
            const name = pad.id; const next = { ...(input.profiles[name] || padDefault()) };
            for (const id of Object.keys(next)) if (JSON.stringify(next[id]) === JSON.stringify(value)) next[id] = null;
            next[item.id] = value; input.profiles[name] = next;
          }
          saveSettings(); $('captureNote').textContent = `${item.label} 매핑을 저장했어요.`;
        } else $('captureNote').textContent = '입력 시간이 지나서 취소했어요.';
        renderMapping();
      });
    }); $('mappingRows').append(row);
  }
}
setInterval(() => {
  if (!$('controlsDialog').open || !input.activePad) return;
  const active = padValues(input.activePad,input.profiles[input.activePad.id] || padDefault(),input.deadzone,input.stickToDpad,input.system);
  $('mappingRows').querySelectorAll('.mapping-row').forEach((row,index) => row.querySelector('[data-kind="pad"]').classList.toggle('pressed',active.has(BUTTONS[index].id)));
},90);
async function settingsOpen() {
  $('dsCore').value = settings.dsCore; $('screenLayout').value = settings.layout; $('pixelSharp').checked = settings.sharp;
  $('touchMode').value = settings.touch; $('pauseHidden').checked = settings.pauseHidden;
  const available = crossOriginIsolated && typeof SharedArrayBuffer === 'function';
  $('threadsStatus').textContent = available ? '멀티스레드 사용 가능 · 게임별 호환성 확인 필요' : '별도 창과 멀티스레드 지원 브라우저가 필요해요.';
  $('threadsTag').textContent = available ? '사용 가능' : '제한됨'; $('threadsTag').classList.toggle('good',available);
  openDialog('settingsDialog'); await renderBios();
  const estimate = await navigator.storage?.estimate?.(); $('storageValue').textContent = estimate ? `${formatSize(estimate.usage || 0)} / ${formatSize(estimate.quota || 0)}` : '브라우저에서 관리';
}
async function renderBios() {
  const assets = await dbAll('assets'); $('biosList').replaceChildren();
  for (const asset of assets) {
    const chip = document.createElement('span'); chip.className = 'bios-chip'; chip.textContent = asset.id;
    const button = document.createElement('button'); button.textContent = '×'; button.setAttribute('aria-label',`${asset.id} 삭제`);
    button.onclick = guard(async () => {
      const db = await database(); await new Promise((resolve,reject) => { const transaction = db.transaction('assets','readwrite'); transaction.objectStore('assets').delete(asset.id); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
      await renderBios();
    }); chip.append(button); $('biosList').append(chip);
  }
}
for (const id of ['openRom','addTop','addEmpty']) $(id).onclick = () => $('romInput').click();
$('romInput').onchange = guard(event => importFiles(event.target.files));
$('navPlay').onclick = () => setView('play'); $('navLibrary').onclick = () => setView('library');
document.querySelectorAll('[data-system]').forEach(button => button.onclick = () => {
  filter = button.dataset.system; document.querySelectorAll('[data-system]').forEach(element => element.classList.toggle('active',element === button)); setView('library'); renderGames();
});
$('searchGames').oninput = event => { query = event.target.value.toLowerCase().trim(); renderGames(); }; $('sortGames').onchange = renderGames;
for (const id of ['padStatus','controlsSide']) $(id).onclick = () => openDialog('controlsDialog');
$('settingsSide').onclick = guard(settingsOpen); $('helpBtn').onclick = () => openDialog('helpDialog');
const settingsTop = document.createElement('button'); settingsTop.className = 'icon-button'; settingsTop.setAttribute('aria-label','설정'); settingsTop.title = '설정'; settingsTop.id = 'settingsTop'; settingsTop.innerHTML = icon('settings'); settingsTop.onclick = guard(settingsOpen); $('padStatus').after(settingsTop);
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('close',() => { input.cancelCapture(); input.release(); });
  dialog.addEventListener('click',event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
});
$('deviceSelect').onchange = event => { input.preferred = event.target.value; input.activePad = Array.from(navigator.getGamepads?.() || []).find(pad => pad?.id === input.preferred); saveSettings(); padsChanged(Array.from(navigator.getGamepads?.() || []).filter(Boolean)); renderMapping(); };
$('resetMapping').onclick = () => { input.keyboard = keyDefault(); if (input.activePad) input.profiles[input.activePad.id] = padDefault(); saveSettings(); renderMapping(); toast('기본 매핑을 복원했어요.'); };
$('deadzone').value = settings.deadzone * 100; $('deadzoneValue').textContent = `${Math.round(settings.deadzone * 100)}%`; $('stickDpad').checked = settings.stickDpad;
$('deadzone').oninput = event => { input.deadzone = settings.deadzone = Number(event.target.value)/100; $('deadzoneValue').textContent = `${event.target.value}%`; saveSettings(); };
$('stickDpad').onchange = event => { input.stickToDpad = settings.stickDpad = event.target.checked; saveSettings(); };
$('dsCore').onchange = event => { settings.dsCore = event.target.value; saveSettings(); if (ready && current.system === 'nds') toast('다시 시작 버튼을 누르면 선택한 엔진으로 실행돼요.'); };
$('screenLayout').onchange = event => { settings.layout = event.target.value; saveSettings(); notify('layout',{layout:settings.layout}); };
$('pixelSharp').onchange = event => { settings.sharp = event.target.checked; saveSettings(); notify('sharp',{sharp:settings.sharp}); };
$('touchMode').onchange = event => { settings.touch = event.target.value; saveSettings(); updateTouch(); };
$('pauseHidden').onchange = event => { settings.pauseHidden = event.target.checked; saveSettings(); };
$('persistStorage').onclick = guard(async () => { const persisted = await navigator.storage?.persist?.(); toast(persisted ? '브라우저가 보관 유지 요청을 허용했어요.' : '이 브라우저가 보관 유지 요청을 허용하지 않았어요. 파일 내보내기는 계속 사용할 수 있어요.'); });
$('addBios').onclick = () => $('biosInput').click();
$('biosInput').onchange = guard(async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 32*1024*1024) throw new Error('BIOS 파일은 32 MB 이하로 선택해주세요.');
  const bytes = new Uint8Array(await file.arrayBuffer()); const entries = extension(file.name) === 'zip' ? Object.entries(unzipSync(bytes,{filter:entry => ['bios7.bin','bios9.bin','firmware.bin','gba_bios.bin'].includes(entry.name.split('/').pop().toLowerCase()) && entry.originalSize < 4*1024*1024})) : [[file.name,bytes]];
  let count = 0;
  for (const [filename,data] of entries) {
    const name = filename.split(/[\\/]/).pop().toLowerCase(); if (!['bios7.bin','bios9.bin','firmware.bin','gba_bios.bin'].includes(name)) continue;
    const valid = name === 'bios7.bin' || name === 'gba_bios.bin' ? data.length === 16384 : name === 'bios9.bin' ? data.length === 4096 : [131072,262144,524288].includes(data.length);
    if (!valid) throw new Error(`${name}의 크기가 맞지 않아요. 올바른 덤프 파일인지 확인해주세요.`);
    await dbPut('assets',{id:name,blob:new Blob([data])}); count++;
  }
  if (!count) throw new Error('bios7.bin · bios9.bin · firmware.bin · gba_bios.bin 중 하나를 선택해주세요.');
  toast(`BIOS ${count}개를 추가했어요.`); await renderBios(); event.target.value = '';
});
$('pauseBtn').onclick = guard(() => togglePause());
$('resetBtn').onclick = guard(async () => {
  if (!await confirm('처음부터 다시 실행할까요?','게임 내 세이브와 빠른 저장 파일은 유지돼요.','다시 시작')) return;
  if (current.system === 'nds' && settings.dsCore !== core) { await playGame(current); return; }
  await flushSram(); await ask('reset'); if (paused) await togglePause(false);
});
$('volume').value = settings.volume*100;
$('volume').oninput = event => { settings.volume = Number(event.target.value)/100; muted = false; notify('volume',{volume:settings.volume}); $('soundBtn').innerHTML = icon('volume'); saveSettings(); };
$('soundBtn').onclick = () => { muted = !muted; notify('volume',{volume:muted ? 0 : settings.volume}); $('soundBtn').innerHTML = icon(muted ? 'mute' : 'volume'); $('soundBtn').setAttribute('aria-label',muted ? '소리 켜기' : '소리 끄기'); };
$('speedBtn').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; notify('speed',{speed}); $('speedBtn').textContent = `${speed}×`; };
for (const id of ['saveBtn','loadBtn']) $(id).onclick = guard(async () => { await renderSlots(); openDialog('savesDialog'); });
$('exportSram').onclick = guard(async () => {
  await flushSram(); const record = await dbGet('saves',`${current.id}:${core}:sram`); if (!record) throw new Error('게임 내에서 저장한 기록이 없어요.');
  download(new Blob([record.bytes]),`${current.name}.${core === 'desmume' || core === 'desmume2015' ? 'dsv' : 'sav'}`);
});
$('importSave').onclick = () => $('saveInput').click();
$('saveInput').onchange = guard(async event => {
  const file = event.target.files[0]; if (!file || !current) return;
  if (file.size > 64*1024*1024 || !file.size) throw new Error('저장 파일은 0보다 크고 64 MB 이하로 선택해주세요.');
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (extension(file.name) === 'state') {
    if (new TextDecoder().decode(bytes.slice(0,8)) === stateMagic) {
      const length = new DataView(bytes.buffer).getUint32(8,true); if (length > 4096 || 12 + length >= bytes.length) throw new Error('저장 파일 헤더가 손상됐어요.');
      const meta = JSON.parse(new TextDecoder().decode(bytes.slice(12,12+length)));
      if (meta.gameId !== current.id || meta.core !== core) throw new Error('이 빠른 저장은 다른 게임 또는 다른 엔진에서 만든 파일이에요.');
      bytes = bytes.slice(12+length);
    }
    await ask('loadState',{bytes});
  } else {
    await ask('importSram',{bytes}); await dbPut('saves',{id:`${current.id}:${core}:sram`,gameId:current.id,core,kind:'sram',bytes,date:Date.now()});
  }
  toast('저장 파일을 불러왔어요.'); event.target.value = ''; $('savesDialog').close();
});
$('shotBtn').onclick = guard(async () => {
  const result = await ask('screenshot'); download(new Blob([result.bytes],{type:'image/png'}),`${current.name}.png`);
  current.screenshot = result.preview; await dbPut('games',current); renderGames(); toast('화면을 캡처했어요.');
});
$('fullscreenBtn').onclick = guard(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await $('playerCard').requestFullscreen(); });
$('focusMode').onclick = () => document.body.classList.toggle('focus-mode');
$('touchControls').querySelectorAll('[data-input]').forEach(button => {
  const id = Number(button.dataset.input);
  button.addEventListener('pointerdown',event => { event.preventDefault(); button.setPointerCapture(event.pointerId); input.touch.add(id); button.classList.add('active'); });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,() => { input.touch.delete(id); button.classList.remove('active'); });
});
let dragDepth = 0;
window.addEventListener('dragenter',event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('dragOverlay').hidden = false; } });
window.addEventListener('dragover',event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('dragleave',() => { if (--dragDepth <= 0) { dragDepth = 0; $('dragOverlay').hidden = true; } });
window.addEventListener('drop',guard(async event => { event.preventDefault(); dragDepth = 0; $('dragOverlay').hidden = true; if (event.dataTransfer?.files.length) await importFiles(event.dataTransfer.files); }));
window.addEventListener('keydown',guard(async event => {
  if (document.querySelector('dialog[open]') || event.target.matches('input,select,textarea')) return;
  if (event.code === 'Space' && ready) { event.preventDefault(); await togglePause(); }
  if (event.code === 'F5' && ready) { event.preventDefault(); await saveState(1); }
}));
document.addEventListener('visibilitychange',() => { if (document.hidden && settings.pauseHidden && ready && !paused) guard(() => togglePause(true))(); });
window.addEventListener('pagehide',() => { if (ready) notify('persist'); });
setInterval(() => { if (ready) guard(flushSram)(); },15000);
guard(async () => { games = await dbAll('games'); renderGames(); })();
