require("dotenv").config();
const { Pool } = require("pg");

// Railway (va boshqa ko'plab hostinglar) DATABASE_URL orqali ulanish manzilini beradi.
// Agar u mavjud bo'lsa, o'shani ishlatamiz (production); aks holda .env dagi
// alohida DB_USER/DB_PASSWORD/... o'zgaruvchilaridan foydalanamiz (lokal kompyuter).
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });

module.exports = pool;
