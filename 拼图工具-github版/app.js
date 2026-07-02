const state = {
  images: [],
  layout: "grid",
  columns: 2,
  gap: 0,
  fit: "contain",
  canvas: null,
  drag: null,
};

const fileInput = document.querySelector("#fileInput");
const thumbGrid = document.querySelector("#thumbGrid");
const clearButton = document.querySelector("#clearButton");
const composeButton = document.querySelector("#composeButton");
const downloadButton = document.querySelector("#downloadButton");
const statusText = document.querySelector("#statusText");
const columnsInput = document.querySelector("#columnsInput");
const gapInput = document.querySelector("#gapInput");
const fitInput = document.querySelector("#fitInput");
const seamlessButton = document.querySelector("#seamlessButton");
const modeButtons = document.querySelectorAll("[data-layout]");
const canvas = document.querySelector("#canvas");
const stage = document.querySelector(".stage");
const stageEmpty = document.querySelector("#stageEmpty");
const previewMeta = document.querySelector("#previewMeta");
const watermarkText = document.querySelector("#watermarkText");
const watermarkDensity = document.querySelector("#watermarkDensity");
const watermarkColor = document.querySelector("#watermarkColor");
const watermarkSize = document.querySelector("#watermarkSize");
const watermarkOpacity = document.querySelector("#watermarkOpacity");
const policyDialog = document.querySelector("#policyDialog");
const policyTitle = document.querySelector("#policyTitle");
const policyClose = document.querySelector("#policyClose");
const privacyPolicy = document.querySelector("#privacyPolicy");
const termsPolicy = document.querySelector("#termsPolicy");

fileInput.addEventListener("change", async (event) => {
  const files = [...event.target.files].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  setStatus("正在读取图片...");
  const loaded = await Promise.all(files.map(loadImage));
  state.images.push(...loaded);
  renderThumbs();
  resetCanvas();
  setStatus(`已选择 ${state.images.length} 张。先拖动缩略图排顺序。`);
  fileInput.value = "";
});

clearButton.addEventListener("click", () => {
  state.images = [];
  renderThumbs();
  resetCanvas();
  setStatus("已清空。");
});

composeButton.addEventListener("click", () => {
  if (state.images.length < 1) return;
  state.columns = clamp(Number(columnsInput.value) || 1, 1, 12);
  state.gap = clamp(Number(gapInput.value) || 0, 0, 80);
  state.fit = fitInput.value;
  state.canvas = composeImages();
  applyFullWatermark(state.canvas);
  drawPreview();
  setStatus(watermarkText.value.trim() ? "带满屏水印的拼图已生成。" : "拼图已生成。");
});

downloadButton.addEventListener("click", () => {
  if (!state.canvas) return;
  const a = document.createElement("a");
  a.download = `无缝拼图-${Date.now()}.png`;
  a.href = state.canvas.toDataURL("image/png");
  a.click();
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.layout = button.dataset.layout;
    modeButtons.forEach((item) => item.classList.toggle("active", item === button));
    resetCanvas();
    setStatus("拼接方式已切换，请重新生成拼图。");
  });
});

seamlessButton.addEventListener("click", () => {
  gapInput.value = "0";
  fitInput.value = "cover";
  state.gap = 0;
  state.fit = "cover";
  if (state.images.length) {
    state.canvas = composeImages();
    applyFullWatermark(state.canvas);
    drawPreview();
    setStatus("已按无缝方式生成：0 间距 + 裁切铺满。");
    return;
  }
  setStatus("已切换为无缝设置：0 间距 + 裁切铺满。");
});

window.addEventListener("resize", () => {
  if (state.canvas) resizePreviewCanvas();
});

document.querySelectorAll("[data-policy]").forEach((button) => {
  button.addEventListener("click", () => {
    const isPrivacy = button.dataset.policy === "privacy";
    policyTitle.textContent = isPrivacy ? "隐私政策" : "使用条款";
    privacyPolicy.hidden = !isPrivacy;
    termsPolicy.hidden = isPrivacy;
    policyDialog.showModal();
  });
});

policyClose.addEventListener("click", () => {
  policyDialog.close();
});

policyDialog.addEventListener("click", (event) => {
  if (event.target === policyDialog) policyDialog.close();
});

