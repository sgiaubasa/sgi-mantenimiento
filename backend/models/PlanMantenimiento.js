const mongoose = require('mongoose')
const { Schema } = mongoose

const mesesSchema = new Schema({
  enero:     { type: Number, default: 0 },
  febrero:   { type: Number, default: 0 },
  marzo:     { type: Number, default: 0 },
  abril:     { type: Number, default: 0 },
  mayo:      { type: Number, default: 0 },
  junio:     { type: Number, default: 0 },
  julio:     { type: Number, default: 0 },
  agosto:    { type: Number, default: 0 },
  septiembre:{ type: Number, default: 0 },
  octubre:   { type: Number, default: 0 },
  noviembre: { type: Number, default: 0 },
  diciembre: { type: Number, default: 0 }
}, { _id: false })

const planSchema = new Schema({
  estacion:  { type: String, required: true },
  anio:      { type: Number, required: true },
  categoria: { type: String, required: true }, // ej: 'Cabinas de Cobro', 'Generadores'
  planificado: mesesSchema
}, { timestamps: true })

planSchema.index({ estacion: 1, anio: 1, categoria: 1 }, { unique: true })

module.exports = mongoose.model('PlanMantenimiento', planSchema)
