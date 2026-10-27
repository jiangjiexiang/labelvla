from __future__ import annotations

import os
from dataclasses import asdict
from pathlib import Path
from threading import Lock
from typing import Any

import cv2
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from loguru import logger

from labelme.lerobot.dataset import LeRobotDataset
from labelme.lerobot.segment import BBox
from labelme.lerobot.segment import MotionKeypoint
from labelme.lerobot.segment import Segment
from labelme.lerobot.segment import SegmentStore


class _ServerState:
    """Holds the one currently-loaded dataset. Not safe for concurrent writes."""

    dataset: LeRobotDataset | None
    _lock: Lock
    # Serialize cv2.VideoCapture access. OpenCV's ffmpeg backend is not
    # thread-safe: concurrent set()/read() from uvicorn's threadpool trips
    # "Assertion fctx->async_lock failed" in libavcodec/pthread_frame.c.
    # One global lock is enough — frame decode is ~10–50 ms each and
    # sequential throughput (tens of fps) is plenty for interactive seek.
    video_lock: Lock

    def __init__(self) -> None:
        self.dataset = None
        self._lock = Lock()
        self.video_lock = Lock()

    def set_dataset(self, path: Path) -> LeRobotDataset:
        with self._lock:
            if not LeRobotDataset.is_lerobot_dataset(path):
                raise HTTPException(
                    status_code=400,
                    detail=f"Not a LeRobot dataset: {path}",
                )
            if self.dataset is not None:
                self.dataset.close()
            self.dataset = LeRobotDataset(Path(path))
            logger.info("Loaded dataset: {}", self.dataset.root)
            return self.dataset

    def require(self) -> LeRobotDataset:
        if self.dataset is None:
            raise HTTPException(
                status_code=404,
                detail="No dataset loaded. Open one via /api/dataset?path=...",
            )
        return self.dataset


def _serialize_dataset(ds: LeRobotDataset) -> dict[str, Any]:
    return {
        "path": str(ds.root),
        "fps": ds.fps,
        "num_episodes": ds.num_episodes,
        "episodes": [
            {"index": i, "length": ds.episode_length(i)}
            for i in range(ds.num_episodes)
        ],
        "camera_keys": ds.camera_keys,
        "joint_names": ds.joint_names,
    }


def _serialize_segments(segments: list[Segment]) -> dict[str, Any]:
    out: list[dict[str, Any]] = []
    for s in segments:
        seg_dict = asdict(s)
        out.append(seg_dict)
    return {"segments": out}


def _deserialize_segments(payload: list[dict[str, Any]]) -> list[Segment]:
    segments: list[Segment] = []
    for s in payload:
        bboxes: list[BBox] = []
        for b in s.get("bboxes", []):
            kps = [MotionKeypoint(**k) for k in b.get("keypoints", [])]
            kwargs: dict[str, Any] = dict(
                x=float(b["x"]),
                y=float(b["y"]),
                width=float(b["width"]),
                height=float(b["height"]),
                label=str(b["label"]),
                keypoints=kps,
            )
            if b.get("id") is not None:
                kwargs["id"] = int(b["id"])
            bboxes.append(BBox(**kwargs))
        segments.append(
            Segment(
                start_frame=int(s["start_frame"]),
                end_frame=int(s["end_frame"]),
                text=str(s.get("text", "")),
                bboxes=bboxes,
            )
        )
    return segments


def _allowed_roots() -> list[Path]:
    """Directories the browser may walk. Configured via LABELVLA_DATA_ROOTS."""
    raw = os.environ.get("LABELVLA_DATA_ROOTS", "/data")
    roots = [Path(p).expanduser().resolve() for p in raw.split(":") if p.strip()]
    usable = [r for r in roots if r.is_dir()]
    return usable or [Path("/")]


def _resolve_within_roots(raw: str | None) -> Path:
    roots = _allowed_roots()
    if raw:
        target = Path(raw).expanduser().resolve()
    else:
        target = roots[0]
    if not any(target == r or r in target.parents for r in roots):
        raise HTTPException(
            status_code=403,
            detail=(
                "Path is outside the browsable roots: "
                + ", ".join(str(r) for r in roots)
            ),
        )
    if not target.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {target}")
    return target


