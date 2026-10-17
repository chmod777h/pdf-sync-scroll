"""Package already-verified source and install assets using an explicit allowlist.
Run `pnpm verify` first, then `python3 scripts/package.py` (Python 3.9+).
"""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
source = [root / name for name in [
    'main.js', 'manifest.json', 'styles.css', 'versions.json', 'package.json',
    'pnpm-lock.yaml', 'eslint.config.mjs', 'LICENSE', 'README.md',
    'README.zh-CN.md', 'CHANGELOG.md', 'CONTRIBUTING.md', '.gitignore',
    '.gitattributes', '.editorconfig',
]]
for folder in ['docs', 'scripts', 'tests', '.github']:
    source += [p for p in (root / folder).rglob('*') if p.is_file()]
source = sorted(p for p in source if not p.name.startswith('._') and p.name != '.DS_Store')
for p in source:
    if any(part in {'node_modules', '__pycache__', '.obsidian'} for part in p.relative_to(root).parts) or p.name == 'data.json':
        raise ValueError(f'Unexpected private or generated source: {p.name}')
archives = []
with zipfile.ZipFile(artifacts / f'pdf-sync-scroll-{version}-source.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in source:
        z.write(p, 'pdf-sync-scroll/' + p.relative_to(root).as_posix())
    archives.append(Path(z.filename))
with zipfile.ZipFile(artifacts / f'pdf-sync-scroll-{version}-install.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ['main.js', 'manifest.json', 'styles.css']:
        data = (root / 'dist' / name).read_bytes()
        if data != (root / name).read_bytes():
            raise ValueError('Stale build; run pnpm verify first')
        z.writestr('pdf-sync-scroll/' + name, data)
    archives.append(Path(z.filename))
for archive in archives:
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
    print(f'{archive.name}: {archive.stat().st_size} bytes')
(artifacts / 'ARCHIVE-SHA256SUMS.txt').write_text(''.join(
    f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in archives
))
