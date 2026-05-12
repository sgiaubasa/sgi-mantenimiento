const mongoose = require('mongoose')
const { Schema } = mongoose

const desvioSchema = new Schema({
  // Identificador único del equipo para el cierre automático por próxima carga
  codigoEquipo:           { type: String, required: true, index: true },
  descripcionEquipo:      String,
  observacionFalla:       String,  // detectado por IA

  // Datos cargados por el usuario al momento del desvío
  descripcionDesvio:      { type: String, required: true },
  accionImplementar:      { type: String, required: true },
  fechaEstimadaEjecucion: { type: Date, required: true },

  // Ciclo de vida
  estado:                 { type: String, enum: ['Pendiente', 'Cerrado'], default: 'Pendiente' },
  idInspeccionOrigen:     { type: Schema.Types.ObjectId, ref: 'Inspeccion', required: true },
  idInspeccionCierre:     { type: Schema.Types.ObjectId, ref: 'Inspeccion' },
  fechaRealCierre:        Date,
  eficacia:               { type: String, enum: ['Eficaz', 'No Eficaz'] },
  motivoCierre:           { type: String, enum: ['manual', 'automatico'] }
}, { timestamps: true })

// Índice compuesto: buscar desvíos pendientes por equipo eficientemente
desvioSchema.index({ codigoEquipo: 1, estado: 1 })

module.exports = mongoose.model('Desvio', desvioSchema)
