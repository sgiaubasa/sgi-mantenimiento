const express  = require('express')
const mongoose = require('mongoose')
const cors     = require('cors')
const path     = require('path')
require('dotenv').config()

const app = express()

app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err))

app.use('/api/inspecciones', require('./routes/inspecciones'))
app.use('/api/desvios',      require('./routes/desvios'))

// Sirve el frontend (carpeta raiz, un nivel arriba de /backend)
const frontendPath = path.join(__dirname, '..')
app.use(express.static(frontendPath))
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'))
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => console.log(`SGI corriendo en http://localhost:${PORT}`))