function loadImage(file, index) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({
        id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        url,
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = reject;
    image.src = url;
  });
}

function renderThumbs() {
  composeButton.disabled = state.images.length < 1;
  thumbGrid.classList.toggle("empty", state.images.length === 0);

  if (!state.images.length) {
    thumbGrid.innerHTML = '<div class="empty">选择图片后会显示在这里</div>';
    return;
  }

  thumbGrid.innerHTML = state.images
    .map((item, index) => {
      const label = state.layout === "grid"
        ? `第 ${Math.floor(index / getColumns()) + 1} 行 · 第 ${(index % getColumns()) + 1} 列`
        : `第 ${index + 1} 张`;
      return `
        <article class="thumb ${state.drag?.id === item.id ? "dragging" : ""}" data-id="${item.id}">
          <img src="${item.url}" alt="${label}" />
          <strong>${label}</strong>
          <button class="delete" type="button" data-delete="${item.id}">×</button>
        </article>
      `;
    })
    .join("");

  thumbGrid.querySelectorAll(".thumb").forEach((thumb) => {
    thumb.addEventListener("pointerdown", onThumbDown);
  });

  thumbGrid.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", () => {
      state.images = state.images.filter((item) => item.id !== button.dataset.delete);
      renderThumbs();
      resetCanvas();
      setStatus("图片已删除，请重新生成拼图。");
    });
  });
}

function onThumbDown(event) {
  const thumb = event.currentTarget;
  state.drag = { id: thumb.dataset.id };
  document.body.classList.add("sorting");
  thumb.classList.add("dragging");
  document.addEventListener("pointermove", onThumbMove);
  document.addEventListener("pointerup", onThumbUp, { once: true });
  setStatus("拖到另一张缩略图上，会马上交换位置。");
}

function onThumbMove(event) {
  if (!state.drag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".thumb");
  if (!target || target.dataset.id === state.drag.id) return;

  const from = state.images.findIndex((item) => item.id === state.drag.id);
  const to = state.images.findIndex((item) => item.id === target.dataset.id);
  if (from < 0 || to < 0) return;

  const [moved] = state.images.splice(from, 1);
  state.images.splice(to, 0, moved);
  renderThumbs();
}

function onThumbUp() {
  document.removeEventListener("pointermove", onThumbMove);
  document.body.classList.remove("sorting");
  state.drag = null;
  renderThumbs();
  resetCanvas();
  setStatus("顺序已调整，请重新生成拼图。");
}

function composeImages() {
  if (state.layout === "horizontal") return composeHorizontal();
  if (state.layout === "vertical") return composeVertical();
  return composeGrid();
}

function composeGrid() {
  const cols = getColumns();
  const gap = state.gap;
  const rows = Math.ceil(state.images.length / cols);
  const colWidths = Array.from({ length: cols }, (_, col) => getColumnWidth(col, cols));
  const rowHeights = Array.from({ length: rows }, (_, row) => getRowHeight(row, cols));
  const out = makeCanvas(
    colWidths.reduce((sum, width) => sum + width, 0) + (cols - 1) * gap,
    rowHeights.reduce((sum, height) => sum + height, 0) + (rows - 1) * gap,
  );
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);

  state.images.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = colWidths.slice(0, col).reduce((sum, width) => sum + width, 0) + col * gap;
    const y = rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + row * gap;
    drawImageInBox(ctx, item, x, y, colWidths[col], rowHeights[row], state.fit);
  });
  return out;
}

function getColumnWidth(col, cols) {
  const values = state.images
    .filter((_, index) => index % cols === col)
    .map((item) => item.width);
  return values.length ? Math.min(...values) : state.images[0].width;
}

function getRowHeight(row, cols) {
  const values = state.images
    .slice(row * cols, row * cols + cols)
    .map((item) => item.height);
  return values.length ? Math.min(...values) : state.images[0].height;
}

function composeVertical() {
  const gap = state.gap;
  const width = state.images[0].width;
  const heights = state.images.map((item) => Math.round(item.height * (width / item.width)));
  const height = heights.reduce((sum, itemHeight) => sum + itemHeight, 0) + gap * (state.images.length - 1);
  const out = makeCanvas(width, height);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  state.images.forEach((item, index) => {
    ctx.drawImage(item.image, 0, y, width, heights[index]);
    y += heights[index] + gap;
  });
  return out;
}

