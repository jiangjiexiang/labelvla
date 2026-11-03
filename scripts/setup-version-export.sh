#!/usr/bin/env bash
set -euo pipefail
container_name="${1:-labelvla-studio-integrated}"
docker exec "$container_name" python -m pip install --upgrade --target /data/.platform/tools/ffmpeg-package imageio-ffmpeg==0.6.0
docker exec -e PYTHONPATH=/data/.platform/tools/ffmpeg-package "$container_name" python -c 'from pathlib import Path; import shutil, imageio_ffmpeg; target=Path("/data/.platform/tools/ffmpeg"); shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(),target); target.chmod(0o755); print(target)'
docker exec "$container_name" /data/.platform/tools/ffmpeg -version
