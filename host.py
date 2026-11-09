"""Attach the local cosmetic preview plugin to an already running game."""
import argparse
import json
import os
from pathlib import Path
import signal
import tempfile
import time
import frida
from catalog import Catalog


def atomic_json(path, value):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('game', type=Path)
    parser.add_argument('--data-dir', type=Path, default=Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'AmatsukiStyle')
    parser.add_argument('--status-file', type=Path)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    game = args.game.resolve()
    definitions = Catalog(game).cosmetics()
    processes = [p for p in frida.get_local_device().enumerate_processes() if p.name.lower() == 'mahjongp.exe']
    if len(processes) != 1:
        raise ValueError('请启动天月并登录，且只保留一个游戏进程。')
    profiles = {}
    for path in (args.data_dir / 'profiles').glob('*.json'):
        if len(path.stem) != 64 or any(c not in '0123456789abcdef' for c in path.stem):
            continue
        value = json.loads(path.read_text('utf8'))
        if value.get('schema') != 1:
            raise ValueError('本地选择格式不受支持，请保留原文件。')
        profiles[path.stem] = value
    root = Path(__file__).resolve().parent
    source = '\n'.join((root / name).read_text('utf8') for name in ['il2cpp.js', 'cosmetics.js', 'agent.js'])
    running = True
    errors = []
    def message(data, binary):
        if data.get('type') == 'send':
            value = data['payload']
            if value.get('event') == 'preferences':
                key = value['account']
                if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
                    errors.append('Invalid profile key')
                    return
                atomic_json(args.data_dir / 'profiles' / (key + '.json'), value['preferences'])
            elif value.get('event') == 'error':
                errors.append({k: value.get(k) for k in ['operation', 'message', 'stack']})
        elif data.get('type') == 'error':
            errors.append(data.get('description', 'Agent error'))
    def stop(*unused):
        nonlocal running
        running = False
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    session = frida.attach(processes[0].pid)
    session.on('detached', lambda *unused: stop())
    try:
        script = session.create_script(source)
        script.on('message', message)
        script.load()
        if args.verify_only:
            print(json.dumps(script.exports_sync.verify()), flush=True)
            return
        result = script.exports_sync.configure(definitions, profiles)
        print(json.dumps(result), flush=True)
        while running:
            if args.status_file:
                atomic_json(args.status_file, {**script.exports_sync.status(), 'errors': errors[-10:]})
            time.sleep(1)
    finally:
        try:
            script.exports_sync.stop()
        except Exception:
            pass
        try:
            session.detach()
        except frida.InvalidOperationError:
            pass
        if args.status_file:
            atomic_json(args.status_file, {'active': False, 'errors': errors[-10:]})


if __name__ == '__main__':
    main()
