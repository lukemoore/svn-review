#!/usr/bin/env python3
"""Set up Code Review, start its local server, and open the browser."""

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import venv
import webbrowser


ROOT = Path(__file__).resolve().parent
ADDRESS = ('127.0.0.1', 8765)
URL = f'http://{ADDRESS[0]}:{ADDRESS[1]}'


def main():
    server = None
    try:
        if sys.version_info < (3, 10):
            raise RuntimeError('Install Python 3.10 or later, then try again.')
        if not (shutil.which('git') or shutil.which('svn')):
            raise RuntimeError('Install Git or Subversion (svn), then try again.')
        # Do not open an unrelated service that happens to use our port.
        with socket.socket() as probe:
            if os.name != 'nt':
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(ADDRESS)
            except OSError as error:
                raise RuntimeError(
                    f'Port {ADDRESS[1]} is in use. '
                    'Stop the existing server first.'
                ) from error

        python = prepare_environment()
        run(python, ROOT / 'manage.py', 'migrate', '--noinput')
        print(f'Starting Code Review at {URL}', flush=True)
        server = subprocess.Popen([
            str(python), str(ROOT / 'manage.py'), 'runserver',
            f'{ADDRESS[0]}:{ADDRESS[1]}', '--noreload'], cwd=ROOT)
        wait_for_server(server)
        print('Keep this terminal open. Press Ctrl+C to stop.', flush=True)
        try:
            opened = webbrowser.open(URL, new=2)
        except webbrowser.Error:
            opened = False
        if not opened:
            print(f'Open {URL} in your browser.', flush=True)
        return server.wait()
    except KeyboardInterrupt:
        print('\nStopping Code Review.', flush=True)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Could not start Code Review: {error}', file=sys.stderr)
        return 1
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


def prepare_environment():
    directory = ROOT / '.venv'
    python = directory / ('Scripts/python.exe' if os.name == 'nt' else
                          'bin/python')
    if not python.exists():
        print('Creating the Python environment...', flush=True)
        venv.EnvBuilder(with_pip=True).create(directory)
    requirements = ROOT / 'requirements.txt'
    marker = directory / 'svn-review-requirements.txt'
    contents = requirements.read_text()
    if not marker.exists() or marker.read_text() != contents:
        print('Installing dependencies...', flush=True)
        run(python, '-m', 'pip', 'install', '-r', requirements)
        marker.write_text(contents)
    return python


def run(*args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)


def wait_for_server(server):
    # Ignore proxy settings for this local readiness check.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError('The server exited before it was ready.')
        try:
            with opener.open(URL, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise RuntimeError('The server did not become ready within 30 seconds.')


if __name__ == '__main__':
    sys.exit(main())
