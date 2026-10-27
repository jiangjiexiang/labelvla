"use strict";

/* ────────────────────────────────────────────────────────────────
   LabelVLA · Remote — browser UI that mirrors the desktop labelvla.
   Single-file vanilla JS, no dependencies.
   ──────────────────────────────────────────────────────────────── */

const SEG_COLORS = [
  "#3aa7ff", "#ff9a3c", "#6bd9a6", "#c179ff",
  "#ff5a5a", "#ffd166", "#5ac8e8", "#b3e66b",
];
const JOINT_COLORS = [
  "#3aa7ff", "#ff9a3c", "#6bd9a6", "#c179ff",
  "#ff5a5a", "#ffd166", "#5ac8e8", "#b3e66b",
  "#ff7ac9", "#7cffd1", "#ffa67a", "#a8b4ff",
  "#e8ff7a", "#d67aff",
];

const app = {
  // Dataset-wide
  dataset: null,          // {path, fps, num_episodes, episodes, camera_keys, joint_names}
  cameras: { head: null, left: null, right: null },

  // Per-episode
  episode_idx: 0,
  episode_length: 0,
  states: null,           // {joint_names, data: [[...], ...]}
  segments: [],           // [{start_frame, end_frame, text, bboxes:[{id,x,y,width,height,label,keypoints:[{frame,cx,cy}]}]}]

  // View state
  current_frame: 0,
  visible_joints: null,   // Set<number>

  // Selection
  selected_segment_idx: -1,
  selected_bbox_id: null,

  // Interaction state
  tracking_mode: false,
  dragging_bbox: null,    // {startX, startY, curX, curY} in image coords
  joints_panel_open: false,

  // Dirty flag
  dirty: false,

  // Pending label dialog
  _label_resolve: null,
  _segment_dialog_resolve: null,

  // Head image natural size (cached)
  head_natural: { w: 0, h: 0 },
};

