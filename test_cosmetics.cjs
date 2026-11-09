const test=require('node:test');
const assert=require('node:assert/strict');
const Policy=require('./cosmetics.js');
const catalog={items:[{itemId:1060001,type:6},{itemId:1060002,type:6},{itemId:1070100,type:7},{itemId:1070103,type:7},{itemId:1070200,type:7},{itemId:1100000,type:10},{itemId:1180000,type:18},{itemId:1150000,type:15},{itemId:1152000,type:15},{itemId:1230100,type:23}],characters:[{characterId:1060001,skinItemIdList:[1070100,1070103]},{characterId:1060002,skinItemIdList:[1070200]}],skins:[{skinId:1070100,characterId:1060001},{skinId:1070103,characterId:1060001},{skinId:1070200,characterId:1060002}]};
const seed={usingItemId:[1060001,1070100,1150000]};
test('inventory augmentation preserves consumables',()=>{
 const p=new Policy(catalog,{},seed);p.operation('InventorySetItemUsing',[1152000]);
 const items=p.overlay('InventoryResponse',{status:0,itemList:[{itemId:1010000,count:3}]}).itemList;
 assert.deepEqual(items.find(x=>x.itemId===1010000),{itemId:1010000,count:3});
 assert.equal(items.find(x=>x.itemId===1152000).isUsing,true);assert.equal(items.find(x=>x.itemId===1150000).isUsing,false);
 assert.equal(items.length,catalog.items.length+1);
});
test('role and skin remain consistent after switching role',()=>{const p=new Policy(catalog,{},seed);p.operation('CharacterSetUsing',[1060002]);assert.ok(p.using().includes(1070200));assert.ok(!p.using().includes(1070100));});
test('cosmetic views retain genuine progression',()=>{
 const p=new Policy(catalog,{},seed);const original={status:0,characterList:[{itemId:1060001,skinId:1070100,favorabilityLevel:3,awakenLevel:1,owned:true}],usingItemId:seed.usingItemId};
 p.operation('CharacterSetSkin',[1060001,1070103]);const copy=p.overlay('ApplyItemSetResponse',original);
 assert.equal(copy.characterList[0].skinId,1070103);assert.equal(copy.characterList[0].favorabilityLevel,3);assert.equal(copy.characterList[0].awakenLevel,1);assert.equal(original.characterList[0].skinId,1070100);
});
test('local suit survives reload and applies equipment',()=>{
 const first=new Policy(catalog,{},seed);first.operation('InventorySaveCustomGroup',[0,'方案',[1060002,1070200,1152000],0,false]);
 const restored=new Policy(catalog,first.preferences(),seed);restored.operation('InventoryApplyCustomGroup',[0]);assert.ok(restored.using().includes(1152000));assert.ok(restored.using().includes(1070200));
});
test('lobby set deletion and reuse survive reload',()=>{
 const first=new Policy(catalog,{},seed);const set={setIndex:0,name:'大厅',lobbyBgItemId:1100000,lobbyBgmItemId:1180000,lobbyCharacterSkinId:1070103,scale:1,locationX:0,locationY:0};
 first.operation('InventorySaveLobbySet',[set,true]);let other=new Policy(catalog,first.preferences(),seed);
 assert.equal(other.applyResponse().lobbySetItem.lobbyCharacterSkinId,1070103);other.operation('InventoryDeleteLobbySet',[0]);assert.equal(other.overlay('LobbySetResponse',{lobbySetList:[set]}).lobbySetList.length,0);
});
test('purchases and progression actions are not local operations',()=>{const p=new Policy(catalog,{},seed);for(const name of ['CharacterAwaken','CharacterGift','ShopBuy','InventoryUseBoxRandom'])assert.throws(()=>p.operation(name,[1]));assert.throws(()=>p.operation('CharacterSetSkin',[1060001,1070200]));});

