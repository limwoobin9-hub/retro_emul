export const SYSTEMS = {
  nds: { label: 'Nintendo DS', short: 'DS', extensions: ['nds', 'srl'], cores: ['melonds-native', 'desmume', 'desmume2015', 'melonds'], color: '#819cff' },
  gba: { label: 'Game Boy Advance', short: 'GBA', extensions: ['gba', 'agb'], cores: ['mgba'], color: '#bd99ed' },
  '3ds': { label: 'Nintendo 3DS', short: '3DS', extensions: ['3ds', 'cci', 'cxi', '3dsx'], cores: ['azahar'], color: '#75cdb4' }
};
export const MAX_ROM = 512 * 1024 * 1024;
export const extension = name => name.split('.').pop().toLowerCase();
export const cleanName = name => name.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
export const formatSize = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function detectSystem(name, bytes) {
  const ext = extension(name);
  for (const [id, system] of Object.entries(SYSTEMS)) if (system.extensions.includes(ext)) return id;
  if (bytes && bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === '3DSX') return '3ds';
  if (bytes && bytes.length >= 0x104 && ['NCSD', 'NCCH'].includes(String.fromCharCode(...bytes.slice(0x100, 0x104)))) return '3ds';
  if (bytes && bytes.length >= 0xc0 && bytes[0xb2] === 0x96) return 'gba';
  if (bytes && bytes.length >= 0x200) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const arm9 = view.getUint32(0x20, true), arm9Size = view.getUint32(0x2c, true);
    const arm7 = view.getUint32(0x30, true), arm7Size = view.getUint32(0x3c, true);
    if (arm9 >= 0x200 && arm9Size > 0 && arm7 >= 0x200 && arm7Size > 0 && arm9 + arm9Size <= bytes.length && arm7 + arm7Size <= bytes.length) return 'nds';
  }
  return null;
}
export function validateRom(name, bytes, system) {
  if (!bytes.length) throw new Error('비어 있는 파일이에요.');
  if (bytes.length > MAX_ROM) throw new Error('한 게임은 512 MB까지 불러올 수 있어요.');
  if (!SYSTEMS[system]) throw new Error('게임 기종을 확인할 수 없어요.');
  if (system === 'nds' && bytes.length < 512) throw new Error('DS ROM 헤더가 없거나 파일이 손상됐어요.');
  if (system === 'gba' && bytes.length < 192) throw new Error('GBA ROM 헤더가 없거나 파일이 손상됐어요.');
  if (extension(name) === 'cia') throw new Error('CIA는 설치용 파일이에요. 실행 가능한 CCI·CXI·3DSX 파일을 선택해주세요.');
}
export async function hashBytes(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
let dbPromise;
export function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('retro-library', 1);
    request.onupgradeneeded = () => {
      for (const store of ['games', 'roms', 'saves', 'assets']) request.result.createObjectStore(store, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(new Error('브라우저 저장 공간을 열 수 없어요.')); };
    request.onblocked = () => { dbPromise = null; reject(new Error('다른 탭을 닫고 다시 열어주세요.')); };
  });
  return dbPromise;
}
export async function dbGet(store, id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function dbAll(store) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function dbPut(store, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('저장 공간이 부족해요. 저장 파일을 내려받아 보관해주세요.'));
  });
}
export async function addGame(game, blob) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['games', 'roms'], 'readwrite');
    transaction.objectStore('games').put(game);
    transaction.objectStore('roms').put({ id: game.id, blob });
    transaction.oncomplete = () => resolve(game);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new Error('저장 공간이 부족해서 게임을 추가하지 못했어요.'));
  });
}
export async function deleteGame(id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['games', 'roms', 'saves'], 'readwrite');
    transaction.objectStore('games').delete(id);
    transaction.objectStore('roms').delete(id);
    const cursor = transaction.objectStore('saves').openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (entry) { if (entry.value.gameId === id) entry.delete(); entry.continue(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
export function readSettings() {
  try { return JSON.parse(localStorage.getItem('retro-settings')) || {}; } catch { return {}; }
}
export function writeSettings(value) { localStorage.setItem('retro-settings', JSON.stringify(value)); }