/* ── API helpers ──────────────────────────────────────────────── */
const API = {
  async openDataset(path) {
    const url = path
      ? `/api/dataset?path=${encodeURIComponent(path)}`
      : `/api/dataset`;
    const r = await fetch(url);
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Failed to load dataset");
    }
    return r.json();
  },
  async states(episodeIdx) {
    const r = await fetch(`/api/episode/${episodeIdx}/states`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error("Failed to load states");
    return r.json();
  },
  frameURL(episodeIdx, frameIdx, camera) {
    // ``d`` keeps the browser cache entries separate per loaded dataset.
    const dsToken = app.dataset ? encodeURIComponent(app.dataset.path) : "-";
    return (
      `/api/episode/${episodeIdx}/frame/${frameIdx}` +
      `?camera=${encodeURIComponent(camera)}&d=${dsToken}`
    );
  },
  async segments(episodeIdx) {
    const r = await fetch(`/api/episode/${episodeIdx}/segments`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error("Failed to load segments");
    return r.json();
  },
  async saveSegments(episodeIdx, segments) {
    const r = await fetch(`/api/episode/${episodeIdx}/segments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Save failed");
    }
    return r.json();
  },
  async browse(path) {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    const r = await fetch(`/api/fs${q}`);
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Failed to list directory");
    }
    return r.json();
  },
  async scan(path, depth = 3) {
    const r = await fetch(
      `/api/datasets?path=${encodeURIComponent(path)}&depth=${depth}`
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Scan failed");
    }
    return r.json();
  },
};

/* ── Recent datasets (browser-side memory) ────────────────────── */
const RECENT_KEY = "labelvla.recentDatasets";

function getRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function rememberDataset(path) {
  if (!path) return;
  const list = [path, ...getRecents().filter((p) => p !== path)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  renderRecents();
}

function datasetName(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function renderRecents() {
  const wrap = document.getElementById("recent-wrap");
  const list = document.getElementById("recent-list");
  if (!wrap || !list) return;
  const recents = getRecents();
  list.innerHTML = "";
  if (!recents.length) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  for (const path of recents) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "recent-item";
    btn.title = path;
    btn.textContent = datasetName(path);
    btn.addEventListener("click", () => openDatasetPath(path));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

/* ── Camera classification ────────────────────────────────────── */
function classifyCameras(keys) {
  const head = keys.find(k => /(head|top|front|main|cam_high|ego|ext1)/i.test(k)) || keys[0] || null;
  const rest = keys.filter(k => k !== head);
  const left = rest.find(k => /left|ext2/i.test(k)) || rest[0] || null;
  const right = rest.find(k => k !== left && /right|wrist/i.test(k)) || rest.find(k => k !== left) || null;
  return {head, left, right};
}

/* ── Status line ──────────────────────────────────────────────── */
function setStatus(msg, kind) {
  const el = document.getElementById("status-line");
  el.textContent = msg || "";
  el.className = "status-line" + (kind ? ` ${kind}` : "");
}

/* ── Welcome screen ───────────────────────────────────────────── */
async function init() {
  // Prefer the most recently used dataset, then the one baked into the server.
  let loaded = false;
  for (const path of (new URLSearchParams(location.search).has("bridge") ? [] : getRecents())) {
    try {
      const ds = await API.openDataset(path);
      onDatasetLoaded(ds);
      loaded = true;
      break;
    } catch {
      /* stale entry — keep trying */
    }
  }
  if (!loaded && !new URLSearchParams(location.search).has("bridge")) {
    try {
      const ds = await API.openDataset(null);
      onDatasetLoaded(ds);
      loaded = true;
    } catch {
      showWelcome();
    }
  }
  if (!loaded) showWelcome();
  wireWelcome();
  wireWorkspace();
  wireDialogs();
  wirePicker();
  wireKeys();
  renderRecents();
  window.addEventListener("resize", onResize);
  if (new URLSearchParams(location.search).has("bridge")) initBridge();
  window.addEventListener("beforeunload", (e) => {
    if (app.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function showWelcome() {
  document.getElementById("welcome").classList.remove("hidden");
  document.getElementById("workspace").classList.add("hidden");
}

async function openDatasetPath(path) {
  const target = String(path || "").trim();
  if (!target) return false;
  setStatus("Opening dataset…");
  try {
    if (app.dirty) await save();
    const ds = await API.openDataset(target);
    onDatasetLoaded(ds);
    return true;
  } catch (e) {
    setStatus(e.message, "error");
    const errLine = document.getElementById("welcome-error");
    if (!document.getElementById("welcome").classList.contains("hidden")) {
      errLine.textContent = e.message;
      errLine.classList.remove("hidden");
    }
    return false;
  }
}

function wireWelcome() {
  const pathInput = document.getElementById("dataset-path");
  const errLine = document.getElementById("welcome-error");
  const btn = document.getElementById("open-dataset-btn");
  const browseBtn = document.getElementById("browse-dataset-btn");

  async function attemptOpen() {
    errLine.classList.add("hidden");
    btn.disabled = true;
    try {
      await openDatasetPath(pathInput.value);
    } finally {
      btn.disabled = false;
    }
  }
  btn.addEventListener("click", attemptOpen);
  pathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptOpen();
  });
  browseBtn.addEventListener("click", () => {
    openPicker(pathInput.value.trim() || null);
  });
}

function onDatasetLoaded(ds, skipLoad = false) {
  app.dataset = ds;
  app.cameras = classifyCameras(ds.camera_keys);
  app.episode_idx = 0;
  app.current_frame = 0;
  app.states = null;
  app.segments = [];
  app.visible_joints = null;
  app.selected_segment_idx = -1;
  app.selected_bbox_id = null;
  app.tracking_mode = false;
  app.dirty = false;
  document.getElementById("welcome").classList.add("hidden");
  document.getElementById("workspace").classList.remove("hidden");
  document.getElementById("dataset-path-display").textContent = ds.path;
  document.getElementById("dataset-name").textContent = datasetName(ds.path);
  const chip = document.getElementById("dataset-switch-btn");
  chip.title = ds.path;
  rememberDataset(ds.path);
  closePicker();

  const sel = document.getElementById("episode-select");
  sel.innerHTML = "";
  for (const ep of ds.episodes) {
    const opt = document.createElement("option");
    opt.value = String(ep.index);
    opt.textContent = `Episode ${ep.index} (${ep.length} frames)`;
    sel.appendChild(opt);
  }

  // Wrist camera labels
  const leftLbl = document.getElementById("left-wrist-label");
  const rightLbl = document.getElementById("right-wrist-label");
  const headLbl = document.getElementById("head-camera-label");
  if (app.cameras.head) headLbl.textContent = shortCam(app.cameras.head);
  if (app.cameras.left) leftLbl.textContent = shortCam(app.cameras.left);
  else leftLbl.textContent = "left wrist (n/a)";
  if (app.cameras.right) rightLbl.textContent = shortCam(app.cameras.right);
  else rightLbl.textContent = "right wrist (n/a)";

  if (!skipLoad) loadEpisode(0);
}

function shortCam(k) {
  return k.replace(/^observation\.images?\./, "");
}

/* ── Workspace wiring ─────────────────────────────────────────── */
function wireWorkspace() {
  document
    .getElementById("episode-select")
    .addEventListener("change", (e) => {
      loadEpisode(parseInt(e.target.value, 10));
    });

  document
    .getElementById("dataset-switch-btn")
    .addEventListener("click", () => openPicker(app.dataset ? app.dataset.path : null));

  document.getElementById("save-btn").addEventListener("click", save);
  document.getElementById("joints-toggle-btn").addEventListener("click", () => {
    app.joints_panel_open = !app.joints_panel_open;
    document
      .getElementById("joint-checkboxes")
      .classList.toggle("hidden", !app.joints_panel_open);
  });

  document
    .getElementById("joints-all-btn")
    .addEventListener("click", () => setAllJointsVisible(true));
  document
    .getElementById("joints-none-btn")
    .addEventListener("click", () => setAllJointsVisible(false));

  document.getElementById("play-btn").addEventListener("click", togglePlayback);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(); });

  document
    .getElementById("frame-slider")
    .addEventListener("input", (e) => {
      stopPlayback();
      seek(parseInt(e.target.value, 10));
    });

  document
    .getElementById("prev-frame-btn")
    .addEventListener("click", () => { stopPlayback(); seek(app.current_frame - 1); });
  document
    .getElementById("next-frame-btn")
    .addEventListener("click", () => { stopPlayback(); seek(app.current_frame + 1); });

  document
    .getElementById("add-segment-btn")
    .addEventListener("click", () => onAddSegment(false));
  document
    .getElementById("add-segment-here-btn")
    .addEventListener("click", () => onAddSegment(true));
  document
    .getElementById("edit-segment-btn")
    .addEventListener("click", () => {
      if (app.selected_segment_idx >= 0) editSegment(app.selected_segment_idx);
    });
  document
    .getElementById("delete-segment-btn")
    .addEventListener("click", deleteSelectedSegment);

  document.getElementById("track-btn").addEventListener("click", toggleTracking);
  document.getElementById("clear-path-btn").addEventListener("click", clearPath);
  document
    .getElementById("delete-bbox-btn")
    .addEventListener("click", deleteSelectedBBox);

  const headImg = document.getElementById("head-image");
  headImg.addEventListener("load", () => {
    app.head_natural.w = headImg.naturalWidth;
    app.head_natural.h = headImg.naturalHeight;
    drawHeadCanvas();
  });

  const headCanvas = document.getElementById("head-canvas");
  headCanvas.addEventListener("mousedown", onHeadMouseDown);
  headCanvas.addEventListener("mousemove", onHeadMouseMove);
  window.addEventListener("mouseup", onHeadMouseUp);
}

function wireDialogs() {
  // Segment dialog
  const segDlg = document.getElementById("segment-dialog");
  document
    .getElementById("seg-cancel-btn")
    .addEventListener("click", () => closeSegmentDialog(null));
  document
    .getElementById("seg-confirm-btn")
    .addEventListener("click", confirmSegmentDialog);
  segDlg.addEventListener("click", (e) => {
    if (e.target === segDlg) closeSegmentDialog(null);
  });

  // Label dialog
  const lblDlg = document.getElementById("label-dialog");
  document
    .getElementById("label-cancel-btn")
    .addEventListener("click", () => closeLabelDialog(null));
  document
    .getElementById("label-confirm-btn")
    .addEventListener("click", () => {
      const v = document.getElementById("label-input").value.trim();
      closeLabelDialog(v || null);
    });
  document.getElementById("label-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = e.target.value.trim();
      closeLabelDialog(v || null);
    } else if (e.key === "Escape") {
      closeLabelDialog(null);
    }
  });
  lblDlg.addEventListener("click", (e) => {
    if (e.target === lblDlg) closeLabelDialog(null);
  });
}

/* ── Dataset picker ──────────────────────────────────────────── */
const picker = {
  visible: false,
  path: null,
  parent: null,
  is_dataset: false,
  entries: [],
  selected: null,
  filter: "",
  scanned: null,
};

function wirePicker() {
  const dlg = document.getElementById("dataset-picker");
  document.getElementById("picker-close-btn").addEventListener("click", closePicker);
  document.getElementById("picker-cancel-btn").addEventListener("click", closePicker);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) closePicker();
  });
  document.getElementById("picker-up-btn").addEventListener("click", () => {
    if (picker.parent) pickerNavigate(picker.parent);
  });
  document.getElementById("picker-scan-btn").addEventListener("click", pickerScan);
  document.getElementById("picker-open-btn").addEventListener("click", pickerOpen);
  document.getElementById("picker-filter").addEventListener("input", (e) => {
    picker.filter = e.target.value;
    renderPickerList();
  });
}

async function openPicker(initial) {
  picker.visible = true;
  picker.selected = null;
  picker.filter = "";
  picker.scanned = null;
  document.getElementById("picker-filter").value = "";
  document.getElementById("dataset-picker").classList.remove("hidden");
  updatePickerSelection();

  let start = initial || getRecents()[0] || null;
  if (start) {
    try {
      const probe = await API.browse(start);
      if (probe.is_dataset && probe.parent) {
        picker.selected = probe.path;
        start = probe.parent;
      }
    } catch {
      start = null;
    }
  }
  await pickerNavigate(start);
  document.getElementById("picker-filter").focus();
}

function closePicker() {
  picker.visible = false;
  document.getElementById("dataset-picker").classList.add("hidden");
}

async function pickerNavigate(path) {
  const list = document.getElementById("picker-list");
  list.innerHTML = '<li class="picker-empty">加载中…</li>';
  try {
    const res = await API.browse(path);
    const prevSelected = picker.selected;
    picker.path = res.path;
    picker.parent = res.parent;
    picker.is_dataset = !!res.is_dataset;
    picker.entries = res.entries || [];
    picker.scanned = null;
    const prefix = res.path.replace(/\/+$/, "") + "/";
    picker.selected =
      prevSelected && prevSelected.startsWith(prefix) ? prevSelected : null;
    document.getElementById("picker-path").textContent = res.path;
    document.getElementById("picker-up-btn").disabled = !res.parent;
    updatePickerSelection();
    renderPickerList();
  } catch (e) {
    list.innerHTML = "";
    const li = document.createElement("li");
    li.className = "picker-empty error";
    li.textContent = e.message;
    list.appendChild(li);
  }
}

function pickerRow(entry) {
  const li = document.createElement("li");
  li.className = "picker-row" + (entry.is_dataset ? " is-dataset" : "");
  if (entry.path === picker.selected) li.classList.add("selected");
  li.title = entry.path;
  li.dataset.path = entry.path;

  const icon = document.createElement("span");
  icon.className = "row-icon " + (entry.is_dataset ? "dataset" : "folder");
  li.appendChild(icon);

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = entry.name;
  li.appendChild(name);

  if (entry.is_dataset) {
    const badge = document.createElement("span");
    badge.className = "row-badge";
    badge.textContent = "LeRobot";
    li.appendChild(badge);
  }

  const hint = document.createElement("span");
  hint.className = "row-hint";
  hint.textContent = entry.is_dataset ? "点击选择" : "进入";
  li.appendChild(hint);

  li.addEventListener("click", () => {
    if (entry.is_dataset) {
      picker.selected = entry.path;
      updatePickerSelection();
      renderPickerList();
    } else {
      pickerNavigate(entry.path);
    }
  });
  li.addEventListener("dblclick", () => {
    if (entry.is_dataset) {
      picker.selected = entry.path;
      pickerOpen();
    }
  });
  return li;
}

function renderPickerList() {
  const list = document.getElementById("picker-list");
  list.innerHTML = "";
  const q = picker.filter.trim().toLowerCase();

  const recents = getRecents().filter((p) => p !== picker.path);
  if (recents.length && !q) {
    const head = document.createElement("li");
    head.className = "picker-group";
    head.textContent = "最近打开";
    list.appendChild(head);
    for (const p of recents) {
      list.appendChild(
        pickerRow({ name: datasetName(p), path: p, is_dataset: true })
      );
    }
  }

  if (picker.scanned) {
    const head = document.createElement("li");
    head.className = "picker-group";
    head.textContent = `扫描结果（${picker.scanned.length}）`;
    list.appendChild(head);
    if (!picker.scanned.length) {
      const li = document.createElement("li");
      li.className = "picker-empty";
      li.textContent = "当前目录下没有找到 LeRobot 数据集";
      list.appendChild(li);
    }
    for (const ds of picker.scanned) {
      list.appendChild(pickerRow(ds));
    }
  }

  if (!q) {
    const head = document.createElement("li");
    head.className = "picker-group";
    head.textContent = picker.is_dataset ? "当前目录（本身就是数据集）" : "当前目录";
    list.appendChild(head);
  }

  const entries = picker.entries.filter(
    (e) => !q || e.name.toLowerCase().includes(q)
  );
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "picker-empty";
    li.textContent = q ? "没有匹配的目录" : "这个目录下没有子目录";
    list.appendChild(li);
  }
  for (const entry of entries) {
    list.appendChild(pickerRow(entry));
  }
}

function updatePickerSelection() {
  const target = picker.selected || (picker.is_dataset ? picker.path : null);
  const label = document.getElementById("picker-selected");
  label.textContent = target || "未选择目录";
  label.classList.toggle("is-empty", !target);
  document.getElementById("picker-open-btn").disabled = !target;
}

async function pickerScan() {
  if (!picker.path) return;
  const btn = document.getElementById("picker-scan-btn");
  btn.disabled = true;
  btn.textContent = "扫描中…";
  try {
    const res = await API.scan(picker.path, 3);
    picker.scanned = res.datasets || [];
    renderPickerList();
  } catch (e) {
    setStatus(e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "扫描子目录";
  }
}

async function pickerOpen() {
  const target = picker.selected || (picker.is_dataset ? picker.path : null);
  if (!target) return;
  const btn = document.getElementById("picker-open-btn");
  btn.disabled = true;
  const ok = await openDatasetPath(target);
  if (ok) closePicker();
  else btn.disabled = false;
}

function wireKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && picker.visible) {
      closePicker();
      return;
    }
    // Skip when typing in inputs/textareas
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stopPlayback();
      seek(app.current_frame - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stopPlayback();
      seek(app.current_frame + 1);
    } else if (e.key === "Escape") {
      if (app.tracking_mode) toggleTracking();
    }
  });
}

function onResize() {
  drawJointCanvas();
  drawHeadCanvas();
  drawSegmentBar();
}

/* ── Episode loading ──────────────────────────────────────────── */
async function loadEpisode(idx) {
  stopPlayback();
  if (app.dirty) {
    await save();
  }
  app.episode_idx = idx;
  app.current_frame = 0;
  app.selected_segment_idx = -1;
  app.selected_bbox_id = null;
  app.tracking_mode = false;
  document.getElementById("track-btn").classList.remove("active");
  document.getElementById("head-canvas").classList.remove("tracking");
  document.getElementById("episode-select").value = String(idx);

  const ep = app.dataset.episodes.find((e) => e.index === idx);
  app.episode_length = ep ? ep.length : 0;

  const slider = document.getElementById("frame-slider");
  slider.min = 0;
  slider.max = Math.max(0, app.episode_length - 1);
  slider.value = 0;

  setStatus("Loading episode…");
  try {
    const [states, segs] = await Promise.all([
      API.states(idx),
      API.segments(idx),
    ]);
    app.states = states;
    if (app.visible_joints === null) {
      app.visible_joints = new Set(states.joint_names.map((_, i) => i));
    }
    app.segments = segs.segments || [];
    app.dirty = false;
    renderJointCheckboxes();
    renderSegmentList();
    renderBBoxList();
    drawJointCanvas();
    drawSegmentBar();
    updateTimelineInfo();
    await seek(0);
    setStatus("Ready", "ok");
  } catch (e) {
    console.error(e);
    setStatus(e.message, "error");
  }
}

let playbackRequest = null;
let playbackStartTime = 0;
let playbackStartFrame = 0;
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM15 5h4v14h-4z" fill="currentColor"/></svg>';

function stopPlayback() {
  if (playbackRequest !== null) cancelAnimationFrame(playbackRequest);
  playbackRequest = null;
  const button = document.getElementById("play-btn");
  if (button) {
    button.innerHTML = playIcon;
    button.title = "播放";
    button.setAttribute("aria-label", "播放");
    button.setAttribute("aria-pressed", "false");
  }
}
function togglePlayback() {
  if (playbackRequest !== null) { stopPlayback(); return; }
  if (!app.dataset || !app.episode_length || !app.states) return;
  if (app.current_frame >= app.episode_length - 1) seek(0);
  playbackStartFrame = app.current_frame;
  playbackStartTime = performance.now();
  const button = document.getElementById("play-btn");
  button.innerHTML = pauseIcon;
  button.title = "暂停";
  button.setAttribute("aria-label", "暂停");
  button.setAttribute("aria-pressed", "true");
  const fps = Number(app.dataset.fps) > 0 ? Number(app.dataset.fps) : 15;
  function tick(now) {
    const frame = Math.min(app.episode_length - 1, playbackStartFrame + Math.floor((now - playbackStartTime) * fps / 1000));
    if (frame !== app.current_frame) seek(frame);
    if (frame >= app.episode_length - 1) { stopPlayback(); return; }
    playbackRequest = requestAnimationFrame(tick);
  }
  playbackRequest = requestAnimationFrame(tick);
}

async function seek(frame) {
  frame = Math.max(0, Math.min(app.episode_length - 1, frame));
  app.current_frame = frame;
  document.getElementById("frame-slider").value = String(frame);
  document.getElementById("frame-counter").textContent =
    `${frame} / ${app.episode_length - 1}`;

  // Update camera images — all three in parallel
  const urlHead = app.cameras.head
    ? API.frameURL(app.episode_idx, frame, app.cameras.head)
    : "";
  const urlLeft = app.cameras.left
    ? API.frameURL(app.episode_idx, frame, app.cameras.left)
    : "";
  const urlRight = app.cameras.right
    ? API.frameURL(app.episode_idx, frame, app.cameras.right)
    : "";
  document.getElementById("head-image").src = urlHead;
  document.getElementById("left-wrist-image").src = urlLeft;
  document.getElementById("right-wrist-image").src = urlRight;

  drawJointCanvas();
  drawSegmentBar();
  drawHeadCanvas();

  // Auto-select segment at current frame if selection is invalid
  const cur = app.segments[app.selected_segment_idx];
  if (!cur || frame < cur.start_frame || frame > cur.end_frame) {
    const idx = app.segments.findIndex(
      (s) => s.start_frame <= frame && frame <= s.end_frame,
    );
    if (idx !== -1 && idx !== app.selected_segment_idx) {
      setSelectedSegment(idx);
    }
  }
}

/* ── Joint checkboxes ─────────────────────────────────────────── */
function setAllJointsVisible(v) {
  const n = app.states.joint_names.length;
  app.visible_joints = v ? new Set(Array.from({ length: n }, (_, i) => i)) : new Set();
  renderJointCheckboxes();
  drawJointCanvas();
}

function renderJointCheckboxes() {
  const list = document.getElementById("joint-checkboxes-list");
  list.innerHTML = "";
  app.states.joint_names.forEach((name, i) => {
    const row = document.createElement("label");
    row.className = "joint-checkbox";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = JOINT_COLORS[i % JOINT_COLORS.length];
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = app.visible_joints.has(i);
    cb.addEventListener("change", () => {
      if (cb.checked) app.visible_joints.add(i);
      else app.visible_joints.delete(i);
      drawJointCanvas();
    });
    const lbl = document.createElement("span");
    lbl.textContent = name;
    row.append(cb, swatch, lbl);
    list.appendChild(row);
  });
  document.getElementById("joint-info").textContent =
    `${app.visible_joints.size} / ${app.states.joint_names.length} joints visible`;
}

/* ── Canvas sizing ────────────────────────────────────────────── */
function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

/* ── Joint curves ─────────────────────────────────────────────── */
function drawJointCanvas() {
  const canvas = document.getElementById("joint-canvas");
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  if (!app.states) return;

  const data = app.states.data;
  const names = app.states.joint_names;
  const n = data.length;
  if (n === 0) return;

  const padL = 40, padR = 10, padT = 10, padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Compute y-range across visible joints
  let minV = Infinity, maxV = -Infinity;
  for (let j = 0; j < names.length; j++) {
    if (!app.visible_joints.has(j)) continue;
    for (let i = 0; i < n; i++) {
      const v = data[i][j];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (!isFinite(minV)) { minV = -1; maxV = 1; }
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const pad = (maxV - minV) * 0.08;
  minV -= pad; maxV += pad;

  // Background segment bands
  for (let si = 0; si < app.segments.length; si++) {
    const s = app.segments[si];
    const x0 = padL + (s.start_frame / Math.max(1, n - 1)) * plotW;
    const x1 = padL + (s.end_frame / Math.max(1, n - 1)) * plotW;
    ctx.fillStyle = segFill(si, si === app.selected_segment_idx ? 0.28 : 0.14);
    ctx.fillRect(x0, padT, x1 - x0, plotH);
    // Segment label
    if (x1 - x0 > 36) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(s.text || `seg ${si}`, x0 + 4, padT + 2);
    }
  }

  // Axes frame
  ctx.strokeStyle = "#2e3444";
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);

  // Y tick marks
  ctx.fillStyle = "#6e7689";
  ctx.font = "10px ui-monospace, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = 3;
  for (let t = 0; t <= ticks; t++) {
    const v = maxV - ((maxV - minV) * t) / ticks;
    const y = padT + (plotH * t) / ticks;
    ctx.fillText(v.toFixed(2), padL - 4, y);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }

  // Curves
  for (let j = 0; j < names.length; j++) {
    if (!app.visible_joints.has(j)) continue;
    ctx.strokeStyle = JOINT_COLORS[j % JOINT_COLORS.length];
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = padL + (i / Math.max(1, n - 1)) * plotW;
      const y =
        padT + plotH - ((data[i][j] - minV) / (maxV - minV)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Current frame indicator
  const curX =
    padL + (app.current_frame / Math.max(1, n - 1)) * plotW;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(curX, padT);
  ctx.lineTo(curX, padT + plotH);
  ctx.stroke();
  ctx.fillStyle = "#3aa7ff";
  ctx.beginPath();
  ctx.arc(curX, padT + plotH, 3, 0, Math.PI * 2);
  ctx.fill();

  // Click-to-seek (rebind each render to have current state closure)
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < padL || mx > padL + plotW) return;
    const frame = Math.round(((mx - padL) / plotW) * (n - 1));
    seek(frame);
  };
}

function segFill(idx, alpha) {
  const hex = SEG_COLORS[idx % SEG_COLORS.length];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Timeline segment bar ─────────────────────────────────────── */
function drawSegmentBar() {
  const canvas = document.getElementById("segment-bar");
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const n = Math.max(1, app.episode_length - 1);

  // Base track
  ctx.fillStyle = "#2e3444";
  ctx.fillRect(0, height - 4, width, 4);

  // Segment blocks
  for (let i = 0; i < app.segments.length; i++) {
    const s = app.segments[i];
    const x0 = (s.start_frame / n) * width;
    const x1 = (s.end_frame / n) * width;
    ctx.fillStyle = SEG_COLORS[i % SEG_COLORS.length];
    ctx.globalAlpha = i === app.selected_segment_idx ? 1.0 : 0.7;
    ctx.fillRect(x0, 2, Math.max(2, x1 - x0), height - 8);
  }
  ctx.globalAlpha = 1;
}

function updateTimelineInfo() {
  document.getElementById("timeline-info").textContent =
    `episode ${app.episode_idx} · ${app.episode_length} frames @ ${app.dataset.fps} fps`;
}

/* ── Head camera canvas ───────────────────────────────────────── */
function getHeadRect() {
  const container = document.getElementById("head-viewport");
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const iw = app.head_natural.w;
  const ih = app.head_natural.h;
  if (!iw || !ih) return null;
  const scale = Math.min(cw / iw, ch / ih);
  const w = iw * scale;
  const h = ih * scale;
  return {
    x: (cw - w) / 2,
    y: (ch - h) / 2,
    w,
    h,
    scale,
    imageW: iw,
    imageH: ih,
  };
}

function drawHeadCanvas() {
  const canvas = document.getElementById("head-canvas");
  const { ctx, width, height } = sizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const rect = getHeadRect();
  if (!rect) return;

  const seg = app.segments[app.selected_segment_idx];
  const frame = app.current_frame;

  // Draw all bboxes in ALL segments that contain current frame
  for (let si = 0; si < app.segments.length; si++) {
    const s = app.segments[si];
    if (frame < s.start_frame || frame > s.end_frame) continue;
    for (const b of s.bboxes) {
      const { cx, cy } = interpolateCenter(b, frame);
      const x = cx - b.width / 2;
      const y = cy - b.height / 2;
      const selected =
        si === app.selected_segment_idx && b.id === app.selected_bbox_id;
      drawBBox(ctx, rect, x, y, b.width, b.height, b, selected);
      if (b.keypoints && b.keypoints.length > 1) {
        drawMotionPath(ctx, rect, b);
      }
    }
  }

  // In-progress drag
  if (app.dragging_bbox) {
    const d = app.dragging_bbox;
    const x = Math.min(d.startX, d.curX);
    const y = Math.min(d.startY, d.curY);
    const w = Math.abs(d.curX - d.startX);
    const h = Math.abs(d.curY - d.startY);
    const p0 = imgToCanvas(x, y, rect);
    ctx.strokeStyle = "#3aa7ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(p0.x, p0.y, w * rect.scale, h * rect.scale);
    ctx.setLineDash([]);
  }
}

function drawBBox(ctx, rect, x, y, w, h, bbox, selected) {
  const p = imgToCanvas(x, y, rect);
  const ww = w * rect.scale;
  const hh = h * rect.scale;
  const moving = bbox.keypoints && bbox.keypoints.length > 0;

  let color;
  if (app.tracking_mode && selected) color = "#ffd166";
  else if (selected) color = "#3aa7ff";
  else if (moving) color = "#6bd9a6";
  else color = "#c179ff";

  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.strokeRect(p.x, p.y, ww, hh);

  // Corner indicators
  const cornerLen = 6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y + cornerLen); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x + cornerLen, p.y);
  ctx.moveTo(p.x + ww - cornerLen, p.y); ctx.lineTo(p.x + ww, p.y); ctx.lineTo(p.x + ww, p.y + cornerLen);
  ctx.moveTo(p.x + ww, p.y + hh - cornerLen); ctx.lineTo(p.x + ww, p.y + hh); ctx.lineTo(p.x + ww - cornerLen, p.y + hh);
  ctx.moveTo(p.x + cornerLen, p.y + hh); ctx.lineTo(p.x, p.y + hh); ctx.lineTo(p.x, p.y + hh - cornerLen);
  ctx.stroke();

  // Label
  const tag = `[${displayId(bbox.id)}] ${bbox.label}` +
    (moving ? " · moving" : "") +
    (app.tracking_mode && selected ? " · tracking" : "");
  ctx.font = "11px ui-monospace, Menlo, monospace";
  const mw = ctx.measureText(tag).width;
  ctx.fillStyle = color;
  ctx.fillRect(p.x, p.y - 16, mw + 8, 14);
  ctx.fillStyle = "#0b0d13";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(tag, p.x + 4, p.y - 9);
}

function drawMotionPath(ctx, rect, bbox) {
  const kps = bbox.keypoints.slice().sort((a, b) => a.frame - b.frame);
  ctx.strokeStyle = "rgba(255,90,90,0.7)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let i = 0; i < kps.length; i++) {
    const p = imgToCanvas(kps[i].cx, kps[i].cy, rect);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw keypoints
  for (const k of kps) {
    const p = imgToCanvas(k.cx, k.cy, rect);
    ctx.fillStyle = k.frame === app.current_frame ? "#ffd166" : "#ff5a5a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0b0d13";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

let _pendingCounter = 0;
function pendingId() {
  _pendingCounter += 1;
  return `_pending_${Date.now()}_${_pendingCounter}`;
}

function displayId(id) {
  return typeof id === "number" ? String(id) : "new";
}

function imgToCanvas(x, y, rect) {
  return { x: rect.x + x * rect.scale, y: rect.y + y * rect.scale };
}
function canvasToImg(x, y, rect) {
  return { x: (x - rect.x) / rect.scale, y: (y - rect.y) / rect.scale };
}

function interpolateCenter(bbox, frame) {
  if (!bbox.keypoints || bbox.keypoints.length === 0) {
    return { cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2 };
  }
  const kps = bbox.keypoints.slice().sort((a, b) => a.frame - b.frame);
  if (frame <= kps[0].frame) return { cx: kps[0].cx, cy: kps[0].cy };
  if (frame >= kps[kps.length - 1].frame) {
    return { cx: kps[kps.length - 1].cx, cy: kps[kps.length - 1].cy };
  }
  for (let i = 0; i < kps.length - 1; i++) {
    if (kps[i].frame <= frame && frame <= kps[i + 1].frame) {
      const t = (frame - kps[i].frame) / (kps[i + 1].frame - kps[i].frame);
      return {
        cx: kps[i].cx + t * (kps[i + 1].cx - kps[i].cx),
        cy: kps[i].cy + t * (kps[i + 1].cy - kps[i].cy),
      };
    }
  }
  return { cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2 };
}

/* ── Head camera mouse handling ───────────────────────────────── */
function onHeadMouseDown(e) {
  const canvas = document.getElementById("head-canvas");
  const rect = getHeadRect();
  if (!rect) return;
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  if (mx < rect.x || mx > rect.x + rect.w) return;
  if (my < rect.y || my > rect.y + rect.h) return;
  const img = canvasToImg(mx, my, rect);

  if (app.tracking_mode) {
    addKeypoint(img.x, img.y);
    return;
  }

  app.dragging_bbox = {
    startX: img.x,
    startY: img.y,
    curX: img.x,
    curY: img.y,
  };
}

function onHeadMouseMove(e) {
  if (!app.dragging_bbox) return;
  const canvas = document.getElementById("head-canvas");
  const rect = getHeadRect();
  if (!rect) return;
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const img = canvasToImg(mx, my, rect);
  // Clamp
  app.dragging_bbox.curX = Math.max(0, Math.min(rect.imageW, img.x));
  app.dragging_bbox.curY = Math.max(0, Math.min(rect.imageH, img.y));
  drawHeadCanvas();
}

async function onHeadMouseUp() {
  if (!app.dragging_bbox) return;
  const d = app.dragging_bbox;
  app.dragging_bbox = null;
  const w = Math.abs(d.curX - d.startX);
  const h = Math.abs(d.curY - d.startY);
  drawHeadCanvas();
  if (w < 4 || h < 4) return;

  // Determine target segment
  let segIdx = app.selected_segment_idx;
  const cur = app.segments[segIdx];
  if (!cur || app.current_frame < cur.start_frame || app.current_frame > cur.end_frame) {
    segIdx = app.segments.findIndex(
      (s) =>
        s.start_frame <= app.current_frame && app.current_frame <= s.end_frame,
    );
  }
  if (segIdx < 0) {
    setStatus("Draw bboxes inside a segment first", "warn");
    return;
  }

  const label = await promptLabel();
  if (!label) return;

  const x = Math.min(d.startX, d.curX);
  const y = Math.min(d.startY, d.curY);
  const newBox = {
    id: null, // server will allocate
    label,
    x, y, width: w, height: h,
    keypoints: [],
  };
  app.segments[segIdx].bboxes.push(newBox);
  setSelectedSegment(segIdx);
  // Client-side transient id; save() swaps for a server-allocated int.
  newBox.id = pendingId();
  app.selected_bbox_id = newBox.id;
  markDirty();
  renderBBoxList();
  drawHeadCanvas();
}

function addKeypoint(x, y) {
  const bbox = findSelectedBBox();
  if (!bbox) return;
  const seg = app.segments[app.selected_segment_idx];
  if (!seg) return;
  const frame = app.current_frame;
  if (frame < seg.start_frame || frame > seg.end_frame) {
    setStatus("Current frame is outside the selected segment", "warn");
    return;
  }
  const kps = bbox.keypoints || (bbox.keypoints = []);
  const existing = kps.findIndex((k) => k.frame === frame);
  const kp = { frame, cx: x, cy: y };
  if (existing >= 0) kps[existing] = kp;
  else kps.push(kp);
  kps.sort((a, b) => a.frame - b.frame);
  markDirty();
  drawHeadCanvas();
  renderBBoxList();
}

/* ── Segment + bbox panels ────────────────────────────────────── */
function renderSegmentList() {
  const ul = document.getElementById("segment-list");
  ul.innerHTML = "";
  app.segments.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "dock-item";
    if (i === app.selected_segment_idx) li.classList.add("selected");
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `seg ${i}`;
    chip.style.background = segFill(i, 0.25);
    chip.style.color = SEG_COLORS[i % SEG_COLORS.length];
    const frames = document.createElement("span");
    frames.className = "frames";
    frames.textContent = `${s.start_frame}–${s.end_frame}`;
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = s.text || "(no text)";
    li.append(chip, frames, title);
    li.addEventListener("click", () => {
      setSelectedSegment(i);
      seek(s.start_frame);
    });
    li.addEventListener("dblclick", () => editSegment(i));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setSelectedSegment(i);
      deleteSegmentAt(i);
    });
    ul.appendChild(li);
  });
  if (app.segments.length === 0) {
    const li = document.createElement("li");
    li.className = "dock-item";
    li.style.color = "var(--muted)";
    li.style.justifyContent = "center";
    li.textContent = "no segments";
    ul.appendChild(li);
  }
  updateSegmentButtons();
}

function updateSegmentButtons() {
  const has = app.selected_segment_idx >= 0
    && app.selected_segment_idx < app.segments.length;
  document.getElementById("edit-segment-btn").disabled = !has;
  document.getElementById("delete-segment-btn").disabled = !has;
}

function deleteSelectedSegment() {
  if (
    app.selected_segment_idx < 0
    || app.selected_segment_idx >= app.segments.length
  ) return;
  deleteSegmentAt(app.selected_segment_idx);
}

function deleteSegmentAt(i) {
  if (i < 0 || i >= app.segments.length) return;
  const s = app.segments[i];
  const bboxCount = s.bboxes.length;
  const summary = `[${s.start_frame}–${s.end_frame}] "${s.text || "(no text)"}"`;
  const detail = bboxCount > 0
    ? `\n\nThis will also remove ${bboxCount} bbox${bboxCount === 1 ? "" : "es"} in the segment.`
    : "";
  if (!confirm(`Delete segment ${i}?\n${summary}${detail}`)) return;
  app.segments.splice(i, 1);
  if (app.selected_segment_idx === i) {
    app.selected_segment_idx = -1;
    app.selected_bbox_id = null;
    if (app.tracking_mode) toggleTracking();
  } else if (app.selected_segment_idx > i) {
    app.selected_segment_idx -= 1;
  }
  markDirty();
  renderSegmentList();
  renderBBoxList();
  drawSegmentBar();
  drawJointCanvas();
  drawHeadCanvas();
}

function renderBBoxList() {
  const ul = document.getElementById("bbox-list");
  ul.innerHTML = "";
  const seg = app.segments[app.selected_segment_idx];
  if (!seg) {
    const li = document.createElement("li");
    li.className = "dock-item";
    li.style.color = "var(--muted)";
    li.style.justifyContent = "center";
    li.textContent = "select a segment";
    ul.appendChild(li);
  } else {
    for (const b of seg.bboxes) {
      const li = document.createElement("li");
      li.className = "dock-item";
      if (b.id === app.selected_bbox_id) li.classList.add("selected");
      const chip = document.createElement("span");
      chip.className = "chip";
      if (b.keypoints && b.keypoints.length > 0) chip.classList.add("moving");
      chip.textContent = `id:${displayId(b.id)}`;
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = b.label;
      const meta = document.createElement("span");
      meta.className = "frames";
      meta.textContent = `${Math.round(b.width)}×${Math.round(b.height)}` +
        (b.keypoints && b.keypoints.length
          ? ` · ${b.keypoints.length} kp`
          : "");
      li.append(chip, title, meta);
      li.addEventListener("click", () => {
        app.selected_bbox_id = b.id;
        updateBBoxButtons();
        renderBBoxList();
        drawHeadCanvas();
      });
      ul.appendChild(li);
    }
    if (seg.bboxes.length === 0) {
      const li = document.createElement("li");
      li.className = "dock-item";
      li.style.color = "var(--muted)";
      li.style.justifyContent = "center";
      li.textContent = "draw a bbox on the head camera";
      ul.appendChild(li);
    }
  }
  updateBBoxButtons();
}

function setSelectedSegment(i) {
  app.selected_segment_idx = i;
  app.selected_bbox_id = null;
  if (app.tracking_mode) toggleTracking();
  renderSegmentList();
  renderBBoxList();
  drawJointCanvas();
  drawSegmentBar();
  drawHeadCanvas();
}

function updateBBoxButtons() {
  const b = findSelectedBBox();
  document.getElementById("track-btn").disabled = !b;
  document.getElementById("clear-path-btn").disabled =
    !b || !b.keypoints || b.keypoints.length === 0;
  document.getElementById("delete-bbox-btn").disabled = !b;
}

function findSelectedBBox() {
  const seg = app.segments[app.selected_segment_idx];
  if (!seg) return null;
  return seg.bboxes.find((b) => b.id === app.selected_bbox_id) || null;
}

/* ── Segment add/edit ─────────────────────────────────────────── */
async function onAddSegment(atCurrent) {
  const result = await openSegmentDialog({
    start_frame: atCurrent ? app.current_frame : 0,
    end_frame: atCurrent
      ? Math.min(app.current_frame + 30, app.episode_length - 1)
      : Math.min(30, app.episode_length - 1),
    text: "",
  });
  if (!result) return;
  app.segments.push({
    start_frame: result.start_frame,
    end_frame: result.end_frame,
    text: result.text,
    bboxes: [],
  });
  // Keep segments sorted by start_frame
  app.segments.sort((a, b) => a.start_frame - b.start_frame);
  const newIdx = app.segments.findIndex(
    (s) =>
      s.start_frame === result.start_frame &&
      s.end_frame === result.end_frame,
  );
  setSelectedSegment(newIdx);
  markDirty();
}

async function editSegment(i) {
  const s = app.segments[i];
  const result = await openSegmentDialog(s);
  if (!result) return;
  s.start_frame = result.start_frame;
  s.end_frame = result.end_frame;
  s.text = result.text;
  app.segments.sort((a, b) => a.start_frame - b.start_frame);
  markDirty();
  renderSegmentList();
  drawSegmentBar();
  drawJointCanvas();
  drawHeadCanvas();
}

function openSegmentDialog(initial) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("segment-dialog");
    document.getElementById("segment-dialog-title").textContent =
      initial.start_frame !== undefined && initial.end_frame !== undefined &&
        initial.start_frame === initial.end_frame ? "Add Segment" : "Edit Segment";
    document.getElementById("seg-start").value = String(initial.start_frame || 0);
    document.getElementById("seg-end").value = String(initial.end_frame || 0);
    document.getElementById("seg-text").value = initial.text || "";
    const startIn = document.getElementById("seg-start");
    const endIn = document.getElementById("seg-end");
    startIn.max = String(app.episode_length - 1);
    endIn.max = String(app.episode_length - 1);
    dlg.classList.remove("hidden");
    setTimeout(() => document.getElementById("seg-text").focus(), 10);
    app._segment_dialog_resolve = resolve;
  });
}

function closeSegmentDialog(value) {
  document.getElementById("segment-dialog").classList.add("hidden");
  if (app._segment_dialog_resolve) {
    app._segment_dialog_resolve(value);
    app._segment_dialog_resolve = null;
  }
}

function confirmSegmentDialog() {
  const start = parseInt(document.getElementById("seg-start").value, 10);
  const end = parseInt(document.getElementById("seg-end").value, 10);
  const text = document.getElementById("seg-text").value.trim();
  if (!(start >= 0 && end >= start && end <= app.episode_length - 1)) {
    alert("Invalid frame range");
    return;
  }
  closeSegmentDialog({ start_frame: start, end_frame: end, text });
}

/* ── Label prompt ─────────────────────────────────────────────── */
function promptLabel() {
  return new Promise((resolve) => {
    const dlg = document.getElementById("label-dialog");
    document.getElementById("label-input").value = "";
    dlg.classList.remove("hidden");
    setTimeout(() => document.getElementById("label-input").focus(), 10);
    app._label_resolve = resolve;
  });
}

function closeLabelDialog(value) {
  document.getElementById("label-dialog").classList.add("hidden");
  if (app._label_resolve) {
    app._label_resolve(value);
    app._label_resolve = null;
  }
}

/* ── Tracking ─────────────────────────────────────────────────── */
function toggleTracking() {
  const b = findSelectedBBox();
  if (!b && !app.tracking_mode) return;
  app.tracking_mode = !app.tracking_mode;
  document
    .getElementById("track-btn")
    .classList.toggle("active", app.tracking_mode);
  document
    .getElementById("head-canvas")
    .classList.toggle("tracking", app.tracking_mode);
  setStatus(
    app.tracking_mode
      ? "Tracking: click the object center across frames (Esc to exit)"
      : "",
    app.tracking_mode ? "warn" : "",
  );
  drawHeadCanvas();
}

function clearPath() {
  const b = findSelectedBBox();
  if (!b) return;
  b.keypoints = [];
  markDirty();
  drawHeadCanvas();
  renderBBoxList();
}

function deleteSelectedBBox() {
  const seg = app.segments[app.selected_segment_idx];
  if (!seg) return;
  const i = seg.bboxes.findIndex((b) => b.id === app.selected_bbox_id);
  if (i < 0) return;
  seg.bboxes.splice(i, 1);
  app.selected_bbox_id = null;
  if (app.tracking_mode) toggleTracking();
  markDirty();
  renderBBoxList();
  drawHeadCanvas();
}

/* ── Save ─────────────────────────────────────────────────────── */
function markDirty() {
  app.dirty = true;
  if (document.body.classList.contains("studio-bridge")) parent.postMessage({type:"labelvla-status", message:"标注尚未保存", dirty:true}, location.origin);
  setStatus("● Unsaved changes", "warn");
}

async function save() {
  setStatus("Saving…");
  // Normalize: strip transient string ids so server allocates int ids
  const payload = app.segments.map((s) => ({
    start_frame: s.start_frame,
    end_frame: s.end_frame,
    text: s.text,
    bboxes: s.bboxes.map((b) => ({
      id: typeof b.id === "number" ? b.id : null,
      label: b.label,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      keypoints: b.keypoints || [],
    })),
  }));
  try {
    const result = await API.saveSegments(app.episode_idx, payload);
    // Preserve UI selection across id reassignment by label + start frame
    const prevSel =
      app.selected_segment_idx >= 0
        ? app.segments[app.selected_segment_idx]
        : null;
    app.segments = result.segments || [];
    if (prevSel) {
      const ni = app.segments.findIndex(
        (s) =>
          s.start_frame === prevSel.start_frame &&
          s.end_frame === prevSel.end_frame,
      );
      app.selected_segment_idx = ni;
    }
    app.selected_bbox_id = null;
    app.dirty = false;
    if (document.body.classList.contains("studio-bridge")) parent.postMessage({type:"labelvla-status", message:"标注已保存", dirty:false}, location.origin);
    setStatus("Saved", "ok");
    renderSegmentList();
    renderBBoxList();
    drawSegmentBar();
    drawJointCanvas();
    drawHeadCanvas();
  } catch (e) {
    console.error(e);
    setStatus(e.message, "error");
  }
}

/* ── Boot ─────────────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", init);

// Studio drives dataset, episode and frame selection. Never discard unsaved labels.
function initBridge() {
  document.body.classList.add("studio-bridge");
  let pending = null;
  let busy = false;
  const report = (message, ready = false) => parent.postMessage({type:"labelvla-status", message, ready}, location.origin);
  async function process() {
    if (busy) return;
    busy = true;
    try {
      while (pending) {
        const next = pending; pending = null;
        if (typeof next.dataset !== "string" || !Number.isInteger(next.episode) || !Number.isInteger(next.frame)) continue;
        if (app.dirty && (!app.dataset || app.dataset.path !== next.dataset || app.episode_idx !== next.episode)) { report("请先保存当前标注，再切换数据集或片段"); continue; }
        if (!app.dataset || app.dataset.path !== next.dataset) {
          const ds = await API.openDataset(next.dataset);
          onDatasetLoaded(ds, true);
          app.episode_idx = -1;
        }
        if (!app.dataset.episodes.some(ep => ep.index === next.episode)) { report("该片段不在 LabelVLA 数据集中"); continue; }
        if (app.episode_idx !== next.episode || !app.states) await loadEpisode(next.episode);
        await seek(next.frame);
        report("标注画面已同步");
      }
    } catch(e) { report("标注同步失败：" + e.message); }
    finally { busy = false; if (pending) void process(); }
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "labelvla-sync") return;
    pending = event.data; void process();
  });
  report("标注面板已就绪", true);
}
