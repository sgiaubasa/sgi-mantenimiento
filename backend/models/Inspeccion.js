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
  tieneFallas:            { type: Boolean, default: false },
  tareasVerificadas:      [String],   // ítems/columnas verificados, ej: ['Puertas', 'Ventanas']
  observacionesGenerales: String,
  tipoVerificacion:       { type: String, enum: ['Personal AUBASA', 'Proveedor Externo'], default: 'Personal AUBASA' },
  proveedorExterno:       String,
  usuarioId:              { type: Schema.Types.ObjectId, ref: 'Usuario' },
  desviosGenerados:       [{ type: Schema.Types.ObjectId, ref: 'Desvio' }],
  evidenciaNombre:        String,
  evidenciaMimeType:      String,
  evidenciaData:          Buffer
}, { timestamps: true })

module.exports = mongoose.model('Inspeccion', inspeccionSchema)
