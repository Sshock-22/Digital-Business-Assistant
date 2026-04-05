const API_BASE = window.location.origin;

function normalizeUrl(value) {
const url = value.trim();
if (!url) return "";
if (url.startsWith("http://") || url.startsWith("https://")) return url;
return `https://${url}`;
}

function show(id, visible) {
const el = document.getElementById(id);
if (!el) return;
el.classList.toggle("hidden", !visible);
}

function setText(id, text) {
const el = document.getElementById(id);
if (!el) return;
el.textContent = text;
}

function renderList(id, items) {
const el = document.getElementById(id);
if (!el) return;
el.innerHTML = "";

if (!items || items.length === 0) {
const li = document.createElement("li");
li.textContent = "Нет данных";
el.appendChild(li);
return;
}

items.forEach((item) => {
const li = document.createElement("li");
li.textContent = item;
el.appendChild(li);
});
}

function parseCompetitors(value) {
return value
.split(",")
.map((s) => normalizeUrl(s))
.filter(Boolean)
.slice(0, 3);
}

async function analyze() {
const rawUrl = document.getElementById("url").value;
const url = normalizeUrl(rawUrl);
const competitorsRaw = document.getElementById("competitors")?.value || "";
const competitors = parseCompetitors(competitorsRaw);

show("error", false);
show("result", false);
show("loading", false);

if (!url) {
setText("error", "Введите ссылку на сайт.");
show("error", true);
return;
}

show("loading", true);

try {
const res = await fetch(`${API_BASE}/api/analyze`, {
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({ url, competitors })
});

const data = await res.json();

if (!res.ok) {
throw new Error(data.error || "Ошибка анализа");
}

setText("score", `${data.score}/100`);
setText("summary", data.summary || "Краткий вывод отсутствует.");
setText("pageTitle", data.pageTitle || "—");
setText("pageDescription", data.pageDescription || "—");
setText("competitorSummary", data.competitorSummary || "Нет дополнительного сравнения.");
renderList("problems", data.problems);
renderList("recommendations", data.recommendations);
renderList("quickWins", data.quickWins);
renderList("differentiationIdeas", data.differentiationIdeas);

show("result", true);
document.getElementById("result").scrollIntoView({ behavior: "smooth", block: "start" });
} catch (err) {
setText("error", err.message || "Не удалось выполнить анализ.");
show("error", true);
} finally {
show("loading", false);
}
}