function composeHorizontal() {
  const gap = state.gap;
  const height = state.images[0].height;
  const widths = state.images.map((item) => Math.round(item.width * (height / item.height)));
  const width = widths.reduce((sum, itemWidth) => sum + itemWidth, 0) + gap * (state.images.length - 1);
  const out = makeCanvas(width, height);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  let x = 0;
  state.images.forEach((item, index) => {
    ctx.drawImage(item.image, x, 0, widths[index], height);
    x += widths[index] + gap;
  });
  return out;
}

function drawImageInBox(ctx, item, x, y, boxW, boxH, fit) {
  if (fit === "stretch") {
    ctx.drawImage(item.image, x, y, boxW, boxH);
    return;
  }

  const scale = fit === "cover"
    ? Math.max(boxW / item.width, boxH / item.height)
    : Math.min(boxW / item.width, boxH / item.height);
  const drawW = Math.round(item.width * scale);
  const drawH = Math.round(item.height * scale);
  const drawX = Math.round(x + (boxW - drawW) / 2);
  const drawY = Math.round(y + (boxH - drawH) / 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, boxW, boxH);
  ctx.clip();
  ctx.drawImage(item.image, drawX, drawY, drawW, drawH);
  ctx.restore();
}

function makeCanvas(width, height) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width));
  out.height = Math.max(1, Math.round(height));
  return out;
}

function drawPreview() {
  if (!state.canvas) return;
  canvas.width = state.canvas.width;
  canvas.height = state.canvas.height;
  canvas.getContext("2d").drawImage(state.canvas, 0, 0);
  canvas.style.display = "block";
  stageEmpty.style.display = "none";
  downloadButton.disabled = false;
  previewMeta.textContent = `${state.canvas.width} × ${state.canvas.height}px`;
  resizePreviewCanvas();
}

function resetCanvas() {
  state.canvas = null;
  downloadButton.disabled = true;
  previewMeta.textContent = "等待生成";
  canvas.style.display = "none";
  canvas.style.width = "";
  canvas.style.height = "";
  stageEmpty.style.display = "grid";
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function resizePreviewCanvas() {
  if (!state.canvas) return;
  const padding = 48;
  const availableWidth = Math.max(120, stage.clientWidth - padding);
  const availableHeight = Math.max(120, stage.clientHeight - padding);
  const scale = Math.min(
    availableWidth / state.canvas.width,
    availableHeight / state.canvas.height,
    1,
  );
  canvas.style.width = `${Math.floor(state.canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(state.canvas.height * scale)}px`;
}

function applyFullWatermark(targetCanvas) {
  const text = watermarkText.value.trim();
  if (!text) return;

  const ctx = targetCanvas.getContext("2d");
  const density = clamp(Number(watermarkDensity.value) || 4, 3, 8);
  const size = clamp(Number(watermarkSize.value) || 28, 12, 96);
  const opacity = clamp(Number(watermarkOpacity.value) || 55, 5, 100) / 100;
  const cellW = targetCanvas.width / density;
  const cellH = targetCanvas.height / density;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = watermarkColor.value || "#dedede";
  ctx.font = `700 ${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let row = 0; row < density; row += 1) {
    for (let col = 0; col < density; col += 1) {
      const x = cellW * (col + 0.5);
      const y = cellH * (row + 0.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((-24 * Math.PI) / 180);
      drawWatermarkLines(ctx, text, size);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawWatermarkLines(ctx, text, size) {
  const lines = text.split(/\n|\\n/).filter(Boolean);
  const normalized = lines.length ? lines : [text];
  const lineHeight = size * 1.35;
  const startY = -((normalized.length - 1) * lineHeight) / 2;
  normalized.forEach((line, index) => {
    ctx.fillText(line, 0, startY + index * lineHeight);
  });
}

function getColumns() {
  return clamp(Number(columnsInput.value) || state.columns, 1, Math.max(1, state.images.length || 1));
}

function setStatus(text) {
  statusText.textContent = text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

renderThumbs();
