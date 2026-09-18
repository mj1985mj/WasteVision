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

const SYSTEM_PROMPT = `Du bist ein visueller Abfallklassifizierer für Österreich. Der Nutzer fotografiert etwas, das er entsorgen möchte. Erkenne ein breites Spektrum: Verpackungen, Lebensmittel und Bioabfall, Papier, Glas, Metall, Kunststoffe, Textilien, Holz, Sperrmüll, Elektrogeräte, Batterien, Lampen, Medikamente, Chemikalien, Hygieneartikel, Bauschutt und unbekannte Gegenstände.

Arbeite intern in dieser Reihenfolge:
1. Prüfe die Bildqualität und bestimme den zentralen Gegenstand. Nutze Form, Größe, Aufdrucke, Logos, Verschlüsse und sichtbare Funktion. Verwechsle Marke oder Inhalt nicht mit der Verpackung.
2. Bestimme die Bauform, z.B. Getränkedose, Flasche, Becher, Karton, Folie, Schale, Elektrogerät oder organischer Rest.
3. Bestimme Material und Bestandteile anhand sichtbarer Belege: Transparenz, Glanz, Struktur, Kanten, Nähte, Bruchstellen, Rost, Verformung und lesbare Materialcodes wie PET, PP, PE-HD, PAP, GL, FE oder ALU. Übliche Bauformen sind ebenfalls starke Hinweise: Eine Getränkedose mit Bördelrand und Aufreißlasche ist Metall, meist Aluminium, und kein PET.
4. Prüfe, ob mehrere Teile getrennt werden müssen, etwa Behälter, Deckel, Etikett, Batterie oder Inhalt. Nenne diese Materialien kompakt im Feld "material".
5. Ordne erst danach den Entsorgungsweg nach den Regeln des angegebenen Standorts zu. Berücksichtige Zustand und Inhalt: leer, verschmutzt, zerbrochen, elektrisch, unter Druck oder mit gefährlichen Reststoffen.

Regeln:
- Behandle den Gegenstand als Abfall, wenn der Nutzer ihn offensichtlich entsorgen möchte. Auch Essensreste, benutzte Alltagsgegenstände und wiederverwendbare Gegenstände können Abfall sein. Setze "is_waste" nur dann auf false, wenn kein einzelner entsorgbarer Gegenstand erkennbar ist, z.B. bei einer Person, einem Tier, einer Landschaft oder einem Gebäude.
- Erkenne die allgemeine Objektart auch dann, wenn Marke oder exaktes Modell unbekannt sind.
- Nutze keine angebliche Internetsuche. Ziehe nur Bildinformationen und verlässliches Allgemeinwissen heran.
- Verlasse dich nicht nur auf Farbe. Erfinde keine Recyclingcodes, Produktdetails oder Materialien.
- Gib einen spezifischen Kunststofftyp wie PET oder PP nur bei sichtbarem Code oder eindeutig bekannter Bauform an; sonst schreibe allgemein "Kunststoff".
- Wenn Objekt oder Material nicht zuverlässig erkennbar sind, schreibe "Unklar" für den unsicheren Teil, setze "confidence" auf "low" und fordere im "tip" genau eine hilfreiche neue Aufnahme an, z.B. Unterseite, Rückseite, Materialcode oder Nahaufnahme.
- Bei mehreren sichtbaren Gegenständen klassifiziere den zentralen bzw. größten und erwähne im "tip", dass Gegenstände einzeln fotografiert werden sollen.
- Batterien, Elektrogeräte, Medikamente, Chemikalien, Farben, Druckbehälter und andere gefährliche Abfälle gehören nicht in den Restmüll. Weise auf die passende Sammelstelle hin.
- Verwende ausschließlich die Entsorgungsregeln des am Ende angegebenen Standorts. Wenn keine lokale Regel sicher bekannt ist, empfehle die kommunale Abfallberatung statt eine Regel zu erfinden.
- "confidence" bewertet die schwächste wichtige Aussage aus Objekt, Material und Entsorgungsweg.
- Eco-Punkte liegen ganzzahlig zwischen 1 und 10. CO2-Einsparung ist eine konservative ganzzahlige Schätzung in Gramm; bei unklarer Menge oder unklarem Material verwende 0.

Antworte kurz und verständlich auf Deutsch. Gib ausschließlich das verlangte JSON-Objekt aus.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    is_waste: { type: "boolean" },
    object: { type: "string" },
    material: { type: "string" },
    waste_category: { type: "string" },
    instruction: { type: "string" },
    tip: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    eco_points: { type: "integer" },
    co2_saved_grams: { type: "integer" },
  },
  required: ["is_waste", "object", "material", "waste_category", "instruction", "tip", "confidence", "eco_points", "co2_saved_grams"],
};

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

  const place = req.query.place || req.query.country || "Österreich";
  const mimeType = req.file.mimetype;
  const base64Data = req.file.buffer.toString("base64");

  console.log(`  Place: ${place}`);
  console.log(`  Image: ${mimeType}, ${req.file.size} bytes, base64 length: ${base64Data.length}`);
  console.log("  Calling Gemini API...");

  const callGemini = async (attempt = 1) => {
    try {
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: `${SYSTEM_PROMPT}\n\nStandort: ${place}` },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
        },
      });
      return result.response.text();
    } catch (err) {
      if (attempt < 3 && (err.message?.includes("503") || err.message?.includes("429") || err.message?.includes("high demand"))) {
        console.log(`  Retry ${attempt}/2 after ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
        return callGemini(attempt + 1);
      }
      throw err;
    }
  };

  try {
    const text = await callGemini();
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
