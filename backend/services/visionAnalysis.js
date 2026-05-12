const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROMPT_SISTEMA = `Sos un sistema de análisis de registros de mantenimiento preventivo para AUBASA (Autopistas de Buenos Aires S.A.).

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
- "estado" = "falla": cualquier problema, desvío, observación negativa, cruz, ítem no cumplido o vacío cuando debería estar completo
- Los códigos de equipo siguen el patrón LETRAS-NÚMERO (GE-01, LM-03, SM-02, BM-01, IN-01, VE-01)
- Si no podés extraer un campo con certeza, usá null
- Si el documento no es un registro de mantenimiento reconocible, devolvé "equipos": []
- No inventes datos que no estén en el documento`

/**
 * Analiza un PDF o imagen de registro de mantenimiento con Claude Vision.
 * @param {Buffer} fileBuffer - contenido del archivo
 * @param {string} mimeType   - 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
 * @returns {Promise<object>} - resultado estructurado del análisis
 */
async function analyzeDocument(fileBuffer, mimeType) {
  const base64Data = fileBuffer.toString('base64')

  const contentBlock = mimeType === 'application/pdf'
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
      }
    : {
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: base64Data }
      }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: PROMPT_SISTEMA }
      ]
    }]
  })

  const rawText = response.content[0].text.trim()
  // Eliminar posibles bloques markdown que el modelo incluya
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const result = JSON.parse(jsonText)
    // Normalizar: asegurar que equipos siempre sea un array
    if (!Array.isArray(result.equipos)) result.equipos = []
    return result
  } catch {
    throw new Error('La IA no devolvió un JSON válido. Respuesta: ' + rawText.substring(0, 300))
  }
}

module.exports = { analyzeDocument }
