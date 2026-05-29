PYTHON := .venv/bin/python
SOURCE_VIDEO := data/source/Nemesis.2026.S01E01.720p.HEVC.x265-MeGusta.mkv
OVERLAY_OUTPUT := data/output/sunglasses_full.mp4

.PHONY: install-video-deps overlay-server render-sunglasses-full render-sunglasses-20s render-facemesh-20s verify

install-video-deps:
	uv venv --seed .venv
	uv pip install --python $(PYTHON) -r apps/video-processor/requirements.txt

overlay-server:
	python3 apps/overlay-server/server.py --overlay-dir data/output --overlay-file sunglasses_full.mp4

render-sunglasses-full:
	cd apps/video-processor && ../../$(PYTHON) apply_face_mesh_filter.py \
		--effect sunglasses \
		--duration full \
		--source ../../$(SOURCE_VIDEO) \
		--output ../../$(OVERLAY_OUTPUT)

render-sunglasses-20s:
	cd apps/video-processor && ../../$(PYTHON) apply_face_mesh_filter.py \
		--effect sunglasses \
		--start 20:00 \
		--source ../../$(SOURCE_VIDEO) \
		--output ../../data/output/sunglasses_20m00s_10s_v2.mp4

render-facemesh-20s:
	cd apps/video-processor && ../../$(PYTHON) apply_face_mesh_filter.py \
		--effect mesh \
		--start 20:00 \
		--source ../../$(SOURCE_VIDEO) \
		--output ../../data/output/face_mesh_20m00s_10s.mp4

verify:
	$(PYTHON) -m py_compile apps/video-processor/apply_face_mesh_filter.py
	python3 -m py_compile apps/overlay-server/server.py
	python3 -m json.tool apps/netflix-watch-list-extension/manifest.json >/dev/null
