Studio + LabelVLA unified prototype
URL: http://172.16.122.44:8002/
Container: labelvla-studio-integrated (runs as robam UID 1000). Data: /home/robam/labelvla-docker/data mounted as /data.
Source: source.tar.gz includes upstream MIT license and modifications; upstream d458fd5473114681e9e8df353867edeabde55df4. Built UI and bridge: studio/.
Select server dataset and use the annotation panel. Segments, bboxes and manually placed motion keypoints are stored in existing LabelVLA segments/episode_XXXXXX.json format. Annotation uses first visual camera; both v2.x and v3.0 are supported (v3 episode lengths are read from meta/episodes/chunk-*/file-*.parquet). Studio native export does not include LabelVLA annotations.
Save uses dataset-specific API, hash conflict detection and atomic replacement; concurrent use of legacy LabelVLA service should still be avoided.

SAM 3.1 smart segmentation (added 2026-10-29):
- Annotation panel "SAM 点选分割" mode: click a target on the first camera (Shift+click = negative point), then "传播跟踪" propagates the mask through the whole episode and writes per-frame trajectories into the current segment's bbox keypoints. Remember to save.
- Bridge proxies /api/bridge/sam/* to the SAM inference service (default http://8.147.114.158:8310, override with env SAM_BASE). SAM service code: /mnt/vdb/hz-jjx/sam3.1/web/app.py on that host (conda env /mnt/vdb/hz-jjx/conda_envs/sam31, port 8310, start with setsid; backups at web/app.py.bak-20261028). API contract: docs/sam3-api-requirements.md.
- v2 datasets upload the episode mp4 directly; v3 uploads the whole video file and maps frames via from_timestamp offset. Container has no requests/httpx — the proxy uses urllib. Do not mix text and point prompts in one SAM session (multiplex model only propagates one mode); the UI uses point prompts only.
- Studio rebuild: cd integration-v2/studio-src && BASE_PATH=/ npm run build, then rsync -a --delete --exclude bridge.py --exclude bridge_ext --exclude __pycache__ dist/ ../studio/ and docker restart labelvla-studio-integrated. BASE_PATH=/ is required because the app is deployed at the root path; /studio/* now redirects to /. bridge_ext 必须排除(里面是平台后端源码,不在 dist 里)。 Pre-SAM backup: integration-v2/studio.bak-20261029.
