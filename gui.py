"""Standalone AmatsukiStyle desktop manager."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import queue
import sys
import threading
import tkinter as tk
from tkinter import filedialog, ttk
import service
from tool_version import TOOL_VERSION


class Application(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=26)
        self.pack(fill='both', expand=True)
        self.game = tk.StringVar(value=service.load_game())
        self.message = tk.StringVar(value='选择游戏目录后启用装扮。')
        self.events = queue.Queue()
        self.worker = None
        self.stop = threading.Event()
        self.closing = False
        ttk.Label(self, text='AmatsukiStyle', font=('Microsoft YaHei UI', 22, 'bold')).pack(anchor='w')
        ttk.Label(self, text=f'天月麻雀本地装扮 · {TOOL_VERSION}').pack(anchor='w', pady=(5, 24))
        ttk.Label(self, text='游戏目录（包含 mahjongP.exe）').pack(anchor='w')
        row = ttk.Frame(self)
        row.pack(fill='x', pady=(8, 20))
        self.entry = ttk.Entry(row, textvariable=self.game)
        self.entry.pack(side='left', fill='x', expand=True, ipady=4)
        self.browse = ttk.Button(row, text='选择目录…', command=self.choose)
        self.browse.pack(side='left', padx=(10, 0))
        panel = ttk.LabelFrame(self, text='连接状态', padding=16)
        panel.pack(fill='x')
        ttk.Label(panel, textvariable=self.message, wraplength=640, justify='left').pack(anchor='w')
        actions = ttk.Frame(self)
        actions.pack(fill='x', pady=22)
        self.connect = ttk.Button(actions, text='启用装扮', command=self.start)
        self.connect.pack(side='left', padx=(0, 12), ipadx=12, ipady=5)
        self.disconnect = ttk.Button(actions, text='停止连接', command=self.stop_connection, state='disabled')
        self.disconnect.pack(side='left', padx=(0, 12), ipadx=12, ipady=5)
        self.launch_button = ttk.Button(actions, text='启动游戏', command=self.launch)
        self.launch_button.pack(side='left', ipadx=12, ipady=5)
        for text in [
            '启用后登录游戏，在原有界面选择雀士、造型、装扮与套组。选择按账号保存在本机，登录大厅时自动恢复。',
            '保持本窗口运行；游戏重启后会自动连接。无需代理或证书，不修改游戏文件。',
            '停止连接后重新启动游戏可恢复官方显示。本工具不清除本地选择，也不改变真实购买和养成进度。',
            '已通过其他工具启用同一插件时，无需同时启用本工具。',
        ]:
            ttk.Label(self, text=text, wraplength=670, justify='left').pack(anchor='w', pady=(0, 14))
        master.protocol('WM_DELETE_WINDOW', self.close)
        self.after(100, self.receive)

    def active(self):
        return self.worker is not None and self.worker.is_alive()

    def controls(self):
        active = self.active()
        for widget in [self.entry, self.browse, self.connect]:
            widget.configure(state='disabled' if active else 'normal')
        self.disconnect.configure(state='normal' if active and not self.stop.is_set() else 'disabled')
        self.launch_button.configure(state='disabled' if self.closing else 'normal')

    def choose(self):
        value = filedialog.askdirectory(parent=self, title='选择天月麻雀安装目录', initialdir=self.game.get() or None)
        if value:
            self.game.set(value)

    def start(self):
        if self.active():
            return
        try:
            game = service.normalize_game(self.game.get().strip())
            service.save_game(game)
        except Exception as error:
            self.message.set(str(error))
            return
        self.stop = threading.Event()
        self.message.set('正在连接，请稍候…')
        def work():
            try:
                service.run(game, self.stop, self.events.put)
            except Exception as error:
                self.events.put({'state': 'error', 'message': str(error)})
            finally:
                self.events.put({'state': 'finished'})
        self.worker = threading.Thread(target=work, daemon=True)
        self.worker.start()
        self.controls()

    def launch(self):
        try:
            game = service.normalize_game(self.game.get().strip())
            service.launch(game)
            self.start()
        except Exception as error:
            self.message.set(str(error))

    def stop_connection(self):
        self.stop.set()
        self.message.set('正在停止连接…')
        self.controls()

    def receive(self):
        while True:
            try:
                value = self.events.get_nowait()
            except queue.Empty:
                break
            if 'message' in value:
                self.message.set(value['message'])
        self.controls()
        if self.closing and not self.active():
            self.master.destroy()
            return
        self.after(100, self.receive)

    def close(self):
        self.closing = True
        self.stop_connection()


def diagnostics(path):
    root = Path(__file__).resolve().parent
    for name in ['agent.js', 'cosmetics.js', 'il2cpp.js', 'plugin.toml']:
        if not (root / name).is_file():
            raise ValueError('缺少运行文件：' + name)
    result = {'version': TOOL_VERSION, 'frida': importlib.metadata.version('frida'), 'UnityPy': importlib.metadata.version('UnityPy'), 'tcl': tk.Tcl().call('info', 'patchlevel'), 'runtime_files': 'ok'}
    Path(path).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--diagnostics', type=Path)
    args = parser.parse_args()
    if args.diagnostics:
        diagnostics(args.diagnostics)
        return
    window = tk.Tk()
    window.title(f'AmatsukiStyle {TOOL_VERSION}')
    window.geometry('780x660')
    window.minsize(740, 620)
    style = ttk.Style(window)
    if 'vista' in style.theme_names():
        style.theme_use('vista')
    style.configure('.', font=('Microsoft YaHei UI', 10))
    Application(window)
    window.mainloop()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if sys.stderr:
            print(error, file=sys.stderr)
        sys.exit(1)
