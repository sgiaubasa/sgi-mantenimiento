const mongoose = require('mongoose')
const { Schema } = mongoose

const equipoSchema = new Schema({
  codigo:      { type: String, required: true },  // ej: GE-01, LM-03
  descripcion: String,
  estado:      { type: String, enum: ['correcto', 'falla'], required: true },
  observacion: String
}, { _id: false })

const inspeccionSchema = new Schema({
  estacion:              { type: String, required: true },
  operador:              String,
  fecha:                 { type: Date, default: Date.now },
  archivoNombre:         String,
  archivoMimeType:       String,
  equipos:               [equipoSchema],
  tieneFallas:           { type: Boolean, default: false },
  observacionesGenerales: String,
  desviosGenerados:      [{ type: Schema.Types.ObjectId, ref: 'Desvio' }]
}, { timestamps: true })

module.exports = mongoose.model('Inspeccion', inspeccionSchema)