test('equipped emoji list is preserved across unrelated changes',()=>{const c=structuredClone(catalog);c.items.push({itemId:1230101,type:23});const p=new Policy(c,{}, {usingItemId:[...seed.usingItemId,1230100,1230101]});p.operation('InventorySetItemUsing',[1152000]);assert.ok(p.using().includes(1230100));assert.ok(p.using().includes(1230101));});

test('inventory pages receive only their requested cosmetic category',()=>{const p=new Policy(catalog,{},seed);const rows=p.overlay('InventoryResponse',{status:0,itemList:[]},{itemType:15}).itemList;assert.equal(rows.length,2);assert.ok(rows.every(x=>x.type===15));});
test('switching character updates the lobby set and selected skin',()=>{const p=new Policy(catalog,{}, {...seed,lobbySetItem:{setIndex:0,name:'大厅',lobbyBgItemId:1100000,lobbyBgmItemId:1180000,lobbyCharacterSkinId:1070100,scale:1,locationX:0,locationY:0}});p.operation('CharacterSetUsing',[1060002]);assert.equal(p.applyResponse().lobbySetItem.lobbyCharacterSkinId,1070200);});


test('cached cosmetic rows stay owned and follow local selection',()=>{
 const p=new Policy(catalog,{},seed);p.equip(1152000);
 assert.equal(p.inventoryRow(1152000,{itemId:1152000,count:0,isUsing:false}).count,1);
 assert.equal(p.inventoryRow(1152000,{itemId:1152000,count:0,isUsing:false}).isUsing,true);
 assert.equal(p.inventoryRow(1150000,{itemId:1150000,count:1,isUsing:true}).isUsing,false);
 const gift={itemId:1010000,count:0,isUsing:false};assert.deepEqual(p.inventoryRow(1010000,gift),gift);
});
test('room and match overlays change only own cosmetics',()=>{
 const p=new Policy(catalog,{},seed);p.equip(1070103);p.equip(1152000);
 const own={uid:'1234567890123456789',skinId:1070100,headItemId:1060001,usingItems:{handItemId:1150000},rankExp:123,favorabilityLevel:3};
 const other={...structuredClone(own),uid:'2234567890123456789'};
 const value=p.playerDisplay({players:[own,other]},own.uid);
 assert.equal(value.players[0].skinId,1070103);assert.equal(value.players[0].usingItems.handItemId,1152000);
 assert.equal(value.players[0].rankExp,123);assert.equal(value.players[0].favorabilityLevel,3);
 assert.deepEqual(value.players[1],other);assert.equal(own.skinId,1070100);
});


test('unowned character lookup uses the requested local appearance after server input rejection',()=>{
 const p=new Policy(catalog,{},seed);p.operation('CharacterSetSkin',[1060001,1070103]);
 const response=p.characterLookup(1060001,{status:1,errorCode:1,message:'input error',characterList:[]});
 assert.equal(response.status,0);assert.equal(response.errorCode,0);assert.equal(response.message,null);
 assert.equal(response.characterList.length,1);assert.equal(response.characterList[0].itemId,1060001);assert.equal(response.characterList[0].skinId,1070103);
});
test('character lookup preserves actual progression and narrows the response to the requested role',()=>{
 const p=new Policy(catalog,{},seed);
 const response=p.characterLookup(1060002,{status:0,errorCode:0,characterList:[{itemId:1060002,skinId:1070200,favorabilityLevel:4,awakenLevel:2}],usingItemId:seed.usingItemId});
 assert.equal(response.characterList.length,1);assert.equal(response.characterList[0].itemId,1060002);
 assert.equal(response.characterList[0].favorabilityLevel,4);assert.equal(response.characterList[0].awakenLevel,2);
});
test('character lookup retains authentication and network failures and invalid IDs',()=>{
 const p=new Policy(catalog,{},seed);
 for(const errorCode of [3,4,19,70]){const failure={status:1,errorCode,message:'real error',characterList:[]};assert.deepEqual(p.characterLookup(1060001,failure),failure);}
 const invalid={status:1,errorCode:1,characterList:[]};assert.deepEqual(p.characterLookup(9999999,invalid),invalid);
});
