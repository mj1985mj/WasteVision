import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import cors from "cors";
import multer from "multer";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

console.log("GEMINI_API_KEY loaded:", GEMINI_API_KEY.slice(0, 6) + "...");

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const app = express();
app.use(cors());

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`--> ${req.method} ${req.url}`);
  console.log(`    Headers: ${JSON.stringify(req.headers)}`);
  res.on("finish", () => {
    console.log(`<-- ${req.method} ${req.url} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const SYSTEM_PROMPT = `Du bist ein intelligenter Assistent zur Erkennung und richtigen Entsorgung von Abfällen.

Der Nutzer stellt dir ein Bild eines Gegenstands oder Abfalls zur Verfügung.

Analysiere das angehängte Bild und bestimme:
- Was ist auf dem Bild zu sehen?
- Aus welchem Material besteht der Gegenstand hauptsächlich?
- In welche Müllkategorie bzw. welchen Entsorgungsweg gehört der Gegenstand?
- Wie sollte der Gegenstand korrekt entsorgt werden?
- Gib zusätzlich einen kurzen und hilfreichen Tipp zur Entsorgung.

Sehr wichtig:
Die Regeln für Mülltrennung und Entsorgung können sich je nach Land unterscheiden. Verwende deshalb ausschließlich die Entsorgungsregeln des am Ende dieses Prompts angegebenen Landes.

Falls ein Gegenstand aus mehreren Materialien besteht, berücksichtige dies. Wenn Bestandteile getrennt entsorgt werden müssen, erkläre dies kurz.

Bei Batterien, Elektrogeräten, Medikamenten, Chemikalien, Farben, gefährlichen Stoffen oder anderen speziellen Abfällen sollst du besonders auf die korrekte Sonderentsorgung hinweisen.

Wenn du anhand des Bildes nicht eindeutig erkennen kannst, um welchen Gegenstand es sich handelt, stelle keine Behauptungen auf. Wähle die wahrscheinlichste Zuordnung und kennzeichne die Unsicherheit.

Antworte ausschließlich als gültiges JSON in folgendem Format:

{
  "object": "Erkannter Gegenstand",
  "material": "Material des Gegenstands",
  "waste_category": "Müllkategorie bzw. Entsorgungsweg",
  "instruction": "Kurze Erklärung zur richtigen Entsorgung",
  "tip": "Kurzer praktischer Tipp",
  "confidence": "high | medium | low"
}

Verwende kurze, verständliche Formulierungen. Gib keinen Text außerhalb des JSON-Objekts aus.`;

app.post("/classify", upload.single("image"), async (req, res) => {
  console.log("--- /classify request ---");
  console.log("  Content-Type:", req.headers["content-type"]);
  console.log("  Query params:", req.query);
  console.log("  Body fields:", req.body ? Object.keys(req.body) : "none");
  console.log("  File:", req.file ? { name: req.file.originalname, mime: req.file.mimetype, size: req.file.size } : "none");

  if (!req.file) {
    console.log("  ERROR: No image file received");
    return res.status(400).json({ error: "image file is required (field name: 'image')" });
  }

  const country = req.query.country || req.body.country || "Österreich";
  const mimeType = req.file.mimetype;
  const base64Data = req.file.buffer.toString("base64");

  console.log(`  Country: ${country}`);
  console.log(`  Image: ${mimeType}, ${req.file.size} bytes, base64 length: ${base64Data.length}`);
  console.log("  Calling Gemini API...");

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: `${SYSTEM_PROMPT}\n\nLand: ${country}` },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const text = result.response.text();
    console.log("  Gemini response:", text.slice(0, 200));

    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch {
      console.log("  WARNING: Could not parse JSON, returning raw");
      return res.json({ raw: text });
    }
  } catch (error) {
    console.error("  Gemini API error:", error.message);
    console.error("  Full error:", JSON.stringify(error, null, 2));
    return res.status(500).json({ error: "Classification failed", details: error.message });
  }
});

app.get("/health", (_req, res) => {
  console.log("Health check OK");
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Waste classifier running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /classify  - classify waste image`);
  console.log(`  GET  /health    - health check`);
});
