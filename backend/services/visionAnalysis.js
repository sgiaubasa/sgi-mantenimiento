const Groq     = require('groq-sdk')
const pdfParse = require('pdf-parse')

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const TEXT_MODEL   = 'llama-3.3-70b-versatile'

const PROMPT_BASE = `Sos un sistema de análisis de registros de mantenimiento preventivo para AUBASA (Autopistas de Buenos Aires S.A.).

Analizá el contenido. Puede ser un Registro Genérico (Anexo 3.6), planilla de control de campo, o similar.
El documento puede tener una tabla con filas de equipos (ej: CC 01, CC 02, AA-01) y columnas de ítems a verificar (ej: Puertas, Ventanas, Luminarias, Limpieza exterior).

Devolvé ÚNICAMENTE un JSON válido sin texto adicional ni bloques markdown, con este formato exacto:
{
  "estacion": "nombre de la estación o ubicación (string o null)",
  "fecha": "fecha del registro en formato YYYY-MM-DD (string o null)",
  "operador": "nombre del responsable (string o null)",
  "tareasVerificadas": ["Puertas", "Ventanas", "Luminarias"],
  "equipos": [
    {
      "codigo": "código del equipo (ej: CC 01, CC-01, GE-01, AA-01)",
      "descripcion": "descripción del ítem o instalación",
      "estado": "correcto o falla",
      "observacion": "descripción del problema si estado es falla, sino null",
      "tareasOk": ["Puertas", "Ventanas"],
      "tareasConFalla": ["Luminarias"]
    }
  ],
  "observacionesGenerales": "observación general del documento o null"
}

Reglas:
- "tareasVerificadas": lista de los nombres de columnas/ítems verificados en el documento
- "estado" = "correcto" si todos sus ítems están OK; "falla" si al menos uno tiene problema
- Los códigos siguen patrones como CC 01, AA-01, GE-01, LM-03 (letras + número)
- Si no hay tabla de ítems, dejá "tareasVerificadas", "tareasOk", "tareasConFalla" como []
- Si no podés extraer un campo con certeza, usá null
- No inventes datos que no estén en el documento`

function parseRespuesta(raw) {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(clean)
  if (!Array.isArray(parsed.equipos)) parsed.equipos = []
  return parsed
}

// Convierte primera página de PDF a PNG usando pdfjs-dist + canvas
async function pdfToPng(fileBuffer) {
  const pdfjsLib    = require('pdfjs-dist/legacy/build/pdf.js')
  const { createCanvas } = require('canvas')

  const data = new Uint8Array(fileBuffer)
  const doc  = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise
  const page = await doc.getPage(1)

  const scale    = 2
  const viewport = page.getViewport({ scale })
  const canvas   = createCanvas(viewport.width, viewport.height)
  const ctx      = canvas.getContext('2d')

  await page.render({ canvasContext: ctx, viewport }).promise

  return canvas.toBuffer('image/png')
}

async function analyzeImageGroq(fileBuffer, mimeType) {
  const base64 = fileBuffer.toString('base64')
  const resp = await groq.chat.completions.create({
    model: VISION_MODEL,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      { type: 'text', text: PROMPT_BASE }
    ]}],
    temperature: 0,
    max_tokens: 4096
  })
  return parseRespuesta(resp.choices[0].message.content)
}

async function analyzeTextGroq(text) {
  const resp = await groq.chat.completions.create({
    model: TEXT_MODEL,
    messages: [{ role: 'user',
      content: `${PROMPT_BASE}\n\nContenido del documento:\n\`\`\`\n${text.slice(0, 12000)}\n\`\`\``
    }],
    temperature: 0,
    max_tokens: 4096
  })
  return parseRespuesta(resp.choices[0].message.content)
}

async function analyzeDocument(fileBuffer, mimeType) {
  // ── PDFs ──────────────────────────────────────────────────────────────────
  if (mimeType === 'application/pdf') {
    // 1. Intentar extraer texto (PDFs digitales)
    try {
      const data  = await pdfParse(fileBuffer)
      const texto = data.text?.trim() || ''
      if (texto.length > 100) {
        console.log(`[IA] PDF digital (${texto.length} chars) → Groq texto`)
        return await analyzeTextGroq(texto)
      }
    } catch (e) {
      console.log('[IA] pdf-parse error:', e.message)
    }

    // 2. PDF escaneado → convertir primera página a PNG → Groq Vision
    console.log('[IA] PDF escaneado → convirtiendo a imagen → Groq Vision')
    const pngBuffer = await pdfToPng(fileBuffer)
    return await analyzeImageGroq(pngBuffer, 'image/png')
  }

  // ── Imágenes → Groq Vision ────────────────────────────────────────────────
  console.log(`[IA] Imagen ${mimeType} → Groq Vision`)
  return await analyzeImageGroq(fileBuffer, mimeType)
}

module.exports = { analyzeDocument }
