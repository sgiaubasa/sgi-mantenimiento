const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

const usuarioSchema = new mongoose.Schema({
  nombre:    { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  rol:       { type: String, enum: ['admin', 'supervisor', 'operador'], default: 'operador' },
  // Estaciones a las que tiene acceso (vacío = todas, para admin/supervisor)
  estaciones: [{ type: String }],
  activo:    { type: Boolean, default: true }
}, { timestamps: true })

// Hash password antes de guardar
usuarioSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 10)
  next()
})

usuarioSchema.methods.verificarPassword = function (plain) {
  return bcrypt.compare(plain, this.password)
}

module.exports = mongoose.model('Usuario', usuarioSchema)
