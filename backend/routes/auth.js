const router   = require('express').Router()
const jwt      = require('jsonwebtoken')
const Usuario  = require('../models/Usuario')
const authMW   = require('../middleware/auth')

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })

  const usuario = await Usuario.findOne({ email, activo: true })
  if (!usuario) return res.status(401).json({ error: 'Credenciales incorrectas' })

  const ok = await usuario.verificarPassword(password)
  if (!ok)  return res.status(401).json({ error: 'Credenciales incorrectas' })

  const token = jwt.sign(
    { _id: usuario._id, nombre: usuario.nombre, rol: usuario.rol, estaciones: usuario.estaciones },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  )

  res.json({ token, usuario: { _id: usuario._id, nombre: usuario.nombre, rol: usuario.rol, estaciones: usuario.estaciones } })
})

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authMW, (req, res) => res.json(req.usuario))

module.exports = router
