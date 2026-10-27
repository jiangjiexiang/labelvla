Studio + LabelVLA experimental integration
URL: http://172.16.122.44:8001/studio/
Docker container: labelvla-studio-test; original LabelVLA remains on port 8000.
Server data directory: /home/robam/labelvla-docker/data, mounted at /data.
Studio source: studio-source.tar.gz (upstream commit d458fd5473114681e9e8df353867edeabde55df4, includes modifications and MIT license).
Built site and bridge: studio/; annotation frontend: web-static/.
Use the server dataset field to open a dataset. v2 annotations are saved inside its segments/ directory. Studio selects episode and frame; the annotation panel follows on opening. Save before closing the panel.
Limitations: LabelVLA annotation supports v2 only; browser video codec support varies; annotation backend uses one global dataset and is suitable for one user at a time; bbox drawing is on the main camera only. Studio data editing/export is separate from LabelVLA segment annotations.
