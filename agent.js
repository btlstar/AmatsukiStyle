"use strict";
let catalog,profiles={},policy,account,uid;
let suppress=0;
const hooks=[], hookedMoves=new Set(), jobs=new Map(), scopes=new Map();
const stats={operations:0,responses:0,errors:0,responseTypes:{},views:{}};
const localOperations=new Set([
  'CharacterSetUsing','CharacterSetSkin','CharacterFavorite','CharacterUnfavorite','CharacterSetVoiceVariant','CharacterSetCutinVariant',
  'InventorySetItemUsing','InventorySwitchCustomGroupRandom','InventorySaveCustomGroup','InventorySaveEmojiGroup','InventoryApplyCustomGroup','InventoryApplyEmojiGroup','InventorySaveCurrentItemSet',
  'InventorySaveLobbySet','InventorySaveLobbySetRandom','InventoryDeleteLobbySet','ProfileUpdateUsingFrame','ProfileUpdateUsingTitle','ProfileUpdateUsingProfileFrame','ProfileUpdateUsingProfileBg'
]);
const readOperations=new Set(['CharacterGetById','CharacterGetOwnedSkin','InventoryGetByType','InventoryGetByIds','InventoryGetList','InventoryGetEmojiGroupList','InventoryGetCustomGroupList','InventoryGetLobbySetList']);
function verifyReferences(){
  const lobby=IL.fromJson('DataModel.ClientLobbySetItem',{setIndex:0,name:'before',lobbyBgItemId:1100000,lobbyBgmItemId:1180000,lobbyCharacterSkinId:1070100,scale:1,locationX:0,locationY:0});
  IL.write(lobby,'name',IL.managedString('after'));IL.write(lobby,'setIndex',1);
  const copy=IL.json(lobby);if(copy.name!=='after'||copy.setIndex!==1)throw Error('Managed field-write check failed');
  const user=IL.fromJson('DataModel.UserInfo',{uid:0,usingItemId:[],usingItems:{}});
  const response=IL.fromJson('ApplyItemSetResponse',{status:0,errorCode:0,usingItemId:[1150000],characterList:[]});
  IL.write(user,'usingItemId',IL.read(response,'usingItemId'));
  if(IL.ints(IL.read(user,'usingItemId'))[0]!==1150000)throw Error('Managed collection reference check failed');
  return true;
}
function state(){
  const user=IL.staticRead('Gvar','userInfo');if(!user||user.isNull())throw Error('请先登录天月。');
  const current=IL.read(user,'uid');
  if(current!==uid){
    uid=current;account=Checksum.compute('sha256',uid);
    const lobby=IL.read(user,'lobbySetItem');
    policy=new AmatsukiPolicy(catalog,profiles[account]||{}, {usingItemId:IL.ints(IL.read(user,'usingItemId')),lobbySetItem:lobby.isNull()?null:IL.json(lobby)});
  }
  return user;
}
function quiet(action){suppress++;try{return action();}finally{suppress--;}}
function notify(error,operation){stats.errors++;send({event:'error',operation,message:String(error),stack:error.stack});}
function synchronize(user,response){
  const managed=quiet(()=>IL.fromJson('ApplyItemSetResponse',response));
  IL.write(user,'usingItemId',IL.read(managed,'usingItemId'));
  if(response.lobbySetItem)IL.write(user,'lobbySetItem',IL.read(managed,'lobbySetItem'));
  const oldItems=IL.read(user,'usingItems');const using=oldItems.isNull()?{}:IL.json(oldItems);
  const fields={8:'frameId',9:'titleId',12:'riichiStickItemId',13:'mjFrontItemId',14:'mjBackItemId',15:'handItemId',16:'ronEffectItemId',17:'riichiEffectItemId',19:'matchMusicItemId',20:'riichiMusicItemId',21:'tableEffectItemId',22:'tableItemId',26:'profileFrameId',27:'profileBgId'};
  for(const id of response.usingItemId){const f=fields[policy.types.get(id)];if(f)using[f]=id;}
  if(policy.state.emoji)using.emojiItemIdList=policy.state.emoji;
  IL.write(user,'usingItems',quiet(()=>IL.fromJson('DataModel.PlayerUsingItems',using)));
  const head=IL.read(user,'headItemId');const role=response.usingItemId.find(x=>policy.types.get(x)===6);
  if(role && [6,7].includes(policy.types.get(head)))IL.write(user,'headItemId',role);
  if(role in policy.state.voices)IL.write(user,'voiceVariant',policy.state.voices[role]);
  if(role in policy.state.cutins)IL.write(user,'cutinVariant',policy.state.cutins[role]);
}
function callback(job,success,response){
  const method=IL.method(IL.api.objectClass(job.callback),'Invoke',job.callbackCount);
  const values=[success?0:1,success?0:1];
  if(job.responseType)values.push(quiet(()=>IL.fromJson(job.responseType,response)));
  IL.invoke(method,job.callback,values);
}
function finish(job){
  let snapshot;
  try{
    const user=state();snapshot=policy.preferences();
    const response=policy.operation(job.operation,job.args);
    synchronize(user,policy.applyResponse());
    callback(job,true,response);
    const preferences=policy.preferences();profiles[account]=preferences;
    send({event:'preferences',account,preferences});stats.operations++;
  }catch(error){
    if(snapshot)policy.state=snapshot;
    notify(error,job.operation);
    try{callback(job,false,{status:1,errorCode:1});}catch(callbackError){notify(callbackError,job.operation);}
  }
}
function decode(value,type){
  if(type==='System.Int32'||type==='DataModel.ItemType')return value.toInt32();
  if(type==='System.Boolean')return value.toInt32()!==0;
  if(type==='System.String')return IL.string(value);
  if(type==='System.Int32[]')return IL.ints(value,true);
  if(type==='System.Collections.Generic.List<System.Int32>')return IL.ints(value);
  if(type==='DataModel.ClientLobbySetItem')return quiet(()=>IL.json(value));
  throw Error('Unsupported cosmetic argument: '+type);
}
function watchFactory(m){
  hooks.push(Interceptor.attach(m.address,{
    onEnter(args){
      try{
        state();const callbackType=m.params.at(-1);const parts=callbackType.slice(callbackType.indexOf('<')+1,-1).split(',');
        this.job={operation:m.name,callback:args[m.params.length],callbackCount:parts.length,responseType:parts.length===3?parts[2]:null,args:[]};
        for(let i=0;i<m.params.length-1;i++)this.job.args.push(decode(args[i+1],m.params[i]));
      }catch(error){this.job=null;notify(error,m.name);}
    },
    onLeave(result){
      if(!this.job||result.isNull())return;
      jobs.set(result.toString(),this.job);
      const move=IL.method(IL.api.objectClass(result),'MoveNext',0);const address=move.address.toString();
      if(hookedMoves.has(address))return;hookedMoves.add(address);
      hooks.push(Interceptor.attach(move.address,{
        onEnter(args){
          this.key=args[0].toString();this.job=jobs.get(this.key);this.thread=Process.getCurrentThreadId();this.previous=scopes.get(this.thread);
          if(!this.job)return;
          scopes.set(this.thread,this.job);
          if(localOperations.has(this.job.operation))IL.write(args[0],'<>1__state',-1);
        },
        onLeave(result){
          if(!this.job)return;
          if(localOperations.has(this.job.operation)){jobs.delete(this.key);finish(this.job);}
          if(!localOperations.has(this.job.operation)&&result.toInt32()===0)jobs.delete(this.key);
          if(this.previous)scopes.set(this.thread,this.previous);else scopes.delete(this.thread);
        }
      }));
    }
  }));
}
const displayFields=new Map();
const cosmeticFields=['skinId','headItemId','frameId','titleId','profileFrameId','profileBgId','voiceVariant','cutinVariant'];
const playerTypes=new Set(['DataModel.PlayerInfo','DataModel.ClientProfilePageOverview','MatchingResponse.ClientPlayerInfo',...['GB','HK','Jp','PMJ','Sc','TW'].map(x=>x+'GameResponse.'+x+'MaskedPlayer')]);
function patchOwnPlayer(object){
  if(!object||object.isNull())return false;
  const fields=IL.fields(IL.api.objectClass(object)),names=new Set(fields.map(f=>f.name));
  const idField=names.has('uid')?'uid':names.has('userId')?'userId':null;
  if(!idField||IL.read(object,idField)!==uid)return false;
  const source={uid};
  for(const field of cosmeticFields)if(names.has(field))source[field]=IL.read(object,field);
  if(names.has('usingItemId'))source.usingItemId=IL.ints(IL.read(object,'usingItemId'));
  if(names.has('usingItems')){
    const items=IL.read(object,'usingItems');source.usingItems=items.isNull()?{}:quiet(()=>IL.json(items));
  }
  const value=policy.playerDisplay(source,uid);
  for(const field of cosmeticFields)if(field in value)IL.write(object,field,value[field]);
  if('usingItemId' in value){
    const response=quiet(()=>IL.fromJson('ApplyItemSetResponse',{usingItemId:value.usingItemId}));
    IL.write(object,'usingItemId',IL.read(response,'usingItemId'));
  }
  if('usingItems' in value)IL.write(object,'usingItems',quiet(()=>IL.fromJson('DataModel.PlayerUsingItems',value.usingItems)));
  return true;
}
function patchDisplay(object){
  const klass=IL.api.objectClass(object),type=IL.typeName(IL.api.classType(klass));
  if(playerTypes.has(type))return patchOwnPlayer(object)?1:0;
  let fields=displayFields.get(type);
  if(!fields){
    fields=IL.fields(klass).filter(f=>!(f.flags&16)&&(playerTypes.has(f.type)||[...playerTypes].some(t=>f.type==='System.Collections.Generic.List<'+t+'>')||/^(GB|HK|Jp|PMJ|Sc|TW)GameResponse\.\w+GameStart$/.test(f.type)));
    displayFields.set(type,fields);
  }
  let count=0;
  for(const field of fields){
    const value=IL.read(object,field.name);if(!value||value.isNull())continue;
    if(field.type.startsWith('System.Collections.Generic.List<'))for(const player of IL.list(value))count+=patchOwnPlayer(player)?1:0;
    else count+=patchDisplay(value);
  }
  return count;
}
function watchResponses(){
  const eligible=new Set(['InventoryResponse','ApplyItemSetResponse','ItemSetResponse','StickerSetResponse','LobbySetResponse']);
  const method=IL.method('Newtonsoft.Json.Serialization.JsonSerializerInternalReader','Deserialize',3);
  hooks.push(Interceptor.attach(method.address,{onLeave(result){
    if(suppress||result.isNull())return;
    try{
      const klass=IL.api.objectClass(result),name=IL.api.name(klass).readUtf8String();
      const job=scopes.get(Process.getCurrentThreadId());
      state();
      if(!eligible.has(name)&&!(name==='RewardResponse'&&job?.operation==='CharacterGetOwnedSkin')){
        if(patchDisplay(result)){stats.responses++;stats.responseTypes[name]=(stats.responseTypes[name]||0)+1;}
        return;
      }
      let data=quiet(()=>IL.json(result));
      if(name==='RewardResponse')data.itemList=catalog.skins.filter(x=>x.characterId===job.args[0]).map(x=>({itemId:x.skinId,count:1,type:7}));
      else if(eligible.has(name)){
        if(name==='InventoryResponse' && !['InventoryGetByType','InventoryGetByIds','InventoryGetList'].includes(job?.operation))return;
        const context=job?.operation==='InventoryGetByType'?{itemType:job.args[0]}:job?.operation==='InventoryGetByIds'?{itemIds:job.args[0]}:{};
        data=name==='ApplyItemSetResponse'&&job?.operation==='CharacterGetById'
          ?policy.characterLookup(job.args[0],data):policy.overlay(name,data,context);
      }
      const type=IL.typeName(IL.api.classType(klass));
      result.replace(quiet(()=>IL.fromJson(type,data)));stats.responses++;
      stats.responseTypes[name]=(stats.responseTypes[name]||0)+1;
    }catch(error){notify(error,'response');}
  }}));
}
function watchViews(){
  function record(name){stats.views[name]=(stats.views[name]||0)+1;}
  function inventoryArgument(args,configIndex,rowIndex){
    const config=args[configIndex];if(config.isNull())return;
    const id=IL.read(config,'id');if(!policy.types.has(id))return;
    const old=args[rowIndex].isNull()?{}:quiet(()=>IL.json(args[rowIndex]));
    const row=quiet(()=>IL.fromJson('DataModel.ClientInventoryItem',policy.inventoryRow(id,old)));
    args[rowIndex]=row;
  }
  for(const [type,name,count,configIndex,rowIndex] of [
    ['InventoryItem','InitWearItem',4,1,2],['InventoryItem','InitEmoji',4,1,2],
    ['InventoryItem','InitCharacterSkinItem',5,2,3],['InventoryItemDetails','UpdateItem',2,1,2]
  ]){
    const method=IL.method(type,name,count);
    hooks.push(Interceptor.attach(method.address,{onEnter(args){
      if(suppress)return;
      try{state();inventoryArgument(args,configIndex,rowIndex);record(type+'.'+name);}catch(error){notify(error,'inventory-view');}
    }}));
  }
  for(const [type,names] of [
    ['InventoryPage',['UpdateNoSubNavPage','UpdateSubNavPage','UpdateEmojiPage']],
    ['InventoryCustomPage',['UpdateInventoryList']]
  ])for(const name of names){
    const method=IL.methods(IL.klass(type)).find(m=>m.name===name);if(!method)throw Error('Missing cosmetic view: '+name);
    hooks.push(Interceptor.attach(method.address,{onEnter(args){
      if(suppress)return;
      try{
        state();const itemType=IL.read(args[0],'curType');
        if(!catalog.items.some(x=>x.type===itemType))return;
        const current=IL.read(args[0],'tempInventoryList');
        const existing=current.isNull()?[]:IL.list(current).map(x=>quiet(()=>IL.json(x)));
        const response=quiet(()=>IL.fromJson('InventoryResponse',{itemList:policy.inventory(existing,{itemType})}));
        IL.write(args[0],'tempInventoryList',IL.read(response,'itemList'));record(type+'.'+name);
      }catch(error){notify(error,'inventory-cache');}
    }}));
  }
  const players=IL.method('JapaneseMahjong.PlayerInfoMgr','Init',1);
  hooks.push(Interceptor.attach(players.address,{onEnter(args){
    if(suppress||args[1].isNull())return;
    try{state();for(const player of IL.list(args[1]))if(patchOwnPlayer(player))record('PlayerInfoMgr.Init');}
    catch(error){notify(error,'match-view');}
  }}));
  const room=IL.method('RoomPlayerItem','UpdateUI',3);
  hooks.push(Interceptor.attach(room.address,{onEnter(args){
    if(suppress||args[1].isNull())return;
    try{
      state();if(patchOwnPlayer(args[1]))record('RoomPlayerItem.UpdateUI');
    }catch(error){notify(error,'room-view');}
  }}));
}
function unlockInfo(info){
  if(!info||info.isNull())return info;
  const kind=IL.read(info,'lockType');
  if(![2,3,4,5,6].includes(kind))return info;
  return quiet(()=>IL.fromJson('DataModel.UnlockInfo',{lockType:0,level:0}));
}
function restoreLocalAppearance(){
  const user=IL.staticRead('Gvar','userInfo');
  if(!user||user.isNull()||String(IL.read(user,'uid'))==='0')return false;
  synchronize(state(),policy.applyResponse());return true;
}
function watchLobby(){
  let pending=true;
  for(const [type,names] of [
    ['LobbyMgr',['Start','UpdateUsingItems','UpdateUsingLobbySet']],
    ['HomePage',['Start','UpdateCharacter','UpdateLobbyBg']]
  ])for(const name of names){
    const method=IL.method(type,name,0);
    hooks.push(Interceptor.attach(method.address,{onEnter(){
      if(suppress)return;
      try{restoreLocalAppearance();if(type==='LobbyMgr'&&name==='Start')pending=true;}
      catch(error){notify(error,'lobby-restore');}
    }}));
  }
  const currentScene=IL.method('AppMgr','GetCurrentScene',0);
  const update=IL.method('AppMgr','Update',0);
  hooks.push(Interceptor.attach(update.address,{onEnter(args){
    if(!pending||suppress)return;
    try{
      const scene=IL.string(IL.invoke(currentScene,args[0]));
      const main=IL.staticRead('AppMgr','MAIN_SCENE');
      if(!scene||scene!==main)return;
      const lobby=IL.staticRead('LobbyMgr','_instance');if(!lobby||lobby.isNull())return;
      const home=IL.read(lobby,'homePage');if(!home||home.isNull()||!restoreLocalAppearance())return;
      pending=false;
      IL.invoke(IL.method('LobbyMgr','UpdateUsingLobbySet',0),lobby);
      IL.invoke(IL.method('LobbyMgr','UpdateUsingItems',0),lobby);
      stats.views['login-restore']=(stats.views['login-restore']||0)+1;
      send({event:'lobby-restored'});
    }catch(error){pending=false;notify(error,'lobby-initial-refresh');}
  }}));
}
function watchPreviews(){
  const getter=IL.method('VoiceUnlockConfig','GetClipByKey',1);
  hooks.push(Interceptor.attach(getter.address,{onLeave(result){try{if(!result.isNull())result.replace(unlockInfo(result));}catch(error){notify(error,'voice');}}}));
  const details=IL.method('CharacterDetails','InitUI',0);
  hooks.push(Interceptor.attach(details.address,{onEnter(args){try{
    const config=IL.read(args[0],'characterConfig');
    for(const name of ['emojiUnlockList','voiceVariantUnlockList','cutinVariantUnlockList']) {
      for(const info of IL.list(IL.read(config,name)))if([2,3,4,5,6].includes(IL.read(info,'lockType'))){IL.write(info,'lockType',0);IL.write(info,'level',0);}
    }
  }catch(error){notify(error,'cosmetic-preview');}}}));
  const show=IL.method('CharacterDetails','ShowVoiceTag',0);
  hooks.push(Interceptor.attach(show.address,{onEnter(args){try{for(const row of IL.list(IL.read(args[0],'voiceUnlockList'))){const info=IL.read(row,'unlockInfo'),unlocked=unlockInfo(info);if(!unlocked.equals(info))IL.write(row,'unlockInfo',unlocked);}}catch(error){notify(error,'voice-list');}}}));
}
rpc.exports={
  configure(data,preferences){return IL.attached(()=>{
    if(hooks.length)throw Error('Plugin is already active');
    const user=IL.staticRead('Gvar','userInfo');
    if(!user||user.isNull()||!IL.read(user,'uid')||String(IL.read(user,'uid'))==='0')return {active:false,waiting:true};
    catalog=data;profiles=preferences;verifyReferences();state();
    const methods=IL.methods(IL.klass('NetworkMgr'));let count=0;
    for(const m of methods)if(localOperations.has(m.name)||readOperations.has(m.name)){watchFactory(m);count++;}
    if(count!==localOperations.size+readOperations.size)throw Error('Client API changed; refusing partial installation');
    watchResponses();watchViews();watchPreviews();watchLobby();return {active:true,operations:localOperations.size,categories:new Set(catalog.items.map(x=>x.type)).size};
  });},
  verify(){return IL.attached(()=>({references:verifyReferences()}));},
  status(){return {...stats,active:hooks.length>0};},
  stop(){hooks.splice(0).forEach(x=>x.detach());jobs.clear();scopes.clear();hookedMoves.clear();return {active:false};}
};
