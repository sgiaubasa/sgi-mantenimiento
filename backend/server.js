const express  = require('express')
const mongoose = require('mongoose')
const cors     = require('cors')
const path     = require('path')
require('dotenv').config()

const app = express()
app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB conectado')
    await crearAdminInicial()
  })
  .catch(err => console.error('Error MongoDB:', err))

async function crearAdminInicial() {
  try {
    const Usuario = require('./models/Usuario')
    const existe  = await Usuario.findOne({ email: 'admin@aubasa.com' })
    if (!existe) {
      await Usuario.create({
        nombre:     'Administrador',
        email:      'admin@aubasa.com',
        password:   'aubasa2024',
        rol:        'admin',
        estaciones: []
      })
      console.log('✓ Admin creado: admin@aubasa.com / aubasa2024')
    }
  } catch (e) {
    console.error('Error creando admin:', e.message)
  }
}

app.use('/api/auth',         require('./routes/auth'))
app.use('/api/usuarios',     require('./routes/usuarios'))
app.use('/api/inspecciones', require('./routes/inspecciones'))
app.use('/api/desvios',      require('./routes/desvios'))
app.use('/api/plan',         require('./routes/plan'))

// Sirve el frontend (un nivel arriba de /backend)
const frontendPath = path.join(__dirname, '..')
app.use(express.static(frontendPath))
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'))
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => console.log(`SGI corriendo en http://localhost:${PORT}`))
