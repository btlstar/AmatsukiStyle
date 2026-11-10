"""Local cosmetic agent and per-account choice storage."""
import json
import os
from pathlib import Path
import tempfile
from catalog import Catalog
from session_lock import SessionLock


def save_profile(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.tmp', mode='w', encoding='utf8', delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Cosmetics:
    def __init__(self, session, game, report):
        self.report = report
        self.data = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'AmatsukiStyle' / 'profiles'
        profiles = {}
        for path in self.data.glob('*.json'):
            if self.valid_key(path.stem):
                value = json.loads(path.read_text('utf8'))
                if value.get('schema') != 1:
                    raise ValueError('本地装扮配置格式不受支持，请保留原文件。')
                profiles[path.stem] = value
        self.definitions = Catalog(game).cosmetics()
        self.profiles = profiles
        root = Path(__file__).resolve().parent
        source = '\n'.join((root / name).read_text('utf8') for name in ['il2cpp.js', 'cosmetics.js', 'agent.js'])
        self.lock = SessionLock(game)
        self.script = None
        try:
            self.script = session.create_script(source)
            self.script.on('message', self.message)
            self.script.load()
        except Exception:
            self.close()
            raise

    def poll(self):
        result = self.script.exports_sync.configure(self.definitions, self.profiles)
        if result.get('waiting') is True and result.get('active') is False:
            return False
        if result.get('active') is not True:
            raise ValueError('装扮插件未确认加载成功')
        return True

    @staticmethod
    def valid_key(key):
        return isinstance(key, str) and len(key) == 64 and all(c in '0123456789abcdef' for c in key)

    def message(self, message, binary):
        try:
            if message.get('type') == 'send':
                value = message['payload']
                if value.get('event') == 'preferences':
                    key = value.get('account')
                    if not self.valid_key(key):
                        raise ValueError('本地装扮配置标识无效')
                    save_profile(self.data / (key + '.json'), value['preferences'])
                elif value.get('event') == 'lobby-restored':
                    self.report('AmatsukiStyle 已恢复本地大厅装扮。')
                elif value.get('event') == 'error':
                    self.report('AmatsukiStyle：' + str(value.get('message', '装扮脚本异常')))
            elif message.get('type') == 'error':
                self.report('AmatsukiStyle：' + message.get('description', '装扮脚本异常'))
        except Exception as error:
            self.report('AmatsukiStyle 保存失败：' + str(error))

    def close(self):
        try:
            self.script.exports_sync.stop()
        except Exception:
            pass
        try:
            self.script.unload()
        except Exception:
            pass
        if getattr(self, 'lock', None):
            self.lock.close()

