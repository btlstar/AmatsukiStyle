"""Prevent two cosmetic adapters from modifying the same client installation."""
import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path


class SessionLock:
    def __init__(self, game):
        self.handle = None
        if os.name != 'nt':
            raise OSError('AmatsukiStyle 目前仅支持 Windows。')
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        self.kernel.CreateMutexW.restype = wintypes.HANDLE
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        key = hashlib.sha256(str(Path(game).resolve()).casefold().encode()).hexdigest()
        handle = self.kernel.CreateMutexW(None, False, 'Local\\AmatsukiStyle.' + key)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        result = self.kernel.WaitForSingleObject(handle, 0)
        if result not in (0, 0x80):
            self.kernel.CloseHandle(handle)
            raise ValueError('该游戏已连接其他装扮工具。请先停止另一个装扮连接，再重新连接。')
        self.handle = handle

    def close(self):
        if self.handle:
            self.kernel.ReleaseMutex(self.handle)
            self.kernel.CloseHandle(self.handle)
            self.handle = None
