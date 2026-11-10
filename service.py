"""Game connection lifecycle for the standalone cosmetics manager."""
import json
import os
from pathlib import Path
import subprocess
import threading
import frida
from runtime import Cosmetics, save_profile


def data_root():
    return Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'AmatsukiStyle'


def normalize_game(value):
    game = Path(value).expanduser().resolve()
    if game.is_file() and game.name.lower() == 'mahjongp.exe':
        game = game.parent
    if not (game / 'mahjongP.exe').is_file():
        raise ValueError('请选择包含 mahjongP.exe 的天月麻雀安装目录。')
    return game


def load_game():
    try:
        value = json.loads((data_root() / 'gui.json').read_text('utf8')).get('game', '')
        if isinstance(value, str) and value:
            return value
    except (OSError, ValueError, AttributeError):
        pass
    roots = [os.environ.get('ProgramFiles(x86)', ''), r'D:\Program Files (x86)', r'C:\Program Files (x86)']
    return next((str(Path(p) / 'Steam/steamapps/common/天月麻雀') for p in roots if p and (Path(p) / 'Steam/steamapps/common/天月麻雀/mahjongP.exe').is_file()), '')


def save_game(game):
    save_profile(data_root() / 'gui.json', {'game': str(normalize_game(game))})


def candidates(device, game):
    exe = os.path.normcase(str(game / 'mahjongP.exe'))
    return [p for p in device.enumerate_processes(scope='full') if p.name.lower() == 'mahjongp.exe' and os.path.normcase(p.parameters.get('path', '')) == exe]


def launch(game):
    game = normalize_game(game)
    if not candidates(frida.get_local_device(), game):
        subprocess.Popen([str(game / 'mahjongP.exe')], cwd=game)


READY_SCRIPT = '''rpc.exports={ready(){
  const module=Process.findModuleByName('GameAssembly.dll');
  if(!module)return false;
  const domain=new NativeFunction(module.getExportByName('il2cpp_domain_get'),'pointer',[]);
  return !domain().isNull();
}};'''


def run(game, stop, report, *, device=None, factory=Cosmetics):
    game = normalize_game(game)
    device = device or frida.get_local_device()
    last = None
    def status(state, message):
        nonlocal last
        value = {'state': state, 'message': message}
        if value != last:
            report(value)
            last = value
    while not stop.is_set():
        session = cosmetic = readiness = None
        detached = threading.Event()
        try:
            processes = candidates(device, game)
            if len(processes) != 1:
                status('waiting_game', '等待启动天月麻雀。' if not processes else '等待客户端启动完成，请只保留一个游戏窗口。')
                stop.wait(1)
                continue
            session = device.attach(processes[0].pid)
            session.on('detached', lambda *args: detached.set())
            readiness = session.create_script(READY_SCRIPT)
            readiness.load()
            while not stop.is_set() and not detached.is_set() and not readiness.exports_sync.ready():
                status('waiting_game', '等待客户端初始化。')
                stop.wait(.5)
            if stop.is_set() or detached.is_set():
                continue
            readiness.unload()
            readiness = None
            cosmetic = factory(session, game, lambda message: status('active', message))
            configured = False
            while not stop.is_set() and not detached.is_set():
                if not configured:
                    configured = cosmetic.poll()
                    status('active' if configured else 'waiting_login', '本地装扮已启用，选择会自动保存在本机。' if configured else '等待登录天月麻雀，登录后自动恢复本地装扮。')
                stop.wait(.5)
        except (frida.ProcessNotFoundError, frida.InvalidOperationError):
            if not stop.is_set():
                status('waiting_game', '连接已断开，等待客户端重新启动。')
        except Exception as error:
            status('error', str(error))
            return
        finally:
            if cosmetic:
                cosmetic.close()
            if readiness:
                try:
                    readiness.unload()
                except frida.InvalidOperationError:
                    pass
            if session:
                try:
                    session.detach()
                except frida.InvalidOperationError:
                    pass
        if not stop.is_set():
            status('waiting_game', '游戏已退出，等待下次启动后自动连接。')
            stop.wait(1)
    status('stopped', '连接已停止。需要恢复官方显示时，请重新启动游戏。')
