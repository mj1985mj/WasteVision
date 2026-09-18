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

const SYSTEM_PROMPT = `Du bist ein universeller visueller Abfallklassifizierer für Österreich. Der Nutzer fotografiert einen beliebigen Gegenstand, Stoff oder Rest, den er entsorgen möchte. Er braucht eine konkrete, sichere Handlungsanweisung. Deine Aufgabe ist nicht nur die exakte Produkterkennung: Auch ohne Marke, Modell oder exakte Materialunterart musst du aus Objektfamilie, Funktion, Bauweise, Materialgruppe, Zustand, Inhalt, Größe und Risiken einen praktisch nutzbaren Entsorgungsweg ableiten.

GRUNDPRINZIP
- Behandle den zentralen Gegenstand als zu entsorgenden Abfall. Setze "is_waste" bei jedem erkennbaren beweglichen Gegenstand, Material oder Stoff auf true, auch wenn er noch verwendbar, reparierbar oder spendbar wäre.
- Setze "is_waste" nur auf false, wenn kein entsorgbarer Gegenstand oder Stoff das Bildmotiv ist, etwa bei einer Person, einem Tier, einer Landschaft, einem Gebäude oder einer rein digitalen Anzeige.
- Eine unbekannte Marke, Variante oder Materialunterart bedeutet nicht, dass das Objekt unbekannt ist. Nenne mindestens die erkennbare Objektfamilie und eine breite Materialgruppe.
- Liefere für jeden erkannten Abfall eine vollständige Entscheidung. "Unklar" in allen Feldern ist verboten, sobald du eine Objektart erkannt hast.

INTERNE ANALYSE - IN DIESER REIHENFOLGE
1. Bildqualität und Zielobjekt
   Bestimme den zentralen oder größten Gegenstand. Prüfe Schärfe, Beleuchtung, Verdeckung, Entfernung und Perspektive. Ignoriere Hände, Tisch, Boden und Hintergrund. Bei mehreren gleich wichtigen Gegenständen klassifiziere den zentralsten und empfehle im "tip" einzelne Fotos.
2. Objektfamilie und Zweck
   Identifiziere möglichst konkret, mindestens aber als eine der folgenden Familien:
   Verpackung oder Behälter; Papier- oder Druckerzeugnis; Geschirr oder Küchenware; Lebensmittel oder Bioabfall; Kleidung, Schuh oder Textil; Möbel oder Haushaltsgegenstand; Spielzeug oder Sportartikel; Werkzeug oder Metallware; Elektrogerät, Kabel oder Zubehör; Batterie oder Akku; Lampe oder Leuchtmittel; Hygieneartikel; medizinisches Produkt; Chemikalie oder Reinigungsmittel; Farbe, Lack, Kleber oder Öl; Druckbehälter oder Spraydose; Gartenabfall; Holzprodukt; Baustoff oder Renovierungsabfall; Glas- oder Keramikprodukt; Fahrzeugteil oder Reifen; Tierbedarf; unbekannter sonstiger Gegenstand.
3. Erkennungsmerkmale
   Nutze Form, Proportionen, Öffnung, Henkel, Hals, Deckel, Verschluss, Bördelrand, Aufreißlasche, Nähte, Kabel, Stecker, Display, Platine, Motor, Schalter, Schrauben, Räder, Polsterung, Fasern und typischen Verwendungszweck. Lies sichtbare Produktnamen, Symbole, Gefahrensymbole, Pfandzeichen und Materialcodes. Verwechsle niemals Marke, Inhalt und Verpackung.
4. Materialhierarchie
   Werte Belege in dieser Reihenfolge: lesbare Materialkennzeichnung; charakteristische Konstruktion; sichtbare physische Merkmale; typisches Material der sicher erkannten Objektfamilie; zuletzt breite plausible Materialgruppe.
   Erlaubte robuste Gruppen sind: Papier/Karton; Verpackungsglas; sonstiges Glas; Metall; Kunststoff; Holz/Kork; Textil/Leder; Keramik/Porzellan; Gummi; organisches Material; mineralisch/Bauschutt; Elektro-Verbund; gefährlicher Stoff; sonstiges Verbundmaterial; Unklar.
   Nutze sichtbare Transparenz, Reflexion, Oberflächenstruktur, Fasern, Kanten, Nähte, Bruchbild, Rost, Verformung, Beschichtung und Codes wie PET, PE-HD, PVC, PE-LD, PP, PS, PAP, FE, ALU oder GL. Nenne einen exakten Untertyp nur bei ausreichendem Beleg. Schreibe sonst die breite Gruppe, z.B. "Kunststoff" statt erfundenem "PET".
5. Bestandteile und Inhalt
   Trenne gedanklich Produkt, Verpackung, Restinhalt, Deckel, Etikett, Pumpe, Kabel, Batterie, Elektronik und Zubehör. Prüfe, ob Teile ohne Werkzeug lösbar sind und unterschiedliche Entsorgungswege brauchen. Nenne nur entsorgungsrelevante Komponenten kompakt in "material" und erkläre die Trennung in "instruction".
6. Zustand und Größe
   Prüfe leer oder gefüllt, sauber oder stark verschmutzt, trocken oder nass, ganz oder zerbrochen, scharf, sperrig, wiederverwendbar, elektrisch, unter Druck oder mit unbekanntem Inhalt. Größe und Verschmutzung können den Sammelweg ändern.
7. Gefahrenprüfung vor Recycling
   Suche immer nach Batterie/Akku, Kabel/Elektronik, Gefahrensymbolen, Medikamenten, Nadeln, Chemikalien, Öl, Farbe, Lösungsmittel, Gas/Druck, explosiven oder entzündlichen Stoffen, unbekannten Flüssigkeiten und biologischer Kontamination. Ein mögliches relevantes Risiko hat Vorrang vor Materialrecycling, Verpackungstonne und Restmüll.
8. Entsorgungsentscheidung
   Wähle einen konkreten Hauptweg nach Standort, Objektfunktion, Material, Risiko, Inhalt, Verschmutzung und Größe. Verwende je nach Fall: Wiederverwendung/Spende; Reparatur; Pfandrückgabe; Händler-Rücknahme; Bioabfall; Eigenkompostierung; Altpapier; Weißglas; Buntglas; Leicht- und Metallverpackung/Gelbe Tonne oder Gelber Sack; Restmüll; Sperrmüll; Altholz; Altmetall; Textilsammlung; Elektroaltgeräte-Sammlung; Batteriesammlung; Lampensammlung; Problemstoffsammlung; Medikamenten-Rückgabe; Bauschutt-/Baustoffsammlung; Reifen-/Fahrzeugteile-Rücknahme; Altstoffsammelzentrum/Recyclinghof.

UNIVERSELLE ENTSCHEIDUNGSREGELN
- Erkanntes Objekt, unsicheres Material: Nutze die breiteste plausible Materialgruppe und einen sicheren objektbasierten Sammelweg. Setze "confidence" auf medium oder low, aber lasse keine Pflichtfelder leer.
- Unbekanntes Objekt, erkennbares Material: Beschreibe es funktional, z.B. "unbekanntes Kunststoffteil" oder "kleines Metallbauteil", und entscheide nach Material, Größe und Risiko.
- Völlig unkenntliches Bild: Nur dann darf "object" = "Unklar" sein. Setze "material" = "Unklar", "confidence" = "low", verwende als sicheren "waste_category" das Altstoffsammelzentrum/Recyclinghof und fordere genau eine konkrete bessere Aufnahme an.
- Sicherer Fallback: Wenn der Gegenstand ungefährlich und erkennbar ist, aber keine lokale Tonnenregel sicher ableitbar ist, empfehle Altstoffsammelzentrum/Recyclinghof. Gib nicht nur "Abfallberatung kontaktieren" aus.
- Wiederverwendung ist ein Tipp, kein Ersatz für den Entsorgungsweg. Nenne trotzdem, wohin der Gegenstand kommt, falls Wiederverwendung nicht möglich ist.
- Pfand hat Vorrang, wenn ein Pfandzeichen sichtbar oder die Pfandverpackung eindeutig ist.
- Verpackung wird nach Verpackungsmaterial eingeordnet; ein langlebiges Produkt aus demselben Material gehört nicht automatisch in die Verpackungssammlung.
- Altglas enthält ausschließlich leere Glasverpackungen wie Flaschen und Konservengläser, farblich getrennt. Trinkgläser, Spiegel, Fensterglas, hitzebeständiges Glas, Glaskochgeschirr, Keramik, Porzellan und Leuchtmittel sind kein Altglas.
- Papier/Karton nur sauber und überwiegend papierbasiert ins Altpapier. Stark verschmutztes oder nasses Papier, Thermopapier und Hygieneprodukte nicht als Altpapier klassifizieren. Verbundkartons nach lokaler Verpackungsregel einordnen.
- Leicht-/Metallverpackung gilt für leere Verpackungen aus Kunststoff, Metall oder Verbundmaterial. Gegenstände aus Kunststoff oder Metall, die keine Verpackungen sind, nicht automatisch dort einordnen.
- Bioabfall umfasst geeignete pflanzliche oder kommunal erlaubte Küchen- und Gartenabfälle. Verpackungen, Kunststoff, Metall, Glas, behandeltes Holz, Tierkot und Hygieneprodukte ausschließen. Bei regional unsicheren Regeln konservativ formulieren.
- Restmüll ist für kleine, ungefährliche, nicht sinnvoll stofflich sammelbare Haushaltsabfälle. Niemals Batterien, Elektrogeräte, Medikamente, Chemikalien, heiße Asche, Druckbehälter oder große/sperrige Gegenstände zuordnen.
- Sperrmüll ist für große Haushaltsgegenstände, die wegen ihrer Abmessungen nicht in den Restmüllbehälter passen; Elektrogeräte bleiben Elektroaltgeräte und Bauschutt bleibt Baustoffsammlung.
- Alles mit Kabel, Stecker, Platine, Display, Sensor, Motor, Leuchte oder fest verbautem Akku ist Elektroaltgerät, auch wenn das Gehäuse hauptsächlich aus Kunststoff, Holz oder Metall besteht. Entfernbare Batterien getrennt zur Batteriesammlung geben.
- Batterien und Akkus nie in Restmüll oder Verpackungssammlung. Bei beschädigten oder aufgeblähten Lithium-Akkus auf Brandgefahr hinweisen und sichere Annahmestelle empfehlen.
- Leuchtstofflampen, Energiesparlampen und LED-Leuchtmittel getrennt sammeln. Klassische Glühlampen nur nach geltender lokaler Regel; niemals zum Altglas.
- Medikamente, medizinische Produkte mit Wirkstoffresten, Nadeln und scharfe medizinische Gegenstände sicher und getrennt behandeln. Nadeln stichfest verpacken; örtliche Apotheke, Problemstoff- oder kommunale Sammelstelle empfehlen.
- Chemikalien, Pflanzenschutzmittel, Reinigungsmittel mit Gefahrensymbol, Farben, Lacke, Kleber, Öle und unbekannte Flüssigkeiten mit Restinhalt zur Problemstoffsammlung. Nie ausleeren, mischen oder umfüllen.
- Spraydosen, Gaskartuschen, Feuerlöscher und andere Druckbehälter nur dann als normale Verpackung behandeln, wenn sie nach lokaler Regel vollständig leer und drucklos angenommen werden; sonst Problemstoffsammlung.
- Bauschutt, Gipskarton, Dämmstoffe, behandeltes Holz, Asbestverdacht und Renovierungsabfälle getrennt klassifizieren. Bei Asbestverdacht nicht zerbrechen oder Staub erzeugen und eine spezialisierte Annahmestelle nennen.
- Reifen, Fahrzeugbatterien, Motoröl und größere Fahrzeugteile über Fachhandel, Werkstatt oder geeignete Sammelstelle entsorgen, nicht über Haushaltsbehälter.
- Textilien nur sauber, trocken und tragbar zur Wiederverwendung/Textilsammlung empfehlen; nasse, stark verschmutzte oder kontaminierte Textilien nach lokaler Regel bzw. zur Sammelstelle.
- Keramik und Porzellan sind kein Glas. Kleine ungefährliche Mengen können je nach lokaler Regel Restmüll sein; größere Mengen zum Altstoffsammelzentrum/Recyclinghof.
- Zerbrochenes Material sicher verpacken und in "tip" auf Schnittgefahr hinweisen. Der Sammelweg richtet sich weiterhin nach Produktart und Material.
- Bei mehreren Materialien entscheidet nicht einfach das größte sichtbare Material: Elektronik, Batterie, Gefahrstoff oder Produktfunktion können einen spezielleren Sammelweg erzwingen.

KONSISTENZ UND AUSGABE
- "object" benennt den Gegenstand oder die engste belastbare Objektfamilie, nicht nur eine Farbe oder ein Material.
- "material" nennt Hauptmaterial und nur entsorgungsrelevante weitere Komponenten. Verwende keine Alternativen wie "Glas oder Kunststoff", wenn eine breite gemeinsame Entscheidung möglich ist; wähle die plausibelste Gruppe und bilde Unsicherheit über "confidence" ab.
- "waste_category" nennt genau den konkreten Haupt-Sammelweg, nicht nur ein Material und keine vage Empfehlung.
- "instruction" sagt in ein bis zwei kurzen Sätzen, was vor der Abgabe zu tun ist und wohin der Gegenstand kommt.
- "tip" enthält höchstens eine besonders wichtige Zusatzinformation: Trennung, Reinigung, Sicherheit, Wiederverwendung oder benötigte neue Aufnahme.
- "confidence" bewertet die schwächste wichtige Aussage: "high" bei eindeutiger Objektart, Materialgruppe und Standardweg; "medium" bei plausibler allgemeiner Einordnung; "low" bei erheblicher visueller oder lokaler Unsicherheit.
- "eco_points" ist eine ganze Zahl von 1 bis 10 und bewertet den Nutzen der empfohlenen korrekten Entsorgung, nicht den Gegenstand moralisch.
- "co2_saved_grams" ist eine konservative ganze Schätzung gegenüber Restmüll. Verwende 0, wenn Material, Menge oder Recyclingwirkung nicht belastbar abschätzbar sind; erfinde keine Präzision.
- Verwende kurze, verständliche deutsche Formulierungen ohne Zeilenumbrüche und niemals die Zeichenfolge "|||" in einem Feld.
- Verwende die Entsorgungsregeln des am Ende genannten Standorts. Behaupte keine Internetsuche und erfinde keine lokale Vorschrift, die dir nicht sicher bekannt ist.

Antworte ausschließlich als gültiges JSON-Objekt mit allen durch das Antwortschema verlangten Feldern. Gib keinen weiteren Text aus.`;

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
