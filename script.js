const STORAGE_KEY = "gastos-4-zonas:v1";
const TARGET_KEY = "gastos-4-zonas:targets";

const categories = {
  income: { label: "Ingreso", color: "#2176ae" },
  savings: { label: "Ahorro", color: "#1b8a5a" },
  outings: { label: "Salidas", color: "#d95d39" },
  wants: { label: "Gustos", color: "#7d5fff" },
};

const defaultTargets = {
  savings: 30,
  outings: 50,
  wants: 20,
};

const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const form = document.querySelector("#entryForm");
const monthInput = document.querySelector("#monthInput");
const amountInput = document.querySelector("#amountInput");
const dateInput = document.querySelector("#dateInput");
const noteInput = document.querySelector("#noteInput");
const entriesList = document.querySelector("#entriesList");
const comparisonBars = document.querySelector("#comparisonBars");
const exportButton = document.querySelector("#exportButton");
const saveTargets = document.querySelector("#saveTargets");
const targetWarning = document.querySelector("#targetWarning");
const trendChart = document.querySelector("#trendChart");

let entries = loadJson(STORAGE_KEY, []);
let targets = loadJson(TARGET_KEY, defaultTargets);

const today = new Date();
dateInput.value = toDateValue(today);
monthInput.value = toMonthValue(today);

document.querySelector("#targetSavings").value = targets.savings;
document.querySelector("#targetOutings").value = targets.outings;
document.querySelector("#targetWants").value = targets.wants;

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const amount = Number(amountInput.value);
  const category = new FormData(form).get("category");
  const date = dateInput.value;

  if (!amount || amount <= 0 || !date || !category) return;

  entries.unshift({
    id: crypto.randomUUID(),
    category,
    amount,
    date,
    note: noteInput.value.trim(),
    createdAt: new Date().toISOString(),
  });

  saveEntries();
  amountInput.value = "";
  noteInput.value = "";
  render();
});

monthInput.addEventListener("input", render);

saveTargets.addEventListener("click", () => {
  targets = {
    savings: cleanPercent("#targetSavings"),
    outings: cleanPercent("#targetOutings"),
    wants: cleanPercent("#targetWants"),
  };
  localStorage.setItem(TARGET_KEY, JSON.stringify(targets));
  render();
});

entriesList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  entries = entries.filter((entry) => entry.id !== button.dataset.delete);
  saveEntries();
  render();
});

