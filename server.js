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
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

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
- Vergib Eco-Punkte (1-10), je nachdem wie umweltfreundlich die korrekte Entsorgung ist. 10 = sehr umweltfreundlich (z.B. Recycling von Glas oder Metall), 1 = problematisch (z.B. Sondermüll).
- Schätze die CO2-Einsparung in Gramm, die durch korrekte Entsorgung/Recycling im Vergleich zur Restmüllentsorgung entsteht. Gib eine realistische Schätzung basierend auf dem Material und der Größe des Gegenstands.

Sehr wichtig:
Die Regeln für Mülltrennung und Entsorgung können sich je nach Land unterscheiden. Verwende deshalb ausschließlich die Entsorgungsregeln des am Ende dieses Prompts angegebenen Landes.

Falls ein Gegenstand aus mehreren Materialien besteht, berücksichtige dies. Wenn Bestandteile getrennt entsorgt werden müssen, erkläre dies kurz.

Bei Batterien, Elektrogeräten, Medikamenten, Chemikalien, Farben, gefährlichen Stoffen oder anderen speziellen Abfällen sollst du besonders auf die korrekte Sonderentsorgung hinweisen.

Wenn du anhand des Bildes nicht eindeutig erkennen kannst, um welchen Gegenstand es sich handelt, stelle keine Behauptungen auf. Wähle die wahrscheinlichste Zuordnung und kennzeichne die Unsicherheit.

Wenn auf dem Bild kein Abfall oder entsorgbarer Gegenstand zu sehen ist (z.B. eine Person, ein Tier, eine Landschaft, ein Gebäude, Essen auf einem Teller, etc.), setze "is_waste" auf false und gib eine kurze Erklärung in "object". Alle anderen Felder bleiben leer bzw. auf 0.

Antworte ausschließlich als gültiges JSON in folgendem Format:

{
  "is_waste": true,
  "object": "Erkannter Gegenstand",
  "material": "Material des Gegenstands",
  "waste_category": "Müllkategorie bzw. Entsorgungsweg",
  "instruction": "Kurze Erklärung zur richtigen Entsorgung",
  "tip": "Kurzer praktischer Tipp",
  "confidence": "high | medium | low",
  "eco_points": 7,
  "co2_saved_grams": 120
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
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const scanDate = `${dd}.${mm}.${now.getFullYear()}`;

      const parts = [
        json.is_waste === false ? "false" : "true",
        json.object || "",
        json.material || "",
        json.waste_category || "",
        json.instruction || "",
        json.tip || "",
        json.confidence || "",
        json.eco_points || 0,
        json.co2_saved_grams || 0,
        scanDate,
      ];
      return res.send(parts.join("|||"));
    } catch {
      console.log("  WARNING: Could not parse JSON, returning raw");
      return res.send(`error|||${text}`);
    }
  } catch (error) {
    console.error("  Gemini API error:", error.message);
    console.error("  Full error:", JSON.stringify(error, null, 2));
    return res.status(500).json({ error: "Classification failed", details: error.message });
  }
});

app.use(express.json());

app.get("/streak", (req, res) => {
  const datesParam = req.query.dates;
  if (!datesParam) {
    return res.send("0");
  }

  const dates = datesParam.split(",");
  const uniqueDates = new Set(dates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;

  for (let i = 0; i < 365; i++) {
    const check = new Date(today);
    check.setDate(check.getDate() - i);
    const dd = String(check.getDate()).padStart(2, "0");
    const mm = String(check.getMonth() + 1).padStart(2, "0");
    const formatted = `${dd}.${mm}.${check.getFullYear()}`;

    if (uniqueDates.has(formatted)) {
      streak++;
    } else {
      break;
    }
  }

  console.log(`Streak calculated: ${streak} days from ${dates.length} dates`);
  return res.send(String(streak));
});

const TIPS = [
  "Jedes recycelte Kilo Kunststoff spart im Schnitt bis zu 2 kg CO₂ gegenüber Neuproduktion.",
  "Altglas nach Farben trennen – so kann es unendlich oft recycelt werden.",
  "Elektrogeräte gehören nie in den Restmüll – sie enthalten wertvolle Rohstoffe wie Gold und Kupfer.",
  "Biomüll wird zu Kompost oder Biogas – eine Bananenschale liefert Energie für 30 Minuten Licht.",
  "Aluminium recyceln spart 95% der Energie gegenüber der Neuherstellung.",
  "Papier kann bis zu 7 Mal recycelt werden, bevor die Fasern zu kurz werden.",
  "Eine einzige Batterie kann bis zu 400 Liter Wasser verunreinigen – immer zur Sammelstelle bringen.",
  "Tetra Paks gehören in die Gelbe Tonne – sie bestehen aus Karton, Kunststoff und Aluminium.",
  "Alte Kleidung in gutem Zustand gehört in die Altkleidersammlung, nicht in den Restmüll.",
  "Korken sammeln lohnt sich – Naturkork wird zu Dämmmaterial recycelt.",
  "Medikamente niemals über die Toilette entsorgen – sie belasten das Grundwasser.",
  "Kaffeekapseln aus Aluminium können recycelt werden – einfach in die Gelbe Tonne.",
  "Ein Smartphone enthält über 30 verschiedene Metalle – Recycling lohnt sich enorm.",
  "Pizzakartons mit Fettflecken gehören in den Restmüll, saubere Teile ins Altpapier.",
  "Styropor-Verpackungen gehören in die Gelbe Tonne, Styropor-Dämmplatten zum Wertstoffhof.",
  "Glasflaschen brauchen 4.000 Jahre zum Verrotten – aber nur Sekunden zum Recyceln.",
  "Leere Spraydosen gehören in die Gelbe Tonne – aber nur wenn sie komplett leer sind.",
  "Kronkorken sind aus Weißblech und gehören in die Gelbe Tonne.",
  "Energiesparlampen enthalten Quecksilber – immer zur Schadstoffsammlung bringen.",
  "Jede Tonne recyceltes Altpapier spart ca. 15 Bäume und 26.000 Liter Wasser.",
];

app.get("/tip", (_req, res) => {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  res.send(tip);
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