def create_app(initial_dataset: Path | None = None) -> FastAPI:
    app = FastAPI(title="LabelVLA Remote Server", version="0.1.0")
    state = _ServerState()

    if initial_dataset is not None:
        state.set_dataset(initial_dataset)

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.middleware("http")
    async def _revalidate_static(request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/api/dataset")
    def get_dataset(path: str | None = None) -> dict[str, Any]:
        if path is not None:
            state.set_dataset(Path(path))
        ds = state.require()
        return _serialize_dataset(ds)

    @app.get("/api/fs")
    def browse_fs(path: str | None = None) -> dict[str, Any]:
        """List sub-directories of ``path`` for the dataset picker."""
        roots = _allowed_roots()
        cur = _resolve_within_roots(path)
        entries: list[dict[str, Any]] = []
        try:
            children = sorted(cur.iterdir(), key=lambda p: p.name.lower())
        except PermissionError as e:
            raise HTTPException(403, f"Permission denied: {cur}") from e
        for child in children:
            if child.name.startswith("."):
                continue
            try:
                if not child.is_dir():
                    continue
            except OSError:
                continue
            entries.append(
                {
                    "name": child.name,
                    "path": str(child),
                    "is_dataset": LeRobotDataset.is_lerobot_dataset(child),
                }
            )
        parent = None
        if cur != cur.parent and any(
            cur.parent == r or r in cur.parent.parents for r in roots
        ):
            parent = str(cur.parent)
        return {
            "path": str(cur),
            "parent": parent,
            "roots": [str(r) for r in roots],
            "is_dataset": LeRobotDataset.is_lerobot_dataset(cur),
            "entries": entries,
        }

    @app.get("/api/datasets")
    def scan_datasets(path: str | None = None, depth: int = 3) -> dict[str, Any]:
        """Recursively find LeRobot datasets under ``path``."""
        root = _resolve_within_roots(path)
        found: list[dict[str, Any]] = []
        max_depth = max(0, min(int(depth), 6))

        def walk(node: Path, level: int) -> None:
            if len(found) >= 200 or level > max_depth:
                return
            if LeRobotDataset.is_lerobot_dataset(node):
                found.append({"name": node.name, "path": str(node)})
                return
            try:
                children = sorted(node.iterdir(), key=lambda p: p.name.lower())
            except (PermissionError, OSError):
                return
            for child in children:
                if child.name.startswith("."):
                    continue
                if child.is_dir():
                    walk(child, level + 1)

        walk(root, 0)
        return {"root": str(root), "datasets": found}


    @app.get("/api/episode/{episode_idx}/states")
    def get_states(episode_idx: int) -> dict[str, Any]:
        ds = state.require()
        if not 0 <= episode_idx < ds.num_episodes:
            raise HTTPException(404, f"Episode {episode_idx} out of range")
        states = ds.load_episode_states(episode_idx)
        return {
            "joint_names": ds.joint_names,
            "data": states.tolist(),
        }

    @app.get("/api/episode/{episode_idx}/frame/{frame_idx}")
    def get_frame(
        episode_idx: int, frame_idx: int, camera: str, quality: int = 85
    ) -> Response:
        ds = state.require()
        if camera not in ds.camera_keys:
            raise HTTPException(
                404, f"Unknown camera: {camera}. Available: {ds.camera_keys}"
            )
        try:
            with state.video_lock:
                img = ds.extract_frame(episode_idx, camera, frame_idx)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(404, str(e)) from e
        ok, buf = cv2.imencode(
            ".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(quality)]
        )
        if not ok:
            raise HTTPException(500, "Failed to encode frame")
        return Response(
            content=buf.tobytes(),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    @app.get("/api/episode/{episode_idx}/segments")
    def get_segments(episode_idx: int) -> dict[str, Any]:
        ds = state.require()
        if not 0 <= episode_idx < ds.num_episodes:
            raise HTTPException(404, f"Episode {episode_idx} out of range")
        store = SegmentStore(ds.root, episode_idx)
        store.load()
        return _serialize_segments(store.segments)

    @app.post("/api/episode/{episode_idx}/segments")
    def post_segments(
        episode_idx: int, payload: dict[str, Any]
    ) -> dict[str, Any]:
        ds = state.require()
        if not 0 <= episode_idx < ds.num_episodes:
            raise HTTPException(404, f"Episode {episode_idx} out of range")
        store = SegmentStore(ds.root, episode_idx)
        segments = _deserialize_segments(payload.get("segments", []))
        store.save(segments)
        logger.info(
            "Saved {} segments for episode {}", len(segments), episode_idx
        )
        return _serialize_segments(store.segments)

    static_dir = Path(__file__).parent / "static"

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(
            str(static_dir / "index.html"),
            headers={"Cache-Control": "no-store"},
        )

    app.mount(
        "/static",
        StaticFiles(directory=str(static_dir)),
        name="static",
    )

    return app
