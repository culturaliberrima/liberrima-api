-- Libérrima Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(500) NOT NULL,
  fecha DATE,
  "fechaFin" DATE,
  hora VARCHAR(20),
  "horaFin" VARCHAR(20),
  lugar VARCHAR(500),
  "lugarId" VARCHAR(100),
  recurrente VARCHAR(100),
  costo VARCHAR(200),
  "costoGratuito" BOOLEAN DEFAULT false,
  descripcion TEXT,
  boletos TEXT,
  organizador VARCHAR(500),
  publicacion DATE,
  contacto VARCHAR(500),
  "contactoTipo" VARCHAR(100),
  estado VARCHAR(100) DEFAULT 'Colima',
  ciudad VARCHAR(100) DEFAULT 'Colima',
  destacado BOOLEAN DEFAULT false,
  categorias JSONB DEFAULT '[]',
  artistas JSONB DEFAULT '[]',
  cuentas JSONB DEFAULT '[]',
  clasificacion VARCHAR(100) DEFAULT 'toda la familia',
  tipo VARCHAR(50) DEFAULT 'evento',
  imagen TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Default category emojis
INSERT INTO settings (key, value) VALUES (
  'category-emojis',
  '{
    "Música": "🎵",
    "Teatro": "🎭",
    "Danza": "💃",
    "Arte Visual": "🎨",
    "Cine": "🎬",
    "Literatura": "📚",
    "Conferencia": "🎤",
    "Taller": "🛠️",
    "Festival": "🎉",
    "Exposición": "🖼️",
    "Infantil": "👶",
    "Gastronomía": "🍽️"
  }'
) ON CONFLICT (key) DO NOTHING;
