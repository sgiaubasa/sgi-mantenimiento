const mongoose = require('mongoose')
const { Schema } = mongoose

// Códigos de responsable según el plan AUBASA
const RESPONSABLES = ['SUP','MAA','MAE','MAN','MVI','MED','ELE','JES','PEX']
const PERIODICIDADES = ['diario','semanal','quincenal','mensual','trimestral','semestral','anual']

const itemPlanSchema = new Schema({
  estacion:          { type: String, required: true },
  anio:              { type: Number, required: true },
  equipo:            { type: String, required: true }, // ej: 'Cabinas de Peaje', 'Aires Acondicionados'
  codigoPrefix:      { type: String },                 // ej: 'CP', 'AA' — para cruzar con inspecciones
  tarea:             { type: String, required: true }, // ej: 'Puertas', 'Ventanas'
  responsable:       { type: String, enum: RESPONSABLES, required: true },
  proveedorExterno:  { type: String, default: null },  // nombre empresa si responsable = PEX
  periodicidad:      { type: String, enum: PERIODICIDADES, required: true },
  activo:            { type: Boolean, default: true }
}, { timestamps: true })

itemPlanSchema.index({ estacion: 1, anio: 1, equipo: 1 })

module.exports = mongoose.model('ItemPlan', itemPlanSchema)
