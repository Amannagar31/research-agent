import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchTrendingTopics() {
  console.log("🔍 Searching for trending topics...");

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [
      {
        role: "user",
        content: `You are a content research assistant for a creator who writes for designers and non-developers building with AI tools.

Search the web right now and find the top 5 trending topics in the 'AI tools & design' space from the last 48 hours.
Look at X/Twitter, Reddit (r/artificial, r/ChatGPT, r/DesignTools), Product Hunt, and tech blogs.

Return ONLY a raw JSON array — no markdown, no backticks, no explanation. Format:
[
  {
    "topic": "short topic title",
    "summary": "2 sentence plain English summary of why it is trending",
    "source": "URL or platform name",
    "angle": "one content angle for designers or non-devs building with AI",
    "format": "Thread / Carousel / Long-form"
  }
]`,
      },
    ],
  });

  // Web search runs server-side; response has multiple text blocks — join them all
  const fullText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const match = fullText.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array found in response:\n${fullText}`);
  return JSON.parse(match[0]);
}

async function appendToSheet(topics) {
  const credentials = JSON.parse(readFileSync("./service-account.json"));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const rawId = process.env.GOOGLE_SHEET_ID;
  const sheetId = rawId.includes("/d/")
    ? rawId.match(/\/d\/([a-zA-Z0-9_-]+)/)[1]
    : rawId;
  const today = new Date().toLocaleDateString("en-IN");

  const rows = topics.map((t) => [
    today,
    t.topic,
    t.summary,
    t.source,
    t.angle,
    t.format,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Sheet1!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  console.log(`✅ ${rows.length} topics written to Google Sheets`);
}

async function main() {
  try {
    const topics = await fetchTrendingTopics();
    console.log(`\n📋 Found ${topics.length} topics:\n`);
    topics.forEach((t, i) => console.log(`${i + 1}. ${t.topic}`));
    await appendToSheet(topics);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main();
