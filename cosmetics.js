"use strict";
if(typeof structuredClone==='undefined')globalThis.structuredClone=v=>JSON.parse(JSON.stringify(v));
class AmatsukiPolicy {
  constructor(catalog, preferences = {}, seed = {}) {
    this.catalog = catalog;
    this.items = new Map(catalog.items.map(x => [x.itemId, x]));
    this.types = new Map(catalog.items.map(x => [x.itemId, x.type]));
    this.roles = new Map(catalog.characters.map(x => [x.characterId, x]));
    this.skins = new Map(catalog.skins.map(x => [x.skinId, x.characterId]));
    this.state = {schema:1, equips:{}, skins:{}, stars:{}, voices:{}, cutins:{}, groups:{}, emojiGroups:{}, lobbyGroups:{}, deletedLobby:[], ...preferences};
    this.seed = structuredClone(seed);
    this.actualCharacters = [];
    this.baseGroups = [];
    this.baseEmojiGroups = [];
    this.baseLobbyGroups = [];
  }
  valid(id) { if (!Number.isInteger(id) || !this.types.has(id)) throw Error('未知装扮 ID'); return id; }
  role(id) { if (!this.roles.has(id)) throw Error('未知雀士'); return id; }
  slot(index) { if (!Number.isInteger(index) || index < 0 || index >= 10) throw Error('套组编号超出范围'); return index; }
  equip(id) {
    this.valid(id); const type=this.types.get(id);
    if (type===6) { this.role(id); this.state.equips[6]=id; }
    else if (type===7) { const role=this.skins.get(id); if (!role) throw Error('无效造型'); this.state.skins[role]=id; this.state.equips[6]=role; }
    else this.state.equips[type]=id;
  }
  using() {
    const byType=new Map((this.seed.usingItemId||[]).filter(x=>this.types.has(x)&&this.types.get(x)!==23).map(x=>[this.types.get(x),x]));
    for (const [type,id] of Object.entries(this.state.equips)) byType.set(Number(type),id);
    const role=byType.get(6);
    if (this.state.skins[role]) byType.set(7,this.state.skins[role]);
    else if(role && this.skins.get(byType.get(7))!==role) { const skin=this.roles.get(role)?.skinItemIdList.find(x=>this.skins.has(x)); if(skin)byType.set(7,skin); }
    const emoji=this.state.emoji||(this.seed.usingItemId||[]).filter(x=>this.types.get(x)===23);
    return [...new Set([...byType.values(),...emoji])];
  }
  characters(incoming = this.actualCharacters) {
    const old=new Map(incoming.map(x=>[x.itemId,x]));
    const selected=this.using().find(x=>this.types.get(x)===6);
    return [...this.roles].map(([id,config])=>{
      const v={itemId:id,skinId:config.skinItemIdList.find(x=>this.skins.has(x)),favorabilityLevel:0,awakenLevel:0,...old.get(id),owned:true,isUsing:id===selected};
      if (this.state.skins[id]) v.skinId=this.state.skins[id];
      if (id in this.state.stars) v.isStar=this.state.stars[id];
      if (id in this.state.voices) v.voiceVariant=this.state.voices[id];
      if (id in this.state.cutins) v.cutinVariant=this.state.cutins[id];
      return v;
    });
  }
  inventoryRow(id, existing={}) {
    const item=this.items.get(id);
    if(!item)return structuredClone(existing);
    return {lastGainTime:0,...existing,...item,count:Math.max(1,existing.count||0),isUsing:this.using().includes(id)};
  }
  inventory(existing=[], context={}) {
    const rows=new Map(existing.map(x=>[x.itemId,x]));
    for(const item of this.catalog.items)rows.set(item.itemId,this.inventoryRow(item.itemId,rows.get(item.itemId)));
    return [...rows.values()].filter(x=>context.itemType!==undefined?x.type===context.itemType:context.itemIds?context.itemIds.includes(x.itemId):true);
  }
  playerDisplay(original, uid) {
    const value=structuredClone(original),using=this.using();
    const selected=new Map(using.map(id=>[this.types.get(id),id]));
    const fields={8:'frameId',9:'titleId',12:'riichiStickItemId',13:'mjFrontItemId',14:'mjBackItemId',15:'handItemId',16:'ronEffectItemId',17:'riichiEffectItemId',19:'matchMusicItemId',20:'riichiMusicItemId',21:'tableEffectItemId',22:'tableItemId',26:'profileFrameId',27:'profileBgId'};
    const visit=v=>{
      if(!v||typeof v!=='object')return;
      if(String(v.uid)===String(uid)) {
        if('usingItemId' in v)v.usingItemId=[...using];
        if('skinId' in v&&selected.has(7))v.skinId=selected.get(7);
        if('headItemId' in v&&selected.has(6)&&[6,7].includes(this.types.get(v.headItemId)))v.headItemId=selected.get(6);
        for(const [type,field] of Object.entries(fields))if(field in v&&selected.has(Number(type)))v[field]=selected.get(Number(type));
        if(v.usingItems) {
          for(const [type,field] of Object.entries(fields))if(selected.has(Number(type)))v.usingItems[field]=selected.get(Number(type));
          if(this.state.emoji)v.usingItems.emojiItemIdList=[...this.state.emoji];
        }
        const role=selected.get(6);
        if('voiceVariant' in v&&role in this.state.voices)v.voiceVariant=this.state.voices[role];
        if('cutinVariant' in v&&role in this.state.cutins)v.cutinVariant=this.state.cutins[role];
      }
      Object.values(v).forEach(visit);
    };
    visit(value);return value;
  }
  merge(base, local, deleted=[]) {
    const map=new Map(base.filter(x=>!deleted.includes(x.setIndex)).map(x=>[x.setIndex,structuredClone(x)]));
    for(const [key,value] of Object.entries(local)) map.set(Number(key),structuredClone(value));
    return [...map.values()].sort((a,b)=>a.setIndex-b.setIndex);
  }
  applyResponse() { return {status:0,errorCode:0,usingItemId:this.using(),characterList:this.characters(),lobbySetItem:this.state.lobbyCurrent||this.seed.lobbySetItem||null}; }
  overlay(type, original, context={}) {
    const r=structuredClone(original);
    if(r.status!==undefined && r.status!==0) return r;
    if(type==='InventoryResponse') r.itemList=this.inventory(r.itemList||[],context);
    if(type==='ApplyItemSetResponse') {
      if(r.characterList?.length) this.actualCharacters=[...new Map([...this.actualCharacters,...structuredClone(r.characterList)].map(x=>[x.itemId,x])).values()];
      r.characterList=this.characters();
      r.usingItemId=this.using();
      if(this.state.lobbyCurrent) r.lobbySetItem=this.state.lobbyCurrent;
    }
    if(type==='ItemSetResponse') { this.baseGroups=structuredClone(r.itemSetList||[]); r.itemSetList=this.merge(this.baseGroups,this.state.groups); if('randomGroups' in this.state) r.isRandomItemSet=this.state.randomGroups; }
    if(type==='StickerSetResponse') { this.baseEmojiGroups=structuredClone(r.stickerSetList||[]); r.stickerSetList=this.merge(this.baseEmojiGroups,this.state.emojiGroups); }
    if(type==='LobbySetResponse') {
      this.baseLobbyGroups=structuredClone(r.lobbySetList||[]);r.lobbySetList=this.merge(this.baseLobbyGroups,this.state.lobbyGroups,this.state.deletedLobby);
      if(r.characterList?.length) this.actualCharacters=[...new Map([...this.actualCharacters,...structuredClone(r.characterList)].map(x=>[x.itemId,x])).values()];
      r.characterList=this.characters();
      if(this.state.lobbyCurrent) r.usingSetIndex=this.state.lobbyCurrent.setIndex;
      if('randomLobby' in this.state) r.isRandomLobbySet=this.state.randomLobby;
    }
    return r;
  }
  characterLookup(id, original) {
    if(!this.roles.has(id))return structuredClone(original);
    const rejected=original.status===1&&original.errorCode===1;
    if(original.status!==0&&!rejected)return structuredClone(original);
    const response=rejected?{...original,...this.applyResponse(),message:null}:this.overlay('ApplyItemSetResponse',original);
    response.characterList=response.characterList.filter(x=>x.itemId===id);
    return response;
  }
  followLobby() {
    const role=this.using().find(x=>this.types.get(x)===6);
    const skin=this.using().find(x=>this.types.get(x)===7);
    const lobby=this.state.lobbyCurrent||this.seed.lobbySetItem;
    if(role && skin && lobby) {
      this.state.lobbyCurrent={...lobby,lobbyCharacterSkinId:skin};
      this.state.lobbyGroups[lobby.setIndex]=structuredClone(this.state.lobbyCurrent);
    }
  }
  operation(name, args) {
    const [a,b,c,d,e]=args; const ok={status:0,errorCode:0};
    if(name==='CharacterSetUsing') { this.equip(this.role(a));this.followLobby(); }
    else if(name==='CharacterSetSkin') { this.role(a); if(this.skins.get(b)!==a) throw Error('造型与雀士不匹配');this.state.skins[a]=b;if(this.using().includes(a))this.followLobby(); }
    else if(name==='CharacterFavorite'||name==='CharacterUnfavorite') this.state.stars[this.role(a)]=name==='CharacterFavorite';
    else if(name==='CharacterSetVoiceVariant'||name==='CharacterSetCutinVariant') { this.role(a);if(!Number.isInteger(b)||b<0||b>100) throw Error('未知语音或立绘变体');(name==='CharacterSetVoiceVariant'?this.state.voices:this.state.cutins)[a]=b; }
    else if(name==='InventorySetItemUsing'||name.startsWith('ProfileUpdateUsing')) this.equip(a);
    else if(name==='InventorySaveCustomGroup') {
      const index=this.slot(a);if(!Array.isArray(c))throw Error('套组内容无效');c.forEach(x=>this.valid(x));
      this.state.groups[index]={setIndex:index,name:String(b).slice(0,80),itemId:[...c],stickerSetIndex:d,enableRandom:!!e};
    } else if(name==='InventorySaveCurrentItemSet') {
      const index=this.slot(a);this.state.groups[index]={setIndex:index,name:String(b).slice(0,80),itemId:this.using(),stickerSetIndex:0,enableRandom:!!c};
    } else if(name==='InventoryApplyCustomGroup') {
      const group=this.merge(this.baseGroups,this.state.groups).find(x=>x.setIndex===this.slot(a));if(!group)throw Error('套组不存在');group.itemId.forEach(x=>this.equip(x));this.followLobby();
    } else if(name==='InventorySwitchCustomGroupRandom') this.state.randomGroups=!!a;
    else if(name==='InventorySaveEmojiGroup') {
      const index=this.slot(a);if(!Array.isArray(b)||b.some(x=>this.types.get(x)!==23))throw Error('表情套组包含无效内容');
      this.state.emojiGroups[index]={setIndex:index,name:'',itemId:[...b],isUsing:false};
    } else if(name==='InventoryApplyEmojiGroup') {
      const group=this.merge(this.baseEmojiGroups,this.state.emojiGroups).find(x=>x.setIndex===this.slot(a));if(!group)throw Error('表情套组不存在');this.state.emoji=[...group.itemId];
    } else if(name==='InventorySaveLobbySet') {
      const index=this.slot(a.setIndex);for(const key of ['lobbyBgItemId','lobbyBgmItemId','lobbyCharacterSkinId'])this.valid(a[key]);
      if(this.types.get(a.lobbyBgItemId)!==10||this.types.get(a.lobbyBgmItemId)!==18||!this.skins.has(a.lobbyCharacterSkinId))throw Error('大厅套组类别不匹配');
      if(['scale','locationX','locationY'].some(k=>!Number.isFinite(a[k])))throw Error('大厅位置无效');
      const value={...a,setIndex:index,name:String(a.name||'').slice(0,80)};
      this.state.lobbyGroups[index]=value;this.state.deletedLobby=this.state.deletedLobby.filter(x=>x!==index);
      if(b)this.state.lobbyCurrent=value;
      return this.overlay('LobbySetResponse',{...ok,lobbySetList:this.baseLobbyGroups,characterList:this.actualCharacters});
    } else if(name==='InventoryDeleteLobbySet') {
      this.slot(a);delete this.state.lobbyGroups[a];this.state.deletedLobby=[...new Set([...this.state.deletedLobby,a])];if(this.state.lobbyCurrent?.setIndex===a)delete this.state.lobbyCurrent;
      return this.overlay('LobbySetResponse',{...ok,lobbySetList:this.baseLobbyGroups,characterList:this.actualCharacters});
    } else if(name==='InventorySaveLobbySetRandom') this.state.randomLobby=!!a;
    else throw Error('不属于本地装扮操作：'+name);
    return this.applyResponse();
  }
  preferences() { return structuredClone(this.state); }
}
globalThis.AmatsukiPolicy=AmatsukiPolicy;
if(typeof module!=='undefined')module.exports=AmatsukiPolicy;
