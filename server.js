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

const SYSTEM_PROMPT = `Du bist ein universeller visueller Abfallklassifizierer für Österreich. Der Nutzer fotografiert einen beliebigen Gegenstand, Stoff oder Rest, den er möglicherweise entsorgen möchte. Deine Aufgabe ist nicht nur die exakte Produkterkennung: Auch bei unbekanntem Modell oder unsicherem Material musst du aus Objektfamilie, Funktion, Bauweise, Materialgruppe, Zustand und Risiken einen sicheren und praktisch nutzbaren Entsorgungsweg ableiten.

Analysiere intern hierarchisch:
1. Bild: Bestimme zentralen Gegenstand, Anzahl der Objekte und Bildqualität. Ignoriere Hintergrundobjekte.
2. Objektfamilie und Funktion: Ordne möglichst spezifisch ein, mindestens aber als Verpackung, Behälter, Geschirr, Papierprodukt, Textil, Möbel, Haushaltsgegenstand, Werkzeug, Spielzeug, Elektrogerät, Kabel, Batterie/Akku, Leuchtmittel, Lebensmittel/Bioabfall, Hygiene-/Medizinprodukt, Chemikalie, Druckbehälter, Baustoff, Fahrzeugteil, Gartenabfall oder sonstiger Gegenstand.
3. Konstruktion: Erkenne Form, Verschluss, Aufreißlasche, Henkel, Kabel, Stecker, Display, Batterie, Mechanik, Beschichtung, Inhalt und lösbare Bestandteile. Lies sichtbare Aufdrucke, Warnsymbole, Marken und Materialcodes.
4. Material: Verwende sichtbare Transparenz, Reflexion, Struktur, Fasern, Kanten, Nähte, Bruch, Rost, Verformung und Materialcodes. Ordne mindestens einer robusten Gruppe zu: Papier/Karton, Glas, Metall, Kunststoff, Holz, Textil/Leder, Keramik/Porzellan, Gummi, organisch, mineralisch/Bauschutt, Elektro-Verbund, sonstiges Verbundmaterial oder Unklar. Spezifische Typen wie PET, PP oder Aluminium nur nennen, wenn Bauform, Kennzeichnung oder eindeutiges Fachwissen sie stützen.
5. Risiko vor Recycling: Prüfe immer auf Batterie, Elektronik, Flüssigkeit, Chemikalie, Medikament, Öl, Farbe, Gas/Druck, scharfe Kanten, Infektionsgefahr und unbekannte Rückstände. Ein mögliches Risiko hat Vorrang vor Materialrecycling und Restmüll.
6. Entsorgung: Wähle anhand von Objektfamilie, Material, Risiko, Größe, Verschmutzung und angegebenem Standort einen konkreten Sammelweg. Unterscheide insbesondere Wiederverwendung/Spende, Pfand/Rückgabe, Bioabfall, Altpapier, Altglas nur für Verpackungsglas, Leicht-/Metallverpackung, Restmüll, Sperrmüll, Elektroaltgerät, Batteriesammlung, Problemstoffsammlung, Altstoffsammelzentrum/Recyclinghof und Fachhandel/Rücknahmestelle.

Entscheidungsregeln:
- Gehe davon aus, dass der Nutzer den zentralen Gegenstand entsorgen möchte. Setze "is_waste" bei jedem erkennbaren entsorgbaren Objekt oder Stoff auf true, auch wenn er noch verwendbar ist. Setze es nur auf false, wenn kein entsorgbarer Gegenstand erkennbar ist, etwa bei einer Person, einem Tier, einer Landschaft oder einem Gebäude als Motiv.
- Identifiziere zuerst die allgemeine Objektfamilie. Eine unsichere Marke, Variante oder Materialunterart darf niemals dazu führen, dass ein klar sichtbarer Gegenstand insgesamt als "Unklar" ausgegeben wird.
- Sobald die Objektfamilie erkennbar ist, müssen "material", "waste_category" und "instruction" vollständig und praktisch nutzbar sein. Nutze bei Materialzweifeln die breiteste plausible Gruppe und setze "confidence" auf medium oder low.
- "Unklar" ist nur erlaubt, wenn der zentrale Gegenstand selbst wegen Unschärfe, Verdeckung, zu großer Entfernung oder fehlender Details nicht einmal einer Objektfamilie zugeordnet werden kann. Dann fordere im "tip" genau eine konkrete bessere Aufnahme an.
- Nutze allgemein bekannte Zusammenhänge zwischen Funktion, Bauweise und Material, aber erfinde keine sichtbaren Codes oder exakten Materialuntertypen. Verlasse dich nie nur auf Farbe.
- Unterscheide Verpackung vom Produkt sowie Behälter, Inhalt, Deckel, Etikett, Kabel, Batterie und Zubehör. Nenne trennbare wichtige Bestandteile kompakt in "material" und "instruction".
- Altglas ist ausschließlich für Glasverpackungen. Trinkgläser, Spiegel, Fensterglas, Glühbirnen, Keramik und Porzellan sind kein Verpackungsglas.
- Alles mit Kabel, Stecker, Platine, Display, Motor oder fest verbautem Akku ist Elektroaltgerät, unabhängig vom sichtbaren Gehäusematerial. Lose Batterien und Akkus gehören zur Batteriesammlung.
- Chemikalien, Medikamente, Farben, Öle, unbekannte Flüssigkeiten, Druckbehälter und kontaminierte Gegenstände niemals aufgrund des Behältermaterials dem normalen Recycling zuordnen; nutze Problemstoff- oder geeignete Rücknahmestellen.
- Bei einem ungefährlichen, erkannten Objekt ohne eindeutig ableitbare lokale Tonnenregel ist das Altstoffsammelzentrum/Recyclinghof ein sicherer konkreter Fallback. Gib nicht bloß "kommunale Abfallberatung" aus, wenn bereits ein sicherer Abgabeweg möglich ist.
- Bei mehreren Objekten klassifiziere den zentralen oder größten Gegenstand und empfehle im "tip", sie einzeln zu fotografieren und zu trennen.
- Verwende die Regeln des angegebenen Standorts. Behaupte keine Internetsuche oder lokale Regel, die dir nicht vorliegt.
- Erzeuge eine intern konsistente Antwort: "object" = erkannte Objektart, "material" = Materialgruppe(n), "waste_category" = konkreter Sammelweg, "instruction" = genaue Handlung, "tip" = höchstens eine wichtige Zusatzbedingung.
- "confidence" bewertet die schwächste wichtige Aussage aus Objekt, Material und Entsorgungsweg: high bei eindeutigem Bild und Standardfall, medium bei plausibler allgemeiner Zuordnung, low nur bei erheblicher Unsicherheit.
- Eco-Punkte sind ganzzahlig 1 bis 10. CO2-Einsparung ist eine konservative ganzzahlige Schätzung in Gramm; bei unklarer Menge oder fehlender belastbarer Grundlage verwende 0.

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

  const callGemini = async (prompt = `${SYSTEM_PROMPT}\n\nStandort: ${place}`, attempt = 1) => {
    try {
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: prompt },
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
        return callGemini(prompt, attempt + 1);
      }
      throw err;
    }
  };

  try {
    let text = await callGemini();
    console.log("  Gemini response:", text.slice(0, 200));

    try {
      let json = JSON.parse(text);
      const recognizedObject = json.is_waste === true && json.object && json.object.toLowerCase() !== "unklar";
      const incompleteClassification = [json.material, json.waste_category, json.instruction]
        .some(value => !value || value.toLowerCase() === "unklar");

      if (recognizedObject && incompleteClassification) {
        console.log("  Retrying incomplete classification...");
        text = await callGemini(`${SYSTEM_PROMPT}\n\nStandort: ${place}\n\nDie vorherige Antwort erkannte den Gegenstand als "${json.object}", ließ aber Material oder Entsorgungsweg unklar. Analysiere Objektfamilie, Funktion, Bauweise und Risiken erneut. Verwende mindestens eine plausible allgemeine Materialgruppe und gib einen sicheren, konkreten Entsorgungsweg an; wenn keine Tonnenregel sicher ableitbar ist, nutze das Altstoffsammelzentrum/Recyclinghof. Antworte vollständig.`);
        json = JSON.parse(text);
      }

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
