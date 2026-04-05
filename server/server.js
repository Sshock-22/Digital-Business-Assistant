require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const client = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "../client/index.html"));
});

function normalizeUrl(value) {
const url = String(value || "").trim();
if (!url) return "";
if (url.startsWith("http://") || url.startsWith("https://")) return url;
return `https://${url}`;
}

function stripHtml(html) {
return html
.replace(/<script[\s\S]*?<\/script>/gi, " ")
.replace(/<style[\s\S]*?<\/style>/gi, " ")
.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
.replace(/<!--[\s\S]*?-->/g, " ")
.replace(/<[^>]+>/g, " ")
.replace(/\s+/g, " ")
.trim();
}

function pickFirstMatch(html, regex, fallback = "—") {
const match = html.match(regex);
if (!match || !match[1]) return fallback;
return match[1].replace(/\s+/g, " ").trim();
}

function extractSignals(html) {
const title = pickFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
const description = pickFirstMatch(
html,
/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
);

const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
.map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
.filter(Boolean)
.slice(0, 12);

const text = stripHtml(html).slice(0, 12000);

return { title, description, headings, text };
}

async function fetchPageData(url) {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12000);

try {
const response = await fetch(url, {
signal: controller.signal,
headers: {
"User-Agent": "Mozilla/5.0 CyberAdvisor MVP"
}
});

if (!response.ok) {
throw new Error(`Не удалось загрузить сайт. Код ответа: ${response.status}`);
}

const html = await response.text();
return extractSignals(html);
} finally {
clearTimeout(timeout);
}
}

app.post("/api/analyze", async (req, res) => {
try {
const url = normalizeUrl(req.body?.url);
const competitors = Array.isArray(req.body?.competitors)
? req.body.competitors.map(normalizeUrl).filter(Boolean).slice(0, 3)
: [];

if (!url) {
return res.status(400).json({ error: "Не передан URL." });
}

const mainPage = await fetchPageData(url);

const competitorPages = [];
for (const competitorUrl of competitors) {
try {
const data = await fetchPageData(competitorUrl);
competitorPages.push({
url: competitorUrl,
...data
});
} catch (e) {
competitorPages.push({
url: competitorUrl,
title: "Не удалось загрузить",
description: "—",
headings: [],
text: ""
});
}
}

const competitorBlock = competitorPages.length
? competitorPages
.map((c, index) => `
Конкурент ${index + 1}
URL: ${c.url}
TITLE: ${c.title}
DESCRIPTION: ${c.description}
HEADINGS: ${(c.headings || []).join(" | ")}
TEXT_SNIPPET: ${(c.text || "").slice(0, 3000)}
`.trim())
.join("\n\n")
: "Конкурентные сайты не переданы. Сравнивай с вероятными конкурентами в этой нише и предложи, как выделиться.";

const prompt = `
Ты эксперт по digital-маркетингу, SEO, UX и позиционированию для малого бизнеса.

Нужно:
1. Проанализировать главный сайт.
2. Сравнить его с конкурентами, если они даны.
3. Если конкуренты не даны, по нише и контенту сайта предположить типичных конкурентов и дать советы по дифференциации.
4. Дать рекомендации, как выделиться: оффер, упаковка, доверие, CTA, контент, структура, преимущества, нишевание.

Верни только JSON по схеме.

Данные главного сайта:
URL: ${url}
TITLE: ${mainPage.title}
DESCRIPTION: ${mainPage.description}
HEADINGS: ${mainPage.headings.join(" | ")}
TEXT_SNIPPET: ${mainPage.text}

${competitorBlock}
`.trim();

const schema = {
type: "object",
additionalProperties: false,
properties: {
score: { type: "integer", minimum: 0, maximum: 100 },
summary: { type: "string" },
problems: {
type: "array",
items: { type: "string" },
minItems: 3,
maxItems: 5
},
recommendations: {
type: "array",
items: { type: "string" },
minItems: 3,
maxItems: 5
},
quickWins: {
type: "array",
items: { type: "string" },
minItems: 2,
maxItems: 4
},
competitorSummary: { type: "string" },
differentiationIdeas: {
type: "array",
items: { type: "string" },
minItems: 3,
maxItems: 6
}
},
required: [
"score",
"summary",
"problems",
"recommendations",
"quickWins",
"competitorSummary",
"differentiationIdeas"
]
};

const aiResponse = await client.responses.create({
model: "gpt-4o-mini",
input: [
{
role: "system",
content: "Отвечай на русском языке. Давай короткий, ясный и прикладной анализ для предпринимателя."
},
{
role: "user",
content: prompt
}
],
text: {
format: {
type: "json_schema",
name: "site_analysis",
strict: true,
schema
}
}
});

let parsed;
try {
parsed = JSON.parse(aiResponse.output_text);
} catch {
return res.status(500).json({
error: "AI вернул ответ в неожиданном формате."
});
}

return res.json({
score: parsed.score,
summary: parsed.summary,
problems: parsed.problems,
recommendations: parsed.recommendations,
quickWins: parsed.quickWins,
competitorSummary: parsed.competitorSummary,
differentiationIdeas: parsed.differentiationIdeas,
pageTitle: mainPage.title,
pageDescription: mainPage.description
});
} catch (error) {
if (error?.name === "AbortError") {
return res.status(408).json({ error: "Сайт слишком долго отвечает." });
}

return res.status(500).json({
error: "Ошибка сервера при анализе сайта.",
details: error.message
});
}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Server running on http://localhost:${PORT}`);
});