"""Command-line entry for the standalone AmatsukiStyle connection."""
import argparse
import json
from pathlib import Path
import signal
import threading
from runtime import save_profile
from service import run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('game', type=Path)
    parser.add_argument('--status-file', type=Path)
    args = parser.parse_args()
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *unused: stop.set())
    signal.signal(signal.SIGTERM, lambda *unused: stop.set())
    output_lock = threading.Lock()
    def report(value):
        with output_lock:
            if args.status_file:
                save_profile(args.status_file, value)
            print(json.dumps(value, ensure_ascii=False), flush=True)
    run(args.game, stop, report)


if __name__ == '__main__':
    main()
