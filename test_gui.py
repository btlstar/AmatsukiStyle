import time
import tkinter as tk
import unittest
from unittest.mock import patch
import gui


class WorkerRecovery(unittest.TestCase):
    def test_failed_connection_releases_controls(self):
        root = tk.Tk(); root.withdraw()
        try:
            with patch.object(gui.service, 'load_game', return_value=''):
                app = gui.Application(root)
            app.game.set('fixture')
            with patch.object(gui.service, 'normalize_game', return_value='fixture'), patch.object(gui.service, 'save_game'), patch.object(gui.service, 'run', side_effect=ValueError('connection failed')):
                app.start()
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and 'connection failed' not in app.message.get():
                    root.update(); time.sleep(.02)
            app.receive()
            self.assertFalse(app.active())
            self.assertIn('connection failed', app.message.get())
            self.assertEqual(str(app.connect['state']), 'normal')
            self.assertEqual(str(app.disconnect['state']), 'disabled')
        finally:
            root.destroy()


if __name__ == '__main__': unittest.main()
