CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, telefon VARCHAR(20) UNIQUE NOT NULL, ism VARCHAR(100),
  til VARCHAR(2) DEFAULT 'uz', yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ustalar (
  id SERIAL PRIMARY KEY, telefon VARCHAR(20) UNIQUE NOT NULL, ism VARCHAR(100) NOT NULL,
  mutaxassislik VARCHAR(100), faol BOOLEAN NOT NULL DEFAULT false, bloklangan BOOLEAN NOT NULL DEFAULT false,
  balans NUMERIC(10,2) NOT NULL DEFAULT 0, jarima NUMERIC(10,2) NOT NULL DEFAULT 0,
  reyting NUMERIC(2,1) DEFAULT 5.0, til VARCHAR(2) DEFAULT 'uz', yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, xizmat_turi VARCHAR(100) NOT NULL, izoh TEXT,
  holati VARCHAR(20) NOT NULL DEFAULT 'kutilmoqda', user_id INTEGER REFERENCES users(id),
  usta_id INTEGER REFERENCES ustalar(id), narx NUMERIC(10,2), mijoz_narx NUMERIC(10,2),
  yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS narx_takliflari (
  id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), usta_id INTEGER NOT NULL REFERENCES ustalar(id),
  taklif_narx NUMERIC(10,2) NOT NULL, holati VARCHAR(20) NOT NULL DEFAULT 'kutilmoqda',
  yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS murojaatlar (
  id SERIAL PRIMARY KEY, kimdan VARCHAR(20) NOT NULL, matn TEXT NOT NULL,
  holati VARCHAR(20) NOT NULL DEFAULT 'ochiq', yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS xizmatlar (
  id SERIAL PRIMARY KEY, kod VARCHAR(50) UNIQUE NOT NULL, nom VARCHAR(100) NOT NULL,
  narx NUMERIC(10,2) NOT NULL, faol BOOLEAN NOT NULL DEFAULT true, savdolashish_yoqilgan BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO xizmatlar (kod, nom, narx) VALUES
('xodovoy','Xodovoy',150000),('motor','Motor',200000),('vulkanizatsiya','Vulkanizatsiya',50000),
('kuzov','Kuzov',180000),('bukser','Bukser qilish',250000),('benzin','Benzin',80000),
('elektrik','Elektrik ishi',100000),('moyka','Avto moyka',40000),('peregon','Avto peregon',120000),
('zaryadlash','Ochish / Zaryadlash',60000) ON CONFLICT (kod) DO NOTHING;

-- Profil tahrirlash uchun qo'shimcha ustunlar (agar mavjud bo'lmasa)
ALTER TABLE users ADD COLUMN IF NOT EXISTS rasm TEXT;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS rasm TEXT;

-- ===== SUPER ADMIN (ko'p viloyat) =====
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS viloyat VARCHAR(100) DEFAULT 'Toshkent';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS viloyat VARCHAR(100) DEFAULT 'Toshkent';

CREATE TABLE IF NOT EXISTS adminlar (
  id SERIAL PRIMARY KEY,
  login VARCHAR(50) UNIQUE NOT NULL,
  parol VARCHAR(100) NOT NULL,
  viloyat VARCHAR(100),
  super_admin BOOLEAN NOT NULL DEFAULT false,
  yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
INSERT INTO adminlar (login, parol, viloyat, super_admin)
VALUES ('super', 'admin123', NULL, true)
ON CONFLICT (login) DO NOTHING;

-- ===== REYTING VA SHARHLAR =====
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sharh TEXT;

-- ===== USTA 12 SOAT MAJBURIY FAOLLIK QOIDASI =====
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS faol_boshlanish_vaqti TIMESTAMP;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS bugun_faol_soniya INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS bugun_off_soni INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS oxirgi_reset_sana DATE;
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);
ALTER TABLE ustalar ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- ===== MOYKACHI/PEREGONCHI KM-ASOSLI NARXLASH =====
ALTER TABLE xizmatlar ADD COLUMN IF NOT EXISTS km_asosli BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE xizmatlar ADD COLUMN IF NOT EXISTS km_narxi NUMERIC(10,2);
UPDATE xizmatlar SET km_asosli = true, km_narxi = 3000 WHERE kod IN ('moyka', 'peregon');
ALTER TABLE orders ADD COLUMN IF NOT EXISTS km NUMERIC(6,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);

-- ===== PUL YECHISH SO'ROVLARI =====
CREATE TABLE IF NOT EXISTS pul_sorovlari (
  id SERIAL PRIMARY KEY,
  usta_id INTEGER NOT NULL REFERENCES ustalar(id),
  summa NUMERIC(10,2) NOT NULL,
  karta_raqami VARCHAR(30) NOT NULL,
  holati VARCHAR(20) NOT NULL DEFAULT 'kutilmoqda',
  yaratilgan_vaqt TIMESTAMP NOT NULL DEFAULT NOW()
);
