import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "25mb" }));

// Lazy initialize Google GenAI SDK
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not set. Real AI translation may fail unless provided.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "dummy-key",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint (compatible with Piper / userscript format)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "online", version: "4.4.0", timestamp: Date.now() });
});

// Real-time Text Translation endpoint (English -> Polish or configurable)
app.post("/api/translate", async (req, res) => {
  try {
    const { text, sourceLang = "en", targetLang = "pl", context = "general", tone = "natural" } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Brak tekstu do przetłumaczenia" });
    }

    const ai = getAI();
    const systemPrompt = `Jesteś profesjonalnym tłumaczem czasu rzeczywistego i lektorem języka polskiego.
Twoim celem jest natychmiastowe, żywe i naturalnie brzmiące przetłumaczenie tekstu z języka angielskiego (lub wykrytego) na poprawny, płynny język polski.
Wytyczne:
1. Tłumacz w stylu lektorskim/mówionym - tak jak brzmi polski lektor filmowy lub profesjonalny tłumacz symultaniczny.
2. Zachowaj emocje, sens idiomów i skróty myślowe.
3. Jeśli tekst to pojedyncze słowo lub zwrot z mowy na żywo, przetłumacz adekwatnie do kontekstu.
4. Zwróć wyłącznie samo tłumaczenie po polsku, bez cudzysłowów, bez komentarzy i bez wstępów.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: `Przetłumacz na język polski poniższy fragment:\n\n${text}`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.3,
      },
    });

    const translatedText = response.text?.trim() || "";
    return res.json({
      original: text,
      translated: translatedText,
      sourceLang,
      targetLang,
    });
  } catch (error: any) {
    console.error("Błąd tłumaczenia:", error);
    return res.status(500).json({
      error: "Błąd podczas tłumaczenia",
      details: error?.message || String(error),
    });
  }
});

// Streaming Translation endpoint (Server-Sent Events)
app.post("/api/translate-stream", async (req, res) => {
  try {
    const { text, targetLang = "pl" } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Brak tekstu" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const ai = getAI();
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.7-flash",
      contents: `Przetłumacz na naturalny język polski w stylu lektorskim:\n\n${text}`,
      config: {
        systemInstruction: "Jesteś polskim tłumaczem symultanicznym. Przetłumacz tekst bezpośrednio i naturalnie na język polski. Nie dodawaj żadnych objaśnień ani nagłówków.",
        temperature: 0.2,
      },
    });

    for await (const chunk of stream) {
      const chunkText = chunk.text;
      if (chunkText) {
        res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Stream error:", error);
    res.write(`data: ${JSON.stringify({ error: error?.message || "Błąd streamingu" })}\n\n`);
    res.end();
  }
});

// Audio Speech-to-Text & Realtime Translation (English Speech Audio -> Polish Text)
app.post("/api/transcribe-translate", async (req, res) => {
  try {
    const { audioData, mimeType = "audio/webm" } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: "Brak danych audio" });
    }

    const ai = getAI();
    const cleanBase64 = audioData.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, "");

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "audio/webm",
              data: cleanBase64,
            },
          },
          {
            text: `Posłuchaj tego nagrania (zwykle po angielsku). 
1. Zapisz dokładny oryginalny tekst mówiony.
2. Przetłumacz go na naturalny, płynny język polski w stylu lektorskim.
Zwróć wynik jako obiekt JSON z polami:
- originalText: string (rozpoznany tekst po angielsku)
- translatedText: string (tłumaczenie po polsku)
- detectedLanguage: string`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return res.json(parsed);
  } catch (error: any) {
    console.error("Transcribe-translate error:", error);
    return res.status(500).json({
      error: "Błąd przetwarzania audio",
      details: error?.message || String(error),
    });
  }
});

// Batch Subtitle translation (SRT/VTT segments)
app.post("/api/batch-translate-subtitles", async (req, res) => {
  try {
    const { segments } = req.body; // Array of { id, text, start, duration }
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: "Brak segmentów do przetłumaczenia" });
    }

    const ai = getAI();
    const payload = segments.map((s, idx) => `[${idx}] ${s.text}`).join("\n");

    const prompt = `Jesteś profesjonalnym tłumaczem napisów filmowych i lektorem.
Przetłumacz poniższe linie dialogowe z języka angielskiego na naturalny, kinowy język polski.
Zachowaj numerację indeksów [0], [1], [2]... aby zachować synchronizację czasową.

Tekst do przetłumaczenia:
${payload}

Zwróć odpowiedź w formacie JSON jako tablica obiektów:
[
  { "index": 0, "translated": "tekst po polsku..." },
  ...
]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const translatedArray = JSON.parse(response.text || "[]");
    const resultMap: Record<number, string> = {};
    for (const item of translatedArray) {
      if (item && typeof item.index === "number") {
        resultMap[item.index] = item.translated || "";
      }
    }

    const updatedSegments = segments.map((seg, idx) => ({
      ...seg,
      originalText: seg.text,
      text: resultMap[idx] || seg.text,
      translatedText: resultMap[idx] || seg.text,
    }));

    return res.json({ segments: updatedSegments });
  } catch (error: any) {
    console.error("Batch subtitle error:", error);
    return res.status(500).json({
      error: "Błąd tłumaczenia napisów",
      details: error?.message || String(error),
    });
  }
});

// Chrome Extension Direct File Downloads
app.get("/api/extension/download/:file", (req, res) => {
  const file = req.params.file;
  const validFiles = ["manifest.json", "content.js", "popup.html", "popup.js"];
  if (!validFiles.includes(file)) {
    return res.status(404).send("File not found");
  }

  const filePath = path.join(process.cwd(), "public", file);
  res.download(filePath, file);
});

// Direct link to download manifest.json with force-download headers
app.get("/api/download/manifest.json", (req, res) => {
  const filePath = path.join(process.cwd(), "public", "manifest.json");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="manifest.json"');
  res.sendFile(filePath);
});

// Server-side zip generator endpoint
app.get("/api/download/extension.zip", async (req, res) => {
  try {
    const JSZip = (await import("jszip")).default;
    const fs = await import("fs/promises");
    const zip = new JSZip();
    
    const files = ["manifest.json", "content.js", "popup.html", "popup.js"];
    for (const f of files) {
      const content = await fs.readFile(path.join(process.cwd(), "public", f), "utf-8");
      zip.file(f, content);
    }
    
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="Piper_Lektor_Chrome_Extension.zip"');
    res.send(buffer);
  } catch (err: any) {
    console.error("Zip build error:", err);
    res.status(500).send("Error generating zip");
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Tłumacz & Lektor Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
