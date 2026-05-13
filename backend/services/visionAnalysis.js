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

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Modelos en orden de fallback: prueba el primero, si falla por quota usa el siguiente
const MODELOS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-lite']
const DELAYS_MS = [5000, 15000, 30000]

async function tryModelo(modelName, fileBuffer, mimeType) {
  const model = genAI.getGenerativeModel({ model: modelName })
  const base64Data = fileBuffer.toString('base64')
  const payload = [{ inlineData: { mimeType, data: base64Data } }, PROMPT]
  const result = await model.generateContent(payload)
  const rawText = result.response.text().trim()
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed.equipos)) parsed.equipos = []
  return parsed
}

async function analyzeDocument(fileBuffer, mimeType) {
  for (let m = 0; m < MODELOS.length; m++) {
    const modelName = MODELOS[m]
    for (let intento = 0; intento < 3; intento++) {
      try {
        console.log(`[IA] Intentando con ${modelName} (intento ${intento + 1})`)
        return await tryModelo(modelName, fileBuffer, mimeType)
      } catch (err) {
        const msg = err.message || ''
        const esQuota = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate')
        const esJson  = err instanceof SyntaxError || msg.includes('JSON')

        if (esJson) throw new Error('La IA no devolvió un JSON válido. Intentá con otro documento.')

        if (esQuota) {
          if (intento < 2) {
            console.log(`[IA] Cuota ${modelName}, esperando ${DELAYS_MS[intento] / 1000}s...`)
            await sleep(DELAYS_MS[intento])
            continue
          }
          // Agotó reintentos en este modelo → probar el siguiente
          console.log(`[IA] Cambiando de modelo: ${modelName} → ${MODELOS[m + 1] || 'ninguno'}`)
          break
        }
        throw err
      }
    }
  }
  throw new Error('El servicio de IA no está disponible en este momento. Intentá en unos minutos o usá la carga manual.')
}

module.exports = { analyzeDocument }
