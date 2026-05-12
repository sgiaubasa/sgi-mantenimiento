const mongoose = require('mongoose')
const { Schema } = mongoose

const RESPONSABLES = ['SUP','MAA','MAE','MAN','MVI','MED','ELE','JES','TG','PEX']
const PERIODICIDADES = ['diario','semanal','quincenal','mensual','trimestral','semestral','anual']

const itemPlanSchema = new Schema({
  estacion:          { type: String, required: true },
  anio:              { type: Number, required: true },
  equipo:            { type: String, required: true },   // 'Cabinas de Peaje'
  codigoPrefix:      { type: String },                   // 'CC' — para cruzar con inspecciones
  unidades:          [String],                           // ['CC 01','CC 02',...] códigos individuales
  tareas:            [String],                           // ['Puertas','Ventanas','Luminarias','Limpieza']
  responsable:       { type: String, enum: RESPONSABLES, required: true },
  proveedorExterno:  { type: String, default: null },
  periodicidad:      { type: String, enum: PERIODICIDADES, required: true },
  vigenciaDesde:     { type: Date, default: null },      // null = desde inicio del año
  vigenciaHasta:     { type: Date, default: null },      // null = aún vigente
  activo:            { type: Boolean, default: true }
}, { timestamps: true })

itemPlanSchema.index({ estacion: 1, anio: 1, equipo: 1 })

module.exports = mongoose.model('ItemPlan', itemPlanSchema)
