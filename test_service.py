import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import service
from session_lock import SessionLock


class FastStop:
    def __init__(self): self.value = False
    def is_set(self): return self.value
    def set(self): self.value = True
    def wait(self, timeout): return self.value


class ConnectionTests(unittest.TestCase):
    def test_waits_for_login_and_closes_cleanly(self):
        with tempfile.TemporaryDirectory() as folder:
            game = Path(folder); (game / 'mahjongP.exe').touch()
            stop = FastStop(); events = []; closed = []
            initialized = iter([False, True])
            session = SimpleNamespace(on=lambda *args: None, detach=lambda: closed.append('session'))
            ready = SimpleNamespace(exports_sync=SimpleNamespace(ready=lambda: next(initialized)), load=lambda: None, unload=lambda: None)
            session.create_script = lambda source: ready
            device = SimpleNamespace(attach=lambda pid: session)
            results = iter([False, True])
            cosmetic = SimpleNamespace(poll=lambda: next(results), close=lambda: closed.append('cosmetic'))
            def report(value):
                events.append(value)
                if value['state'] == 'active': stop.set()
            with patch.object(service, 'candidates', return_value=[SimpleNamespace(pid=1)]):
                service.run(game, stop, report, device=device, factory=lambda *args: cosmetic)
            self.assertIn('waiting_login', [v['state'] for v in events])
            self.assertIn('active', [v['state'] for v in events])
            self.assertEqual(closed, ['cosmetic', 'session'])
            self.assertEqual(events[-1]['state'], 'stopped')

    def test_reconnects_to_replacement_game_process(self):
        with tempfile.TemporaryDirectory() as folder:
            game = Path(folder); (game / 'mahjongP.exe').touch()
            stop = FastStop(); sessions = []; events = []
            class Session:
                def __init__(self, pid): self.pid = pid; sessions.append(self)
                def on(self, event, callback): self.detached = callback
                def create_script(self, source):
                    return SimpleNamespace(load=lambda: None, unload=lambda: None, exports_sync=SimpleNamespace(ready=lambda: True))
                def detach(self): pass
            def factory(session, game, report):
                def poll():
                    if session.pid == 1: session.detached('process-terminated')
                    else: stop.set()
                    return True
                return SimpleNamespace(poll=poll, close=lambda: None)
            with patch.object(service, 'candidates', side_effect=lambda *args: [SimpleNamespace(pid=1 if not sessions else 2)]):
                service.run(game, stop, events.append, device=SimpleNamespace(attach=Session), factory=factory)
            self.assertEqual([s.pid for s in sessions], [1, 2])

    def test_lock_excludes_other_connection_threads_and_releases(self):
        with tempfile.TemporaryDirectory() as game:
            first = SessionLock(game)
            result = []
            def attempt():
                try:
                    lock = SessionLock(game)
                    lock.close(); result.append('acquired')
                except ValueError:
                    result.append('busy')
            worker = threading.Thread(target=attempt); worker.start(); worker.join()
            self.assertEqual(result, ['busy'])
            first.close()
            worker = threading.Thread(target=attempt); worker.start(); worker.join()
            self.assertEqual(result, ['busy', 'acquired'])


if __name__ == '__main__': unittest.main()
