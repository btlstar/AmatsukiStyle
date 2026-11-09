"use strict";
const IL = (() => {
  const module=Process.getModuleByName('GameAssembly.dll');
  const native=(name,result,args)=>new NativeFunction(module.getExportByName('il2cpp_'+name),result,args);
  const api={
    domain:native('domain_get','pointer',[]), attach:native('thread_attach','pointer',['pointer']), detach:native('thread_detach','void',['pointer']),
    assemblies:native('domain_get_assemblies','pointer',['pointer','pointer']),image:native('assembly_get_image','pointer',['pointer']),imageName:native('image_get_name','pointer',['pointer']),
    count:native('image_get_class_count','uint64',['pointer']),klass:native('image_get_class','pointer',['pointer','uint64']),parent:native('class_get_parent','pointer',['pointer']),classType:native('class_get_type','pointer',['pointer']),
    fromType:native('class_from_type','pointer',['pointer']),isEnum:native('class_is_enum','bool',['pointer']),name:native('class_get_name','pointer',['pointer']),typeName:native('type_get_name','pointer',['pointer']),typeObject:native('type_get_object','pointer',['pointer']),free:native('free','void',['pointer']),
    methods:native('class_get_methods','pointer',['pointer','pointer']),methodName:native('method_get_name','pointer',['pointer']),paramCount:native('method_get_param_count','uint',['pointer']),param:native('method_get_param','pointer',['pointer','uint']),
    fields:native('class_get_fields','pointer',['pointer','pointer']),fieldName:native('field_get_name','pointer',['pointer']),fieldType:native('field_get_type','pointer',['pointer']),fieldOffset:native('field_get_offset','int',['pointer']),fieldFlags:native('field_get_flags','uint',['pointer']),
    staticGet:native('field_static_get_value','void',['pointer','pointer']),fieldSet:native('field_set_value','void',['pointer','pointer','pointer']),
    barrier:native('gc_wbarrier_set_field','void',['pointer','pointer','pointer']),objectClass:native('object_get_class','pointer',['pointer']),invoke:native('runtime_invoke','pointer',['pointer','pointer','pointer','pointer']),
    stringNew:native('string_new','pointer',['pointer']),stringLength:native('string_length','int',['pointer']),stringChars:native('string_chars','pointer',['pointer'])
  };
  const classes=new Map();let initialized=false;
  const typeName=p=>{const s=api.typeName(p);try{return s.readUtf8String();}finally{api.free(s);}};
  function initialize(){
    if(initialized)return;
    const n=Memory.alloc(8),arr=api.assemblies(api.domain(),n);
    for(let i=0;i<Number(n.readU64());i++){
      const img=api.image(arr.add(i*8).readPointer());const name=api.imageName(img).readUtf8String();
      if(!['Assembly-CSharp.dll','Newtonsoft.Json.dll','mscorlib.dll'].includes(name))continue;
      for(let j=0;j<Number(api.count(img));j++){const c=api.klass(img,j);classes.set(typeName(api.classType(c)),c);}
    }
    initialized=true;
  }
  function klass(name){initialize();const c=classes.get(name);if(!c)throw Error('Missing managed type: '+name);return c;}
  function methods(c){
    const result=[];const it=Memory.alloc(8);it.writePointer(NULL);let m;
    while(!(m=api.methods(c,it)).isNull()){
      const params=[];for(let i=0;i<api.paramCount(m);i++)params.push(typeName(api.param(m,i)));
      result.push({handle:m,name:api.methodName(m).readUtf8String(),params,address:m.readPointer()});
    }
    return result;
  }
  function method(c,name,count,types){
    if(typeof c==='string')c=klass(c);
    for(let parent=c;!parent.isNull();parent=api.parent(parent)){
      const candidates=methods(parent).filter(m=>m.name===name&&m.params.length===count&&(!types||m.params.join('|')===types.join('|')));
      if(candidates.length===1)return candidates[0];
      if(candidates.length>1)throw Error('Ambiguous method: '+name);
    }
    throw Error('Missing method: '+name);
  }
  function fields(c){
    const all=[];
    for(let parent=c;!parent.isNull();parent=api.parent(parent)){
      const it=Memory.alloc(8);it.writePointer(NULL);let f;
      while(!(f=api.fields(parent,it)).isNull())all.push({handle:f,name:api.fieldName(f).readUtf8String(),type:typeName(api.fieldType(f)),offset:api.fieldOffset(f),flags:api.fieldFlags(f),enum:api.isEnum(api.fromType(api.fieldType(f)))});
    }
    return all;
  }
  function field(c,name){const f=fields(c).find(f=>f.name===name);if(!f)throw Error('Missing field: '+name);return f;}
  function readAt(p,type,isEnum=false){
    if(isEnum)return p.readS32();
    if(type==='System.Int32'||type==='System.UInt32')return p.readS32();
    if(type==='System.Int64')return p.readS64().toString();
    if(type==='System.Boolean')return p.readU8()!==0;
    if(type==='System.Single')return p.readFloat();
    if(type==='System.String')return string(p.readPointer());
    return p.readPointer();
  }
  function read(object,name){if(object.isNull())return null;const f=field(api.objectClass(object),name);return readAt(object.add(f.offset),f.type,f.enum);}
  function staticRead(type,name){const f=field(klass(type),name);const p=Memory.alloc(16);api.staticGet(f.handle,p);return readAt(p,f.type,f.enum);}
  function write(object,name,value){
    const f=field(api.objectClass(object),name);const p=Memory.alloc(16);
    if(f.type==='System.Boolean')p.writeU8(value?1:0);
    else if(f.enum||f.type==='System.Int32'||f.type==='System.UInt32')p.writeS32(value);
    else if(f.type==='System.Single')p.writeFloat(value);
    else {api.barrier(object,object.add(f.offset),value);return;}
    api.fieldSet(object,f.handle,p);
  }
  const managedString=value=>api.stringNew(Memory.allocUtf8String(value));
  function string(p){return p.isNull()?null:api.stringChars(p).readUtf16String(api.stringLength(p));}
  function invoke(m,object,args=[]){
    const parameters=Memory.alloc(Math.max(8,args.length*8));
    args.forEach((v,i)=>{let p=v;if(typeof v==='number'){p=Memory.alloc(8);p.writeS32(v);}parameters.add(i*8).writePointer(p);});
    const exception=Memory.alloc(8);exception.writePointer(NULL);const result=api.invoke(m.handle,object||NULL,parameters,exception);
    if(!exception.readPointer().isNull())throw Error('Managed call failed: '+m.name);
    return result;
  }
  let serializer,deserializer;
  function json(object){
    serializer ||= method('Newtonsoft.Json.JsonConvert','SerializeObject',1,['System.Object']);
    return JSON.parse(string(invoke(serializer,NULL,[object])).replace(/("uid"\s*:\s*)(\d{16,})/g,'$1"$2"'));
  }
  function fromJson(type,value){
    deserializer ||= method('Newtonsoft.Json.JsonConvert','DeserializeObject',2,['System.String','System.Type']);
    return invoke(deserializer,NULL,[managedString(JSON.stringify(value)),api.typeObject(api.classType(klass(type)))]);
  }
  function list(p){if(!p||p.isNull())return [];const size=read(p,'_size'),array=read(p,'_items');if(size<0||size>10000)throw Error('Invalid managed list size');return Array.from({length:size},(_,i)=>array.add(32+i*8).readPointer());}
  function ints(p,array=false){if(!p||p.isNull())return [];const n=array?Number(p.add(24).readU64()):read(p,'_size');const items=array?p:read(p,'_items');if(n<0||n>10000)throw Error('Invalid integer list size');return Array.from({length:n},(_,i)=>items.add(32+i*4).readS32());}
  function attached(action){const t=api.attach(api.domain());try{return action();}finally{api.detach(t);}}
  return {module,api,klass,method,methods,fields,field,read,write,staticRead,string,managedString,invoke,json,fromJson,list,ints,attached,typeName};
})();
