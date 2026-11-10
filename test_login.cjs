const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let user = null;
const notices = [];
const context = { send: value => notices.push(value), rpc: { exports: {} }, IL: {
  attached: action => action(),
  staticRead: () => user,
  read: () => '0',
} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, 'agent.js'), 'utf8'), context);
for (const value of [null, { isNull: () => true }, { isNull: () => false }]) {
  user = value;
  const result = context.rpc.exports.configure({}, {});
  assert.equal(result.waiting, true);
  assert.equal(result.active, false);
  assert.equal(context.rpc.exports.status().active, false);
}
console.log('Login readiness: null, null pointer and zero UID stay waiting without installing hooks.');


const listeners = new Map(), writes = [], calls = [];
let scene = 'Game';
const home = { isNull: () => false };
const lobby = { isNull: () => false, homePage: home };
context.IL.staticRead = (type, name) => name === 'userInfo' ? user : name === '_instance' ? lobby : 'Main';
context.IL.read = (object, name) => object[name];
context.IL.string = value => {
  assert.equal(typeof value, 'object', 'IL.string accepts a managed pointer; staticRead already converts strings');
  return value.managed;
};
context.IL.method = (type, name) => ({ address: type + '.' + name, name });
context.IL.invoke = method => {
  if (method.name === 'GetCurrentScene') return { managed: scene };
  calls.push(method.name);
};
context.Interceptor = { attach(address, listener) {
  listeners.set(address, listener);
  return { detach() {} };
} };
context.state = () => user;
context.synchronize = (object, value) => writes.push(value);
vm.runInContext("policy={applyResponse(){return {usingItemId:[1060002,1070201],lobbySetItem:{lobbyBgItemId:1100002}};}}; watchLobby();", context);
const frame = () => listeners.get('AppMgr.Update').onEnter([{}]);
user = { isNull: () => false, uid: '42' };
frame();
assert.equal(writes.length, 0, 'Do not refresh lobby UI while in a match');
scene = 'Main';
user = null;
frame();
assert.equal(calls.length, 0, 'Wait for account data before rendering');
user = { isNull: () => false, uid: '42' };
frame();
assert.equal(writes[0].usingItemId[0], 1060002);
assert.equal(writes[0].lobbySetItem.lobbyBgItemId, 1100002);
assert.deepEqual(calls, ['UpdateUsingLobbySet', 'UpdateUsingItems']);
assert.equal(notices[0].event, 'lobby-restored');
frame();
assert.equal(calls.length, 2, 'Refresh once rather than on every frame');
listeners.get('LobbyMgr.Start').onEnter([]);
frame();
assert.equal(calls.length, 4, 'Restore again on returning to a new lobby scene');
console.log('Lobby restore: applies saved cosmetics before refresh, skips matches and waits for login.');
