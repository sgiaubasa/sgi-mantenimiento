const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const PROMPT = `Sos un sistema de análisis de registros de mantenimiento preventivo para AUBASA (Autopistas de Buenos Aires S.A.).

Analizá el documento adjunto. Puede ser un Registro Genérico (Anexo 3.6), planilla de control de campo, o similar.

Devolvé ÚNICAMENTE un JSON válido sin texto adicional ni bloques markdown, con este formato exacto:
{
  "estacion": "nombre de la estación o ubicación (string o null)",
  "fecha": "fecha del registro en formato YYYY-MM-DD (string o null)",
  "operador": "nombre del responsable (string o null)",
  "equipos": [
    {
      "codigo": "código del equipo (ej: GE-01, LM-03, SM-02, BM-01)",
      "descripcion": "descripción del ítem o instalación",
      "estado": "correcto o falla",
      "observacion": "descripción del problema si estado es falla, sino null"
    }
  ],
  "observacionesGenerales": "observación general del documento o null"
}

Reglas estrictas:
- "estado" = "correcto": ítem marcado OK / Conforme / Funcionamiento Correcto / Sin Observaciones / tilde de check
- "estado" = "falla": cualquier problema, desvío, observación negativa, cruz, ítem no cumplido
- Los códigos de equipo siguen el patrón LETRAS-NÚMERO (GE-01, LM-03, SM-02, BM-01, IN-01)
- Si no podés extraer un campo con certeza, usá null
- Si el documento no es un registro de mantenimiento reconocible, devolvé "equipos": []
- No inventes datos que no estén en el documento`

/**
 * Analiza un PDF o imagen con Google Gemini (gratuito).
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 */
async function analyzeDocument(fileBuffer, mimeType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const base64Data = fileBuffer.toString('base64')

  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Data } },
    PROMPT
  ])

  const rawText = result.response.text().trim()
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed.equipos)) parsed.equipos = []
    return parsed
  } catch {
    throw new Error('La IA no devolvió un JSON válido. Respuesta: ' + rawText.substring(0, 300))
  }
}

module.exports = { analyzeDocument }
