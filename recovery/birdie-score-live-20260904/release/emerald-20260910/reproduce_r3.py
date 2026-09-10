"""Reproduce the pinned offline R3 review from original D.1 plus reviewed deltas.
No dependency installation, network request, merge or production deployment.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import zipfile

MANIFEST_SHA256 = '4524f89a9856dd7093c22d4ab7e545956d88732011a25598f2b52cf1280652cf'

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def child(root: Path, relative: str) -> Path:
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Path outside review root')
    return target

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base-zip', required=True, type=Path)
    ap.add_argument('--handoff', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    args = ap.parse_args()
    manifest_file = args.handoff / 'MANIFEST.json'
    if digest(manifest_file) != MANIFEST_SHA256:
        raise ValueError('Not the reviewed R3 manifest')
    m = json.loads(manifest_file.read_text())
    if digest(args.base_zip) != m['base_zip_sha256']:
        raise ValueError('Not the pinned original D.1 archive')
    if args.out.exists():
        raise ValueError('Output exists; refusing overwrite')
    with tempfile.TemporaryDirectory(prefix='birdie-r3-') as temp:
        root = Path(temp)
        with zipfile.ZipFile(args.base_zip) as z:
            entries = z.infolist()
            if len(entries) > 2000 or sum(e.file_size for e in entries) > 100_000_000:
                raise ValueError('Unexpected archive size')
            for e in entries:
                child(root, e.filename)
                if stat.S_ISLNK(e.external_attr >> 16):
                    raise ValueError('Archive symlinks are not accepted')
            z.extractall(root)
        work = child(root, m['base_root'])
        for entry in m['protected']:
            if digest(child(work, entry['path'])) != entry['sha256']:
                raise ValueError('Protected source changed: ' + entry['path'])
        for entry in m['changes']:
            target = child(work, entry['path'])
            source = child(args.handoff / 'source', entry['path'])
            if entry['before'] is None:
                if target.exists():
                    raise ValueError('Unexpected baseline file: ' + entry['path'])
            elif digest(target) != entry['before']:
                raise ValueError('Wrong baseline: ' + entry['path'])
            if digest(source) != entry['after']:
                raise ValueError('Wrong reviewed delta: ' + entry['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        entry = m['builder']
        source = child(args.handoff / 'source', entry['path'])
        if digest(source) != entry['sha256']:
            raise ValueError('Wrong builder')
        shutil.copyfile(source, child(work, entry['path']))
        subprocess.run(['node', entry['path']], cwd=work, check=True, timeout=120)
        proof = child(work, 'dist-launch-r3/' + m['proof_file'])
        if digest(proof) != m['proof_sha256']:
            raise ValueError('Build does not match reviewed bytes')
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open('xb') as dest, proof.open('rb') as src:
            shutil.copyfileobj(src, dest)
        print(json.dumps({'status': 'LOCAL_REVIEW_REPRODUCED', 'sha256': m['proof_sha256'],
                          'output': str(args.out), 'production_authorized': False}))

if __name__ == '__main__':
    main()
