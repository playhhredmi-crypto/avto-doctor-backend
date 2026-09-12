-- ===== SUPER ADMIN (KO'P VILOYAT) =====
CREATE TABLE IF NOT EXISTS adminlar (
  id SERIAL PRIMARY KEY,
  login VARCHAR(50) UNIQUE NOT NULL,
  parol VARCHAR(100) NOT NULL,
  rol VARCHAR(20) NOT NULL DEFAULT 'viloyat',
  viloyat VARCHAR(100),
  yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Bosh admin (barcha viloyatlarni ko'radi) — parolni keyin o'zgartiring!
INSERT INTO adminlar (login, parol, rol, viloyat) VALUES ('superadmin', 'super123', 'super', NULL)
ON CONFLICT (login) DO NOTHING;

-- Namuna: Toshkent viloyat admini
INSERT INTO adminlar (login, parol, rol, viloyat) VALUES ('toshkent', 'admin123', 'viloyat', 'Toshkent')
ON CONFLICT (login) DO NOTHING;

ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS viloyat VARCHAR(100) DEFAULT 'Toshkent';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS viloyat VARCHAR(100) DEFAULT 'Toshkent';

-- ===== REYTING VA SHARHLAR =====
CREATE TABLE IF NOT EXISTS sharhlar (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  usta_id INTEGER NOT NULL REFERENCES ustalar(id),
  baho INTEGER NOT NULL,
  matn TEXT,
  yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ===== USTA 12 SOAT MAJBURIY FAOLLIK =====
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS bugungi_faol_soat NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS oxirgi_yoqilgan_vaqt TIMESTAMP;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS bugungi_ochirish_soni INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS hisoblanган_kun DATE DEFAULT CURRENT_DATE;

-- ===== MOYKACHI/PEREGONCHI KM-ASOSLI NARXLASH =====
ALTER TABLE xizmatlar ADD COLUMN IF NOT EXISTS narx_km NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS masofa_km NUMERIC(6,2);

UPDATE xizmatlar SET narx_km = 2000 WHERE kod = 'moyka';
UPDATE xizmatlar SET narx_km = 3000 WHERE kod = 'peregon';