exportButton.addEventListener("click", () => {
  const rows = [["fecha", "categoria", "detalle", "monto"]];
  entries.forEach((entry) => {
    rows.push([entry.date, categories[entry.category].label, entry.note, entry.amount]);
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gastos-4-zonas-${monthInput.value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

render();

function render() {
  const month = monthInput.value;
  const monthEntries = entries.filter((entry) => entry.date.startsWith(month));
  const totals = getTotals(monthEntries);
  const income = totals.income;
  const balance = income - totals.savings - totals.outings - totals.wants;

  setText("#incomeTotal", money.format(income));
  setText("#savingsTotal", money.format(totals.savings));
  setText("#outingsTotal", money.format(totals.outings));
  setText("#wantsTotal", money.format(totals.wants));
  setText("#savingsPct", `${percentOf(totals.savings, income)}%`);
  setText("#outingsPct", `${percentOf(totals.outings, income)}%`);
  setText("#wantsPct", `${percentOf(totals.wants, income)}%`);
  setText("#zoneIncome", income ? "100%" : "0%");
  setText("#zoneSavings", `${percentOf(totals.savings, income)}%`);
  setText("#zoneOutings", `${percentOf(totals.outings, income)}%`);
  setText("#zoneWants", `${percentOf(totals.wants, income)}%`);
  setText("#balanceBadge", `Balance ${money.format(balance)}`);

  renderComparison(totals, income);
  renderEntries(monthEntries);
  renderTrend();
}

function renderComparison(totals, income) {
  const targetSum = targets.savings + targets.outings + targets.wants;
  targetWarning.hidden = targetSum === 100;

  comparisonBars.innerHTML = ["savings", "outings", "wants"]
    .map((key) => {
      const real = percentOf(totals[key], income);
      const target = targets[key];
      const cappedReal = Math.min(real, 120);
      const cappedTarget = Math.min(target, 120);
      return `
        <div class="bar-row">
          <div class="bar-head">
            <span>${categories[key].label}</span>
            <span>Real ${real}% - Ideal ${target}%</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${cappedReal / 1.2}%; background:${categories[key].color}"></div>
            <i class="target-marker" style="left:${cappedTarget / 1.2}%"></i>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderEntries(monthEntries) {
  if (!monthEntries.length) {
    entriesList.innerHTML = `<div class="empty">Todavia no cargaste movimientos en este mes.</div>`;
    return;
  }

  entriesList.innerHTML = monthEntries
    .map((entry) => {
      const category = categories[entry.category];
      const note = entry.note || category.label;
      return `
        <article class="entry">
          <div class="entry-main">
            <strong>${escapeHtml(note)}</strong>
            <span>${formatDate(entry.date)} - ${category.label}</span>
          </div>
          <div class="entry-amount" style="color:${category.color}">${money.format(entry.amount)}</div>
          <button class="delete-button" type="button" data-delete="${entry.id}" aria-label="Eliminar">x</button>
        </article>
      `;
    })
    .join("");
}

function renderTrend() {
  const ctx = trendChart.getContext("2d");
  const width = trendChart.width;
  const height = trendChart.height;
  const months = getMonthSeries();

  setText("#monthCount", `${months.length} ${months.length === 1 ? "mes" : "meses"}`);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfb";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#dde3df";
  ctx.lineWidth = 1;

  for (let i = 1; i <= 4; i += 1) {
    const y = 25 + (height - 55) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(width - 18, y);
    ctx.stroke();
  }

  if (!months.length) {
    ctx.fillStyle = "#607076";
    ctx.font = "700 18px system-ui";
    ctx.fillText("Carga movimientos para ver tu progreso.", 34, 135);
    return;
  }

  drawTrendLine(ctx, months, "savings", "#1b8a5a", width, height);
  drawTrendLine(ctx, months, "outings", "#d95d39", width, height);
  drawTrendLine(ctx, months, "wants", "#7d5fff", width, height);

  ctx.fillStyle = "#607076";
  ctx.font = "700 13px system-ui";
  months.forEach((month, index) => {
    const x = xPoint(index, months.length, width);
    ctx.fillText(month.label, x - 18, height - 14);
  });
}

function drawTrendLine(ctx, months, key, color, width, height) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();

  months.forEach((month, index) => {
    const x = xPoint(index, months.length, width);
    const y = yPoint(month[key], height);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  months.forEach((month, index) => {
    const x = xPoint(index, months.length, width);
    const y = yPoint(month[key], height);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function getMonthSeries() {
  const grouped = new Map();
  entries.forEach((entry) => {
    const month = entry.date.slice(0, 7);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push(entry);
  });

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, monthEntries]) => {
      const totals = getTotals(monthEntries);
      return {
        label: month.slice(5),
        savings: percentOf(totals.savings, totals.income),
        outings: percentOf(totals.outings, totals.income),
        wants: percentOf(totals.wants, totals.income),
      };
    });
}

function getTotals(list) {
  return list.reduce(
    (acc, entry) => {
      acc[entry.category] += entry.amount;
      return acc;
    },
    { income: 0, savings: 0, outings: 0, wants: 0 },
  );
}

function xPoint(index, total, width) {
  if (total === 1) return width / 2;
  return 42 + index * ((width - 78) / (total - 1));
}

function yPoint(value, height) {
  const capped = Math.min(value, 100);
  return 22 + (100 - capped) * ((height - 62) / 100);
}

function percentOf(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function cleanPercent(selector) {
  const value = Number(document.querySelector(selector).value);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function toDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
  });
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return replacements[char];
  });
}
