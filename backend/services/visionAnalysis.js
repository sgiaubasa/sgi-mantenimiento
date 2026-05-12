const { GoogleGenerativeAI } = require('@google/generative-ai')

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const PROMPT = `Sos un sistema de análisis de registros de mantenimiento preventivo para AUBASA (Autopistas de Buenos Aires S.A.).

Analizá el documento adjunto. Puede ser un Registro Genérico (Anexo 3.6), planilla de control de campo, o similar.
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

Reglas estrictas:
- "tareasVerificadas": lista de los nombres de columnas/ítems que se verifican en el documento (las que aparecen como encabezados)
- "estado" del equipo = "correcto" si todos sus ítems están OK; "falla" si al menos uno tiene problema
- "tareasOk": lista de ítems del equipo que están marcados OK/Conforme/check
- "tareasConFalla": lista de ítems con problema, desvío, observación negativa o sin marcar
- Los códigos de equipo siguen patrones como CC 01, CC-01, AA-01, GE-01, LM-03 (letras + número)
- Si no hay tabla de ítems, dejá "tareasVerificadas", "tareasOk", "tareasConFalla" como []
- Si no podés extraer un campo con certeza, usá null
- Si el documento no es un registro de mantenimiento reconocible, devolvé "equipos": []
- No inventes datos que no estén en el documento`

/**
 * Analiza un PDF o imagen con Google Gemini (gratuito).
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 */
async function analyzeDocument(fileBuffer, mimeType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' })

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
