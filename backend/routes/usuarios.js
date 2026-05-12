const router  = require('express').Router()
const authMW  = require('../middleware/auth')
const Usuario = require('../models/Usuario')

function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  next()
}

// Listar usuarios (admin y supervisor)
router.get('/', authMW, async (req, res) => {
  try {
    const users = await Usuario.find().select('-password').sort({ nombre: 1 })
    res.json(users)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// Crear usuario (solo admin)
router.post('/', authMW, soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol, estaciones } = req.body
    const u = await Usuario.create({ nombre, email, password, rol, estaciones: estaciones || [] })
    res.status(201).json({ _id: u._id, nombre: u.nombre, email: u.email, rol: u.rol, estaciones: u.estaciones })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Editar usuario (solo admin)
router.put('/:id', authMW, soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol, estaciones, activo } = req.body
    const u = await Usuario.findById(req.params.id)
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' })
    if (nombre)     u.nombre     = nombre
    if (email)      u.email      = email
    if (password)   u.password   = password   // pre-save hook lo hashea
    if (rol)        u.rol        = rol
    if (estaciones) u.estaciones = estaciones
    if (activo !== undefined) u.activo = activo
    await u.save()
    res.json({ _id: u._id, nombre: u.nombre, email: u.email, rol: u.rol, estaciones: u.estaciones, activo: u.activo })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// Eliminar usuario (solo admin)
router.delete('/:id', authMW, soloAdmin, async (req, res) => {
  try {
    await Usuario.findByIdAndDelete(req.params.id)
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

module.exports = router
