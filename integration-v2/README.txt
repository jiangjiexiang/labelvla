Studio + LabelVLA unified prototype
URL: http://172.16.122.44:8002/studio/
Container: labelvla-studio-integrated (runs as robam UID 1000). Data: /home/robam/labelvla-docker/data mounted as /data.
Source: source.tar.gz includes upstream MIT license and modifications; upstream d458fd5473114681e9e8df353867edeabde55df4. Built UI and bridge: studio/.
Select server dataset and use the annotation panel. Segments, bboxes and manually placed motion keypoints are stored in existing LabelVLA segments/episode_XXXXXX.json format. Annotation uses first visual camera; v2 only. v3 data can be browsed but v3 annotation is not implemented. Studio native export does not include LabelVLA annotations.
Save uses dataset-specific API, hash conflict detection and atomic replacement; concurrent use of legacy LabelVLA service should still be avoided.
