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
    model: "claude-haiku-4-5-20251001",
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

async function createReelDoc(auth, topic, niche, script) {
  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  const doc = await docs.documents.create({
    requestBody: { title: `Reel: ${topic}` }
  });

  const docId = doc.data.documentId;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: `Niche: ${niche}\nTopic: ${topic}\n\n${script}`
          }
        }
      ]
    }
  });

  const file = await drive.files.get({
    fileId: docId,
    fields: "webViewLink"
  });

  return file.data.webViewLink;
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
    t.doc_url || ""
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
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive"
    ]
  });

  for (const niche of NICHES) {
    try {
      const topics = await fetchTopicsForNiche(niche);
      console.log(`📋 Found ${topics.length} topics for "${niche}"`);

      for (const topic of topics) {
        try {
          const docUrl = await createReelDoc(auth, topic.topic, niche, topic.reel_script);
          topic.doc_url = docUrl;
          console.log(`📄 Doc created: ${topic.topic}`);
        } catch (err) {
          console.error(`❌ Doc error for "${topic.topic}":`, err.message);
          topic.doc_url = "";
        }
      }

      await appendToSheet(auth, topics, niche);
      console.log(`✅ Sheet updated for "${niche}"`);
    } catch (err) {
      console.error(`❌ Error for niche "${niche}":`, err.message);
    }
  }

  console.log("\n🎉 All done!");
}

main();
