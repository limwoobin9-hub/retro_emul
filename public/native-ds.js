// Adapter for the pinned Pilas-melonDS port (MPL-2.0).
// Upstream: https://github.com/josepilas/pilas-melonds
const decoder = new TextDecoder(), encoder = new TextEncoder();
export class NativeDS {
  static async create(config) {
    const {default:createCore} = await import('/engine/ds/pilas-melonds-core.js');
    const runtime = await createCore({locateFile:name => '/engine/ds/'+name,print:() => {},printErr:message => console.warn(message)});
    const engine = new NativeDS(runtime,config); await engine.init(); return engine;
  }
  constructor(runtime,config) {
    this.module = runtime; this.config = config; this.root = '/retro-ds'; this.keys = 4095; this.paused = false; this.speed = 1; this.frames = 0; this.volume = config.settings.volume;
    this.layout = config.settings.layout; this.sharp = config.settings.sharp; this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label','Nintendo DS 게임 화면'); this.canvas.style.touchAction = 'none'; this.canvas.tabIndex = 0;
    const game = document.getElementById('game'); game.style.display = 'flex'; game.style.alignItems = 'center'; game.style.justifyContent = 'center'; game.append(this.canvas);
    this.context = this.canvas.getContext('2d'); this.source = document.createElement('canvas'); this.source.width = 256; this.source.height = 384; this.sourceContext = this.source.getContext('2d');
  }
  alloc(bytes) { if (!bytes?.length) return 0; const pointer = this.module._malloc(bytes.length); this.module.HEAPU8.set(bytes,pointer); return pointer; }
  string(value) { return this.alloc(encoder.encode(value+'\0')); }
  lastError() { const ptr = this.module._pilas_last_error(this.instance); let end = ptr; while(this.module.HEAPU8[end]) end++; return decoder.decode(this.module.HEAPU8.subarray(ptr,end)); }
  async init() {
    const m = this.module; m.FS.mkdir(this.root); this.instance = m._pilas_create(48000);
    if (!this.instance) throw new Error('melonDS 엔진을 초기화하지 못했어요.');
    for (const file of this.config.nativeFiles || []) if (/^[a-z0-9._-]+$/i.test(file.name)) m.FS.writeFile(this.root+'/'+file.name,new Uint8Array(file.bytes));
    const bios9 = this.config.assets.find(asset => asset.id === 'bios9.bin'),bios7 = this.config.assets.find(asset => asset.id === 'bios7.bin');
    if (bios9 && bios7) {
      const nine = new Uint8Array(await bios9.blob.arrayBuffer()), seven = new Uint8Array(await bios7.blob.arrayBuffer());
      const p9 = this.alloc(nine),p7 = this.alloc(seven); m._pilas_set_bioses(this.instance,p9,nine.length,p7,seven.length);m._free(p9);m._free(p7);
    }
    const firmware = this.config.assets.find(asset => asset.id === 'firmware.bin');
    if (firmware) { const bytes = new Uint8Array(await firmware.blob.arrayBuffer()),pointer = this.alloc(bytes);m._pilas_set_firmware_image(this.instance,pointer,bytes.length);m._free(pointer); }
    this.attachCard(); m._pilas_set_console_mode(this.instance,0,0);m._pilas_set_direct_boot(this.instance,1);
    const date = new Date();m._pilas_set_rtc(this.instance,date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds());
    this.rom = new Uint8Array(await this.config.blob.arrayBuffer()); this.loadRom(this.config.sram ? new Uint8Array(this.config.sram) : new Uint8Array());
    this.audioPointer = m._malloc(4096*2*2);
    this.canvas.addEventListener('pointerdown',event => { this.canvas.setPointerCapture(event.pointerId);this.touch(event,true);this.startAudio(); });
    this.canvas.addEventListener('pointermove',event => { if (event.buttons || event.pressure) this.touch(event,true); });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) this.canvas.addEventListener(type,event => this.touch(event,false));
    window.addEventListener('keydown',() => this.startAudio());window.addEventListener('resize',() => this.resize());
    this.resize();this.last = performance.now();this.accumulator = 0;
    const tick = time => {
      const elapsed = Math.min(time-this.last,100);this.last = time;
      if (!this.paused) {
        this.accumulator += elapsed*this.speed;let count = 0;
        while(this.accumulator >= 1000/60 && count++ < 8) {m._pilas_run_frame(this.instance);this.accumulator-=1000/60;this.frames++;}
        this.draw();this.audio();
      } else this.accumulator = 0;
      this.animation = requestAnimationFrame(tick);
    };this.animation = requestAnimationFrame(tick);
    this.startAudio();
  }
  attachCard() {
    const m = this.module,pointer = this.string(this.root+'/homebrew.bin');
    const ok = m._pilas_set_dldi_sd_card(this.instance,1,pointer,64,0);m._free(pointer);
    if (!ok) throw new Error(this.lastError() || '가상 SD 카드를 준비하지 못했어요.');
  }
  loadRom(save) {
    const m = this.module,rom = this.alloc(this.rom),sram = this.alloc(save),name = this.string(this.config.game.filename);
    const ok = m._pilas_load_rom(this.instance,rom,this.rom.length,sram,save.length,name);m._free(rom);if(sram)m._free(sram);m._free(name);
    if (!ok) throw new Error(this.lastError() || 'DS 게임을 실행하지 못했어요.');
    m._pilas_set_key_mask(this.instance,this.keys);
  }
  resize() {
    const horizontal = this.layout === 'horizontal', single = this.layout === 'top' || this.layout === 'bottom';
    this.canvas.width = horizontal ? 512 : 256;this.canvas.height = horizontal || single ? 192 : 384;
    const width = innerWidth,height = innerHeight,scale = Math.min(width/this.canvas.width,height/this.canvas.height);
    this.canvas.style.width = `${this.canvas.width*scale}px`;this.canvas.style.height = `${this.canvas.height*scale}px`;
    this.canvas.style.imageRendering = this.sharp ? 'pixelated' : 'auto';this.context.imageSmoothingEnabled = !this.sharp;this.draw();
  }
  draw() {
    if (!this.instance) return;
    const pointer = this.module._pilas_get_framebuffer_ptr(this.instance);
    this.sourceContext.putImageData(new ImageData(new Uint8ClampedArray(this.module.HEAPU8.buffer,pointer,256*384*4),256,384),0,0);
    if (this.layout === 'horizontal') { this.context.drawImage(this.source,0,0,256,192,0,0,256,192);this.context.drawImage(this.source,0,192,256,192,256,0,256,192); }
    else if (this.layout === 'top' || this.layout === 'bottom') this.context.drawImage(this.source,0,this.layout === 'bottom'?192:0,256,192,0,0,256,192);
    else this.context.drawImage(this.source,0,0);
  }
  touch(event,active) {
    if (!active || this.layout === 'top') {this.module._pilas_set_touch(this.instance,0,0,0);return;}
    const rect = this.canvas.getBoundingClientRect();let x = (event.clientX-rect.left)*this.canvas.width/rect.width,y = (event.clientY-rect.top)*this.canvas.height/rect.height;
    if (this.layout === 'vertical') {if(y<192){this.module._pilas_set_touch(this.instance,0,0,0);return;}y-=192;}
    if (this.layout === 'horizontal') {if(x<256){this.module._pilas_set_touch(this.instance,0,0,0);return;}x-=256;}
    this.module._pilas_set_touch(this.instance,Math.max(0,Math.min(255,x|0)),Math.max(0,Math.min(191,y|0)),1);
  }
  async startAudio() {
    if (this.volume <= 0) return;
    try {
      if (!this.audioContext) {this.audioContext = new AudioContext({sampleRate:48000});this.gain = this.audioContext.createGain();this.gain.connect(this.audioContext.destination);this.gain.gain.value=this.volume;}
      if(this.audioContext.state==='suspended')await this.audioContext.resume();
    } catch { /* A user gesture can enable audio later. */ }
  }
  audio() {
    const count = this.module._pilas_pull_audio(this.instance,this.audioPointer,4096);
    if(count<=0 || !this.audioContext || this.audioContext.state!=='running' || this.volume<=0)return;
    const buffer=this.audioContext.createBuffer(2,count,48000),pcm=this.module.HEAP16.subarray(this.audioPointer>>1,(this.audioPointer>>1)+count*2);
    for(let ch=0;ch<2;ch++){const values=buffer.getChannelData(ch);for(let i=0;i<count;i++)values[i]=pcm[i*2+ch]/32768;}
    const now=this.audioContext.currentTime;this.audioTime=Math.max(now+.015,this.audioTime||0);
    if(this.audioTime>now+.18){this.audioTime=now+.015;return;}
    const source=this.audioContext.createBufferSource();source.buffer=buffer;source.connect(this.gain);source.start(this.audioTime);this.audioTime+=count/48000;
  }
  saveBytes() { const pointer=this.module._pilas_get_nds_save_ptr(this.instance),length=this.module._pilas_get_nds_save_length(this.instance);return pointer&&length ? this.module.HEAPU8.slice(pointer,pointer+length).buffer : null; }
  files() { return this.module.FS.readdir(this.root).filter(name=>name!=='.'&&name!=='..').map(name=>({name,bytes:this.module.FS.readFile(this.root+'/'+name).slice().buffer})); }
  state() {
    if(!this.module._pilas_save_state(this.instance))throw new Error(this.lastError() || '빠른 저장에 실패했어요.');
    const pointer=this.module._pilas_get_state_ptr(this.instance),length=this.module._pilas_get_state_length(this.instance),state=this.module.HEAPU8.slice(pointer,pointer+length),files=this.files();
    const meta=encoder.encode(JSON.stringify({length,files:files.map(file=>({name:file.name,length:file.bytes.byteLength}))}));const size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,meta.length,true);
    const result=new Uint8Array(12+meta.length+state.length+files.reduce((total,file)=>total+file.bytes.byteLength,0));result.set(encoder.encode('RDSSTATE'));result.set(size,8);result.set(meta,12);let offset=12+meta.length;result.set(state,offset);offset+=state.length;for(const file of files){result.set(new Uint8Array(file.bytes),offset);offset+=file.bytes.byteLength;}return result.buffer;
  }
  restore(bytes) {
    let data=new Uint8Array(bytes),state=data;
    if(decoder.decode(data.slice(0,8))==='RDSSTATE'){
      const size=new DataView(data.buffer).getUint32(8,true);if(size>65536||size+12>=data.length)throw new Error('저장 파일이 손상됐어요.');
      const meta=JSON.parse(decoder.decode(data.slice(12,12+size)));let offset=12+size;state=data.slice(offset,offset+meta.length);offset+=meta.length;
      this.module._pilas_set_dldi_sd_card(this.instance,0,0,0,0);
      for(const file of meta.files){if(!/^[a-z0-9._-]+$/i.test(file.name)||offset+file.length>data.length)throw new Error('저장 파일이 손상됐어요.');this.module.FS.writeFile(this.root+'/'+file.name,data.slice(offset,offset+file.length));offset+=file.length;}
      this.attachCard();
    }
    const pointer=this.alloc(state),ok=this.module._pilas_load_state(this.instance,pointer,state.length);this.module._free(pointer);if(!ok)throw new Error(this.lastError() || '이 저장 상태를 불러올 수 없어요.');this.draw();
  }
  async command(data) {
    switch(data.command){
      case 'input':{const bit={8:0,0:1,2:2,3:3,7:4,6:5,4:6,5:7,11:8,10:9,9:10,1:11}[data.index];if(bit!==undefined){this.keys=data.value ? this.keys&~(1<<bit) : this.keys|(1<<bit);this.module._pilas_set_key_mask(this.instance,this.keys);}break;}
      case 'pause':this.paused=data.paused;this.audioTime=0;if(this.audioContext){if(data.paused)await this.audioContext.suspend();else this.startAudio();}break;
      case 'reset':this.loadRom(new Uint8Array(this.saveBytes()||0));break;
      case 'volume':this.volume=data.volume;if(this.gain)this.gain.gain.value=data.volume;this.startAudio();break;
      case 'speed':this.speed=data.speed;break;
      case 'layout':this.layout=data.layout;this.resize();break;
      case 'sharp':this.sharp=data.sharp;this.resize();break;
      case 'getState':return this.state();
      case 'loadState':this.restore(data.bytes);break;
      case 'sram':return{bytes:this.saveBytes(),files:this.files()};
      case 'persist':break;
      case 'importSram':this.loadRom(new Uint8Array(data.bytes));break;
      case 'screenshot':{const blob=await new Promise(resolve=>this.canvas.toBlob(resolve,'image/png'));return{bytes:await blob.arrayBuffer(),preview:this.canvas.toDataURL('image/webp',.7)};}
      default:throw new Error('알 수 없는 DS 요청이에요.');
    }
  }
}
