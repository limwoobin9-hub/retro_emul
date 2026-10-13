import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectSystem,validateRom,hashBytes,MAX_ROM} from '../public/model.js';
import {padValues,padDefault} from '../public/controls.js';
test('supported filename aliases and archive entry paths',() => {
  for (const name of ['game.NDS','folder/game.srl']) assert.equal(detectSystem(name),'nds');
  for (const name of ['game.gba','game.agb']) assert.equal(detectSystem(name),'gba');
  for (const name of ['game.3ds','game.cci','game.cxi','game.3dsx']) assert.equal(detectSystem(name),'3ds');
  assert.equal(detectSystem('game.cia'),null); assert.equal(detectSystem('text.txt'),null);
});
test('ROM header detection does not infer a system from arbitrary bin data',() => {
  const data = new Uint8Array(4096),view = new DataView(data.buffer);
  assert.equal(detectSystem('game.bin',data),null); data[0xb2]=0x96; assert.equal(detectSystem('game.bin',data),'gba');
  data[0xb2]=0; view.setUint32(0x20,512,true);view.setUint32(0x2c,128,true);view.setUint32(0x30,1024,true);view.setUint32(0x3c,128,true);
  assert.equal(detectSystem('game.bin',data),'nds');
});
test('deduplication uses contents, not filename',async () => {
  assert.equal(await hashBytes(new Uint8Array([1,2,3])),await hashBytes(new Uint8Array([1,2,3])));
  assert.notEqual(await hashBytes(new Uint8Array([1,2,3])),await hashBytes(new Uint8Array([1,2,4])));
  assert.throws(() => validateRom('game.nds',new Uint8Array(10),'nds'));
  assert.equal(MAX_ROM,512*1024*1024);
});
test('Nintendo button positions and non-standard controller mappings',() => {
  const pad = {buttons:Array.from({length:16},()=>({value:0})),axes:[0,0,0,0]}; pad.buttons[1].value = 1;
  assert.equal(padValues(pad,padDefault()).get(8),1); assert.equal(padValues(pad,padDefault()).has(0),false);
  const profile = {...padDefault(),8:{type:'button',index:7}}; assert.equal(padValues(pad,profile).has(8),false);
  pad.buttons[7].value = 1; assert.equal(padValues(pad,profile).get(8),1);
});
test('stick deadzone, axes remapping, and 3DS analog magnitude',() => {
  const pad = {buttons:[],axes:[.1,-.1,0,0]};assert.equal(padValues(pad,padDefault(),.22).size,0);
  pad.axes[0] = -.8; assert.equal(padValues(pad,padDefault(),.22).get(6),1);
  assert.equal(padValues(pad,padDefault(),.22,true,'3ds').get(17),26214);
  assert.equal(padValues(pad,padDefault(),.22,true,'3ds').has(6),false);
  assert.equal(padValues(pad,{8:{type:'axis',index:0,sign:-1}},.22).get(8),1);
});
