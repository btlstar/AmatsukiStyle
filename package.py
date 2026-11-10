"""Build an allowlisted standalone portable tool, without any game or user data."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from tool_version import TOOL_VERSION

ROOT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def licenses(target):
    target.mkdir()
    for distribution in importlib.metadata.distributions():
        for file in distribution.files or []:
            parts = Path(str(file)).parts
            if any(part in {"..", "/"} for part in parts):
                continue
            if not any(part.lower().startswith(("license", "copying", "notice", "copyright")) for part in parts):
                continue
            source = Path(distribution.locate_file(file))
            if not source.is_file():
                continue
            destination = target / distribution.metadata["Name"] / Path(*parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    shutil.copy2(python_license, target / "Python-LICENSE.txt")


def main():
    name = f"AmatsukiStyle-{TOOL_VERSION}-windows-x64"
    stage = ROOT / "dist" / name
    if stage.exists():
        raise ValueError("Release folder already exists; inspect it before rebuilding.")
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--windowed", "--onedir", "--noupx", "--name", "AmatsukiStyle", "--distpath", "build/frozen", "--workpath", "build/work", "--specpath", "build", "--copy-metadata", "frida", "--copy-metadata", "UnityPy"]
    for file in ["agent.js", "cosmetics.js", "il2cpp.js", "plugin.toml"]:
        command += ["--add-data", str(ROOT / file) + ";."]
    for module in ["UnityPy", "archspec", "astc_encoder", "fmod_toolkit", "etcpak", "texture2ddecoder", "tpk_ar"]:
        command += ["--collect-all", module]
    command += [str(ROOT / "gui.py")]
    subprocess.run(command, cwd=ROOT, check=True)
    shutil.copytree(ROOT / "build/frozen/AmatsukiStyle", stage)
    for file in ["README.md", "LICENSE.txt", "NOTICE"]:
        shutil.copy2(ROOT / file, stage / file)
    licenses(stage / "LICENSES")
    files = {str(p.relative_to(stage)).replace("\\", "/"): digest(p) for p in sorted(stage.rglob("*")) if p.is_file()}
    assert not any(Path(p).parts[0] in {".local", ".venv", "game", "logs", "originals", "staged"} for p in files)
    private_notes = {"COMMIT_MESSAGE.md", "VALIDATION.md", "RELEASE_NOTES.md", "AMATSUKI_FEASIBILITY.md"}
    assert not any(Path(p).name in private_notes or set(Path(p).parts) & {"docs", "notes", "research"} for p in files)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    manifest = {"version": TOOL_VERSION, "source_commit": commit, "game": "Amatsuki Mahjong", "files": files}
    (stage / "MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
    archive = ROOT / "dist" / (name + ".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file in sorted(stage.rglob("*")):
            if file.is_file():
                z.write(file, Path(name) / file.relative_to(stage))
    archive.with_suffix(".zip.sha256").write_text(digest(archive) + "  " + archive.name + "\n", encoding="ascii")
    print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size, "files": len(files), "sha256": digest(archive)}))


if __name__ == "__main__":
    main()
