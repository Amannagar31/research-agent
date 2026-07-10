import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import dotenv from "dotenv";
import { readFileSync } from "fs";

dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NICHES = [
  "AI tools & design",
  "No-code / automation",
  "Product & UX",
  "Design case study",
  "Brand Design Case study"
];

function getCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  return JSON.parse(readFileSync("./service-account.json"));
}

async function fetchTopicsForNiche(niche) {
  console.log(`\n🔍 Researching: ${niche}`);

  const response = await client.messages.create({
    model: "Claude opus 4-8",
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [
      {
        role: "user",
        content: `You are a content research assistant for a creator who makes short-form content about design, AI tools, and creativity.

Search the web and find the top 2 trending topics in "${niche}" from the last 48 hours.

For each topic also write a 30-second reel script:
- Hook (1 punchy line)
- Insight (2-3 sentences, plain English)
- CTA (1 line)

Target audience: designers and non-devs.

Return ONLY a raw JSON array, no text before or after it:
[
  {
    "topic": "short topic title",
    "summary": "2 sentence summary of why it is trending",
    "source": "URL or platform name",
    "angle": "one content angle for designers",
    "format": "Thread / Carousel / Reel",
    "reel_script": "Hook: ...\\n\\nInsight: ...\\n\\nCTA: ..."
  }
]`
      }
    ]
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) throw new Error("No text response from Claude");

  const text = textBlock.text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in response");
  return JSON.parse(jsonMatch[0]);
}

async function appendToSheet(auth, topics, niche) {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const today = new Date().toLocaleDateString("en-IN");

  const rows = topics.map((t) => [
    today,
    niche,
    t.topic,
    t.summary,
    t.source,
    t.angle,
    t.format,
    t.reel_script || ""
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Sheet1!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows }
  });
}

async function main() {
  const credentials = getCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets"
    ]
  });

  for (const niche of NICHES) {
    try {
      const topics = await fetchTopicsForNiche(niche);
      console.log(`📋 Found ${topics.length} topics for "${niche}"`);
      await appendToSheet(auth, topics, niche);
      console.log(`✅ Sheet updated for "${niche}"`);
    } catch (err) {
      console.error(`❌ Error for niche "${niche}":`, err.message);
    }
  }

  console.log("\n🎉 All done!");
}

main();
