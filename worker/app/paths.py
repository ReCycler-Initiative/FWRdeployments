from pathlib import Path, PurePosixPath
from uuid import UUID


def project_file(media_dir: Path, project_id: UUID, supplied: str) -> Path:
    root = (media_dir / str(project_id)).resolve()
    path = Path(supplied)
    if not path.is_absolute():
        path = media_dir / path
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("Media path must be inside this project's media directory")
    if not resolved.is_file():
        raise ValueError("Workshop media file does not exist")
    return resolved


def artifact_file(root: Path, relative: str) -> Path:
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or "\\" in relative or not path.parts:
        raise ValueError("Unsafe artifact path")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()) or resolved == root.resolve():
        raise ValueError("Artifact path escapes the sandbox")
    return resolved
