const express = require("express");
const cors = require("cors");
const pool = require("./db");
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Firebase Admin — push-xabar (bildirishnoma) yuborish uchun. Agar sozlanmagan bo'lsa,
// tizim buni jimgina o'tkazib yuboradi (push ishlamaydi, lekin qolgan hammasi ishlaydi).
let firebaseAdmin = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseAdmin = admin;
    console.log("Firebase Admin ulandi — push-xabarlar yoqilgan ✅");
  } catch (err) {
    console.error("Firebase Admin sozlashda xato:", err.message);
  }
}

async function pushYuborish(token, sarlavha, matn, malumot) {
  if (!firebaseAdmin || !token) return;
  try {
    await firebaseAdmin.messaging().send({
      token,
      notification: { title: sarlavha, body: matn },
      data: malumot || {},
      android: { priority: "high" },
    });
  } catch (err) {
    console.error("Push yuborishda xato:", err.message);
  }
}

app.get("/", (req, res) => res.send("Avto Doctor backend ishlayapti ✅ (PostgreSQL bilan ulangan)"));

app.post("/orders", async (req, res) => {
  const { telefon, xizmatTuri, izoh, narx, lat, lng, km, viloyat } = req.body;
  if (!telefon || !xizmatTuri) return res.status(400).json({ xato: "telefon va xizmatTuri kiritilishi shart" });
  try {
    let mijoz = await pool.query("SELECT * FROM users WHERE telefon = $1", [telefon]);
    if (mijoz.rows.length === 0) mijoz = await pool.query("INSERT INTO users (telefon) VALUES ($1) RETURNING *", [telefon]);
    const userId = mijoz.rows[0].id;
    const xm = await pool.query("SELECT narx, km_asosli, km_narxi FROM xizmatlar WHERE kod = $1", [xizmatTuri]);
    let yakuniyNarx = narx;
    if (!yakuniyNarx) {
      if (xm.rows.length > 0 && xm.rows[0].km_asosli && km && xm.rows[0].km_narxi) {
        yakuniyNarx = Number(xm.rows[0].km_narxi) * Number(km);
      } else {
        yakuniyNarx = xm.rows.length > 0 ? xm.rows[0].narx : 100000;
      }
    }
    const natija = await pool.query(
      `INSERT INTO orders (xizmat_turi, izoh, holati, user_id, narx, mijoz_narx, lat, lng, km, viloyat) VALUES ($1, $2, 'kutilmoqda', $3, $4, $4, $5, $6, $7, $8) RETURNING *`,
      [xizmatTuri, izoh || "", userId, yakuniyNarx, lat || null, lng || null, km || null, viloyat || "Toshkent"]
    );
    const yaratilganBuyurtma = natija.rows[0];

    // Shu viloyatdagi faol (liniyadagi) ustalarga push-xabar yuboramiz
    if (firebaseAdmin) {
      pool.query(
        "SELECT fcm_token FROM ustalar WHERE faol = true AND bloklangan = false AND viloyat = $1 AND fcm_token IS NOT NULL",
        [yaratilganBuyurtma.viloyat]
      ).then(ustalarNatija => {
        ustalarNatija.rows.forEach(u => {
          pushYuborish(u.fcm_token, "Yangi buyurtma!", `${xizmatTuri} — ${izoh || ''}`.trim(), {
            turi: "yangi_buyurtma",
            orderId: String(yaratilganBuyurtma.id),
          });
        });
      }).catch(err => console.error("Push uchun ustalarni olishda xato:", err.message));
    }

    res.status(201).json(yaratilganBuyurtma);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi: buyurtma yaratilmadi" }); }
});

app.get("/orders", async (req, res) => {
  const { viloyat } = req.query;
  try {
    const natija = viloyat
      ? await pool.query(`
          SELECT orders.*, users.telefon AS mijoz_telefon, users.ism AS mijoz_ism, ustalar.ism AS usta_ism, ustalar.telefon AS usta_telefon
          FROM orders LEFT JOIN users ON orders.user_id = users.id LEFT JOIN ustalar ON orders.usta_id = ustalar.id
          WHERE orders.viloyat = $1
          ORDER BY orders.yaratilgan_vaqt DESC`, [viloyat])
      : await pool.query(`
          SELECT orders.*, users.telefon AS mijoz_telefon, users.ism AS mijoz_ism, ustalar.ism AS usta_ism, ustalar.telefon AS usta_telefon
          FROM orders LEFT JOIN users ON orders.user_id = users.id LEFT JOIN ustalar ON orders.usta_id = ustalar.id
          ORDER BY orders.yaratilgan_vaqt DESC`);
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi: buyurtmalar olinmadi" }); }
});

app.get("/mijoz/:telefon/orders", async (req, res) => {
  try {
    const mijoz = await pool.query("SELECT * FROM users WHERE telefon = $1", [req.params.telefon]);
    if (mijoz.rows.length === 0) return res.status(404).json({ xato: "Bunday mijoz topilmadi" });
    const natija = await pool.query(
      `SELECT orders.*, ustalar.ism AS usta_ism, ustalar.telefon AS usta_telefon
       FROM orders LEFT JOIN ustalar ON orders.usta_id = ustalar.id
       WHERE orders.user_id = $1 ORDER BY orders.yaratilgan_vaqt DESC`,
      [mijoz.rows[0].id]
    );
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/orders/:id/qabul-qilish", async (req, res) => {
  const { ustaId } = req.body;
  if (!ustaId) return res.status(400).json({ xato: "ustaId kiritilishi shart" });
  try {
    const b = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (b.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    if (b.rows[0].holati !== "kutilmoqda") return res.status(400).json({ xato: "Bu buyurtma allaqachon qabul qilingan yoki bajarilgan" });
    const natija = await pool.query("UPDATE orders SET usta_id = $1, holati = 'yolda' WHERE id = $2 RETURNING *", [ustaId, req.params.id]);
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/orders/:id/bajarildi", async (req, res) => {
  try {
    const b = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (b.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    const order = b.rows[0];
    if (order.holati !== "yolda") return res.status(400).json({ xato: "Bu buyurtma hali qabul qilinmagan yoki allaqachon bajarilgan" });
    const natija = await pool.query("UPDATE orders SET holati = 'bajarildi' WHERE id = $1 RETURNING *", [req.params.id]);
    if (order.narx && order.usta_id) await pool.query("UPDATE ustalar SET balans = balans + $1 WHERE id = $2", [order.narx * 0.81, order.usta_id]);
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/orders/:id/bekor-qilish", async (req, res) => {
  try {
    const b = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (b.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    if (b.rows[0].holati === "bajarildi") return res.status(400).json({ xato: "Bajarilgan buyurtmani bekor qilib bo'lmaydi" });
    const natija = await pool.query("UPDATE orders SET holati = 'bekor_qilindi' WHERE id = $1 RETURNING *", [req.params.id]);
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/orders/:id/baho", async (req, res) => {
  const { baho, sharh } = req.body;
  if (!baho || baho < 1 || baho > 5) return res.status(400).json({ xato: "baho 1 dan 5 gacha bo'lishi kerak" });
  try {
    const b = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (b.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    const order = b.rows[0];
    if (order.holati !== "bajarildi") return res.status(400).json({ xato: "Faqat bajarilgan buyurtmaga baho berish mumkin" });
    if (!order.usta_id) return res.status(400).json({ xato: "Bu buyurtmaga usta biriktirilmagan" });
    const usta = await pool.query("SELECT reyting FROM ustalar WHERE id = $1", [order.usta_id]);
    const yangiReyting = ((parseFloat(usta.rows[0].reyting) + baho) / 2).toFixed(1);
    await pool.query("UPDATE ustalar SET reyting = $1 WHERE id = $2", [yangiReyting, order.usta_id]);
    await pool.query("UPDATE orders SET sharh = $1 WHERE id = $2", [sharh || null, req.params.id]);
    res.json({ xabar: "Baho qabul qilindi", yangiReyting });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/orders/:id/taklif", async (req, res) => {
  const { ustaId, taklifNarx } = req.body;
  if (!ustaId || !taklifNarx) return res.status(400).json({ xato: "ustaId va taklifNarx kiritilishi shart" });
  try {
    const b = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
    if (b.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    if (b.rows[0].holati !== "kutilmoqda") return res.status(400).json({ xato: "Bu buyurtma allaqachon qabul qilingan yoki bajarilgan" });
    const mavjud = await pool.query("SELECT * FROM narx_takliflari WHERE order_id = $1 AND usta_id = $2", [req.params.id, ustaId]);
    if (mavjud.rows.length > 0) {
      const y = await pool.query("UPDATE narx_takliflari SET taklif_narx = $1, holati = 'kutilmoqda' WHERE order_id = $2 AND usta_id = $3 RETURNING *", [taklifNarx, req.params.id, ustaId]);
      return res.json(y.rows[0]);
    }
    const natija = await pool.query("INSERT INTO narx_takliflari (order_id, usta_id, taklif_narx) VALUES ($1, $2, $3) RETURNING *", [req.params.id, ustaId, taklifNarx]);
    res.status(201).json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Bitta buyurtmaning to'liq holatini olish — mijoz tomonida "usta topildimi" ni tekshirish uchun
// (bevosita "Qabul qilish" orqali tayinlangan bo'lsa ham, narx taklif orqali bo'lsa ham ishlaydi)
app.get("/orders/:id", async (req, res) => {
  try {
    const natija = await pool.query(
      `SELECT orders.*, ustalar.ism AS usta_ism, ustalar.telefon AS usta_telefon, ustalar.reyting AS usta_reyting,
              ustalar.lat AS usta_lat, ustalar.lng AS usta_lng, users.telefon AS mijoz_telefon, users.ism AS mijoz_ism
       FROM orders LEFT JOIN ustalar ON orders.usta_id = ustalar.id LEFT JOIN users ON orders.user_id = users.id
       WHERE orders.id = $1`,
      [req.params.id]
    );
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/orders/:id/takliflar", async (req, res) => {
  try {
    const natija = await pool.query(
      `SELECT narx_takliflari.*, ustalar.ism AS usta_ism, ustalar.reyting AS usta_reyting
       FROM narx_takliflari JOIN ustalar ON narx_takliflari.usta_id = ustalar.id
       WHERE order_id = $1 AND narx_takliflari.holati = 'kutilmoqda' ORDER BY taklif_narx ASC`,
      [req.params.id]);
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/orders/:id/taklif-tanlash", async (req, res) => {
  const { taklifId } = req.body;
  if (!taklifId) return res.status(400).json({ xato: "taklifId kiritilishi shart" });
  try {
    const taklif = await pool.query("SELECT * FROM narx_takliflari WHERE id = $1", [taklifId]);
    if (taklif.rows.length === 0) return res.status(404).json({ xato: "Bunday taklif topilmadi" });
    const { usta_id, taklif_narx } = taklif.rows[0];
    const natija = await pool.query("UPDATE orders SET usta_id = $1, narx = $2, holati = 'yolda' WHERE id = $3 RETURNING *", [usta_id, taklif_narx, req.params.id]);
    const um = await pool.query("SELECT ism FROM ustalar WHERE id = $1", [usta_id]);
    res.json({ ...natija.rows[0], usta_ism: um.rows[0].ism });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/takliflar/:id/rad-etish", async (req, res) => {
  try {
    const natija = await pool.query("UPDATE narx_takliflari SET holati = 'rad_etildi' WHERE id = $1 RETURNING *", [req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday taklif topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/auth", async (req, res) => {
  const { telefon, ism, til } = req.body;
  if (!telefon) return res.status(400).json({ xato: "telefon kiritilishi shart" });
  try {
    const mavjud = await pool.query("SELECT * FROM users WHERE telefon = $1", [telefon]);
    if (mavjud.rows.length > 0) return res.json({ xabar: "Kirish muvaffaqiyatli", user: mavjud.rows[0] });
    const yangi = await pool.query("INSERT INTO users (telefon, ism, til) VALUES ($1, $2, $3) RETURNING *", [telefon, ism || null, til || "uz"]);
    res.status(201).json({ xabar: "Ro'yxatdan o'tish muvaffaqiyatli", user: yangi.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Mijoz o'z profilini tahrirlaydi (ism, rasm)
app.patch("/users/:id", async (req, res) => {
  const { ism, rasm, kartaRaqami } = req.body;
  try {
    const natija = await pool.query(
      "UPDATE users SET ism = COALESCE($1, ism), rasm = COALESCE($2, rasm), karta_raqami = COALESCE($3, karta_raqami) WHERE id = $4 RETURNING *",
      [ism, rasm, kartaRaqami, req.params.id]
    );
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday mijoz topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Global sozlamalar — naqt/karta to'lov turlarini yoqish/o'chirish (admin boshqaradi)
app.get("/sozlamalar", async (req, res) => {
  try {
    const natija = await pool.query("SELECT naqt_yoqilgan, karta_yoqilgan FROM sozlamalar WHERE id = 1");
    res.json(natija.rows[0] || { naqt_yoqilgan: true, karta_yoqilgan: true });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/sozlamalar", async (req, res) => {
  const { naqtYoqilgan, kartaYoqilgan } = req.body;
  try {
    const natija = await pool.query(
      "UPDATE sozlamalar SET naqt_yoqilgan = COALESCE($1, naqt_yoqilgan), karta_yoqilgan = COALESCE($2, karta_yoqilgan) WHERE id = 1 RETURNING *",
      [naqtYoqilgan, kartaYoqilgan]
    );
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Buyurtma uchun tanlangan to'lov turini saqlash
app.patch("/orders/:id/tolov-turi", async (req, res) => {
  const { tolovTuri } = req.body;
  if (!["naqt", "karta"].includes(tolovTuri)) return res.status(400).json({ xato: "tolovTuri noto'g'ri" });
  try {
    const natija = await pool.query("UPDATE orders SET tolov_turi = $1 WHERE id = $2 RETURNING *", [tolovTuri, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday buyurtma topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/ustalar", async (req, res) => {
  const { telefon, ism, mutaxassislik, til, viloyat } = req.body;
  if (!telefon || !ism) return res.status(400).json({ xato: "telefon va ism kiritilishi shart" });
  try {
    const natija = await pool.query("INSERT INTO ustalar (telefon, ism, mutaxassislik, til, viloyat) VALUES ($1, $2, $3, $4, $5) RETURNING *", [telefon, ism, mutaxassislik || null, til || "uz", viloyat || null]);
    res.status(201).json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi: usta qo'shilmadi" }); }
});

app.get("/ustalar", async (req, res) => {
  const { viloyat } = req.query;
  try {
    const natija = viloyat
      ? await pool.query("SELECT * FROM ustalar WHERE viloyat = $1 ORDER BY yaratilgan_vaqt DESC", [viloyat])
      : await pool.query("SELECT * FROM ustalar ORDER BY yaratilgan_vaqt DESC");
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi: ustalar olinmadi" }); }
});

// Usta o'z jonli koordinatasini yangilaydi
app.patch("/ustalar/:id/lokatsiya", async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ xato: "lat va lng kiritilishi shart" });
  try {
    const natija = await pool.query("UPDATE ustalar SET lat = $1, lng = $2 WHERE id = $3 RETURNING *", [lat, lng, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Admin: faol ustalarning barcha joriy koordinatalarini olish (jonli xarita uchun)
app.get("/ustalar/joriy-lokatsiyalar", async (req, res) => {
  const { viloyat } = req.query;
  try {
    const natija = viloyat
      ? await pool.query(
          "SELECT id, ism, telefon, lat, lng, faol, viloyat FROM ustalar WHERE faol = true AND lat IS NOT NULL AND lng IS NOT NULL AND viloyat = $1",
          [viloyat]
        )
      : await pool.query(
          "SELECT id, ism, telefon, lat, lng, faol, viloyat FROM ustalar WHERE faol = true AND lat IS NOT NULL AND lng IS NOT NULL"
        );
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/ustalar/:id/faol", async (req, res) => {
  const { faol } = req.body;
  if (typeof faol !== "boolean") return res.status(400).json({ xato: "faol true yoki false bo'lishi kerak" });
  try {
    const natija = await pool.query("UPDATE ustalar SET faol = $1 WHERE id = $2 RETURNING *", [faol, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Usta o'z profilini tahrirlaydi (ism, mutaxassislik, rasm)
app.patch("/ustalar/:id/profil", async (req, res) => {
  const { ism, mutaxassislik, rasm } = req.body;
  try {
    const natija = await pool.query(
      "UPDATE ustalar SET ism = COALESCE($1, ism), mutaxassislik = COALESCE($2, mutaxassislik), rasm = COALESCE($3, rasm) WHERE id = $4 RETURNING *",
      [ism, mutaxassislik, rasm, req.params.id]
    );
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/ustalar/:id/til", async (req, res) => {
  const { til } = req.body;
  if (til !== "uz" && til !== "ru") return res.status(400).json({ xato: "til 'uz' yoki 'ru' bo'lishi kerak" });
  try {
    const natija = await pool.query("UPDATE ustalar SET til = $1 WHERE id = $2 RETURNING *", [til, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/ustalar/:id/blok", async (req, res) => {
  const { bloklangan } = req.body;
  try {
    const natija = await pool.query("UPDATE ustalar SET bloklangan = $1, faol = CASE WHEN $1 = true THEN false ELSE faol END WHERE id = $2 RETURNING *", [bloklangan, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/ustalar/:id/jarima", async (req, res) => {
  const { summa } = req.body;
  if (!summa || summa <= 0) return res.status(400).json({ xato: "summa musbat son bo'lishi kerak" });
  try {
    const natija = await pool.query("UPDATE ustalar SET jarima = jarima + $1, balans = balans - $1 WHERE id = $2 RETURNING *", [summa, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Usta pul yechish so'rovi yuboradi (karta raqami bilan)
app.post("/ustalar/:id/pul-sorov", async (req, res) => {
  const { kartaRaqami } = req.body;
  if (!kartaRaqami) return res.status(400).json({ xato: "kartaRaqami kiritilishi shart" });
  try {
    const usta = await pool.query("SELECT balans FROM ustalar WHERE id = $1", [req.params.id]);
    if (usta.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    const summa = usta.rows[0].balans;
    if (Number(summa) <= 0) return res.status(400).json({ xato: "Balansingiz 0, yechish uchun mablag' yo'q" });
    const natija = await pool.query(
      "INSERT INTO pul_sorovlari (usta_id, summa, karta_raqami) VALUES ($1, $2, $3) RETURNING *",
      [req.params.id, summa, kartaRaqami]
    );
    res.status(201).json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Admin: barcha pul yechish so'rovlarini ko'rish
app.get("/pul-sorovlari", async (req, res) => {
  try {
    const natija = await pool.query(
      `SELECT pul_sorovlari.*, ustalar.ism AS usta_ism, ustalar.telefon AS usta_telefon
       FROM pul_sorovlari JOIN ustalar ON pul_sorovlari.usta_id = ustalar.id
       ORDER BY pul_sorovlari.yaratilgan_vaqt DESC`
    );
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Admin: pul yechish so'rovini to'landi deb belgilaydi (balansni kamaytiradi)
app.patch("/pul-sorovlari/:id/tolandi", async (req, res) => {
  try {
    const sorov = await pool.query("SELECT * FROM pul_sorovlari WHERE id = $1", [req.params.id]);
    if (sorov.rows.length === 0) return res.status(404).json({ xato: "Bunday so'rov topilmadi" });
    if (sorov.rows[0].holati === "tolandi") return res.status(400).json({ xato: "Bu so'rov allaqachon to'langan" });

    await pool.query("UPDATE ustalar SET balans = balans - $1 WHERE id = $2", [sorov.rows[0].summa, sorov.rows[0].usta_id]);
    const natija = await pool.query("UPDATE pul_sorovlari SET holati = 'tolandi' WHERE id = $1 RETURNING *", [req.params.id]);
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/ustalar/:id/tolov", async (req, res) => {
  try {
    const natija = await pool.query("UPDATE ustalar SET balans = 0 WHERE id = $1 RETURNING *", [req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json({ xabar: "To'lov amalga oshirildi", usta: natija.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Ustaning joriy holatini (faol/band, bloklangan va h.k.) olish — sahifa qayta ochilganda holatni tiklash uchun
app.get("/ustalar/:id/holat", async (req, res) => {
  try {
    const natija = await pool.query("SELECT id, faol, bloklangan, viloyat FROM ustalar WHERE id = $1", [req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday usta topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// Usta telefonining push-xabar tokenini saqlash (ekran o'chiq/fon holatida ham bildirishnoma kelishi uchun)
app.patch("/ustalar/:id/fcm-token", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ xato: "token kiritilishi shart" });
  try {
    await pool.query("UPDATE ustalar SET fcm_token = $1 WHERE id = $2", [token, req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/ustalar/mavjud-buyurtmalar", async (req, res) => {
  const { viloyat } = req.query;
  try {
    const natija = viloyat
      ? await pool.query("SELECT * FROM orders WHERE holati = 'kutilmoqda' AND viloyat = $1 ORDER BY yaratilgan_vaqt ASC", [viloyat])
      : await pool.query("SELECT * FROM orders WHERE holati = 'kutilmoqda' ORDER BY yaratilgan_vaqt ASC");
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/ustalar/:id/faol-buyurtma", async (req, res) => {
  try {
    const natija = await pool.query("SELECT * FROM orders WHERE usta_id = $1 AND holati = 'yolda' ORDER BY yaratilgan_vaqt DESC LIMIT 1", [req.params.id]);
    res.json(natija.rows[0] || null);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/ustalar/:id/statistika", async (req, res) => {
  try {
    const natija = await pool.query(
      `SELECT sana::date AS kun, COALESCE(stat.buyurtmalar_soni, 0) AS buyurtmalar_soni, COALESCE(stat.topilgan_pul, 0) AS topilgan_pul
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS sana
      LEFT JOIN (
        SELECT DATE(yaratilgan_vaqt) AS kun, COUNT(*) AS buyurtmalar_soni, SUM(narx * 0.81) AS topilgan_pul
        FROM orders WHERE usta_id = $1 AND holati = 'bajarildi' AND yaratilgan_vaqt >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(yaratilgan_vaqt)
      ) AS stat ON sana::date = stat.kun ORDER BY sana ASC`, [req.params.id]);
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/mijozlar", async (req, res) => {
  try {
    const natija = await pool.query("SELECT * FROM users ORDER BY yaratilgan_vaqt DESC");
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi: mijozlar olinmadi" }); }
});

app.get("/statistika/umumiy", async (req, res) => {
  const { viloyat } = req.query;
  try {
    let a, b, c, d, e, f;
    if (viloyat) {
      a = await pool.query("SELECT COUNT(*) FROM users");
      b = await pool.query("SELECT COUNT(*) FROM ustalar WHERE viloyat = $1", [viloyat]);
      c = await pool.query("SELECT COUNT(*) FROM ustalar WHERE faol = true AND viloyat = $1", [viloyat]);
      d = await pool.query("SELECT COUNT(*) FROM orders WHERE viloyat = $1", [viloyat]);
      e = await pool.query("SELECT COUNT(*) FROM orders WHERE holati = 'bajarildi' AND viloyat = $1", [viloyat]);
      f = await pool.query("SELECT COALESCE(SUM(narx), 0) AS jami FROM orders WHERE holati = 'bajarildi' AND viloyat = $1", [viloyat]);
    } else {
      a = await pool.query("SELECT COUNT(*) FROM users");
      b = await pool.query("SELECT COUNT(*) FROM ustalar");
      c = await pool.query("SELECT COUNT(*) FROM ustalar WHERE faol = true");
      d = await pool.query("SELECT COUNT(*) FROM orders");
      e = await pool.query("SELECT COUNT(*) FROM orders WHERE holati = 'bajarildi'");
      f = await pool.query("SELECT COALESCE(SUM(narx), 0) AS jami FROM orders WHERE holati = 'bajarildi'");
    }
    res.json({
      mijozlarSoni: parseInt(a.rows[0].count), ustalarSoni: parseInt(b.rows[0].count),
      faolUstalarSoni: parseInt(c.rows[0].count), buyurtmalarSoni: parseInt(d.rows[0].count),
      bajarilganSoni: parseInt(e.rows[0].count), umumiyDaromad: parseFloat(f.rows[0].jami),
    });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/murojaatlar", async (req, res) => {
  const { kimdan, matn } = req.body;
  if (!kimdan || !matn) return res.status(400).json({ xato: "kimdan va matn kiritilishi shart" });
  try {
    const natija = await pool.query("INSERT INTO murojaatlar (kimdan, matn) VALUES ($1, $2) RETURNING *", [kimdan, matn]);
    res.status(201).json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/murojaatlar", async (req, res) => {
  try {
    const natija = await pool.query("SELECT * FROM murojaatlar ORDER BY yaratilgan_vaqt DESC");
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/xizmatlar", async (req, res) => {
  try {
    const natija = await pool.query("SELECT * FROM xizmatlar ORDER BY id ASC");
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/xizmatlar/:id/narx", async (req, res) => {
  const { narx } = req.body;
  if (!narx || narx <= 0) return res.status(400).json({ xato: "narx musbat son bo'lishi kerak" });
  try {
    const natija = await pool.query("UPDATE xizmatlar SET narx = $1 WHERE id = $2 RETURNING *", [narx, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday xizmat topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.patch("/xizmatlar/:id/faol", async (req, res) => {
  const { faol } = req.body;
  try {
    const natija = await pool.query("UPDATE xizmatlar SET faol = $1 WHERE id = $2 RETURNING *", [faol, req.params.id]);
    if (natija.rows.length === 0) return res.status(404).json({ xato: "Bunday xizmat topilmadi" });
    res.json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// ===== SUPER ADMIN (ko'p viloyat) =====

app.post("/admin/login", async (req, res) => {
  const { login, parol } = req.body;
  try {
    const natija = await pool.query("SELECT * FROM adminlar WHERE login = $1 AND parol = $2", [login, parol]);
    if (natija.rows.length === 0) return res.status(401).json({ xato: "Login yoki parol noto'g'ri" });
    const admin = natija.rows[0];
    res.json({ id: admin.id, login: admin.login, viloyat: admin.viloyat, superAdmin: admin.super_admin });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/adminlar", async (req, res) => {
  try {
    const natija = await pool.query("SELECT id, login, viloyat, super_admin, yaratilgan_vaqt FROM adminlar ORDER BY id ASC");
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.post("/adminlar", async (req, res) => {
  const { login, parol, viloyat } = req.body;
  if (!login || !parol || !viloyat) return res.status(400).json({ xato: "login, parol va viloyat kiritilishi shart" });
  try {
    const natija = await pool.query(
      "INSERT INTO adminlar (login, parol, viloyat, super_admin) VALUES ($1, $2, $3, false) RETURNING id, login, viloyat, super_admin",
      [login, parol, viloyat]
    );
    res.status(201).json(natija.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Bu login band bo'lishi mumkin" }); }
});

app.get("/viloyatlar", async (req, res) => {
  try {
    const natija = await pool.query("SELECT DISTINCT viloyat FROM ustalar WHERE viloyat IS NOT NULL ORDER BY viloyat ASC");
    res.json(natija.rows.map(r => r.viloyat));
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// ===== REYTING VA SHARHLAR =====

app.get("/sharhlar", async (req, res) => {
  try {
    const natija = await pool.query(
      `SELECT orders.id, orders.sharh, orders.xizmat_turi, orders.yaratilgan_vaqt,
              ustalar.ism AS usta_ism, users.telefon AS mijoz_telefon
       FROM orders
       JOIN ustalar ON orders.usta_id = ustalar.id
       LEFT JOIN users ON orders.user_id = users.id
       WHERE orders.sharh IS NOT NULL AND orders.sharh != ''
       ORDER BY orders.yaratilgan_vaqt DESC`
    );
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

app.get("/ustalar/:id/sharhlar", async (req, res) => {
  try {
    const natija = await pool.query(
      `SELECT id, sharh, xizmat_turi, yaratilgan_vaqt FROM orders
       WHERE usta_id = $1 AND sharh IS NOT NULL AND sharh != ''
       ORDER BY yaratilgan_vaqt DESC LIMIT 10`,
      [req.params.id]
    );
    res.json(natija.rows);
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});

// ===== USTA 12 SOAT MAJBURIY FAOLLIK QOIDASI =====

async function faollikniTekshirish(ustaId) {
  const bugun = new Date().toISOString().slice(0, 10);
  const usta = await pool.query("SELECT * FROM ustalar WHERE id = $1", [ustaId]);
  if (usta.rows.length === 0) return null;
  const u = usta.rows[0];
  const oxirgiSana = u.oxirgi_reset_sana ? new Date(u.oxirgi_reset_sana).toISOString().slice(0, 10) : null;
  if (oxirgiSana !== bugun) {
    await pool.query(
      "UPDATE ustalar SET bugun_faol_soniya = 0, bugun_off_soni = 0, oxirgi_reset_sana = $1 WHERE id = $2",
      [bugun, ustaId]
    );
    u.bugun_faol_soniya = 0;
    u.bugun_off_soni = 0;
  }
  return u;
}

app.patch("/ustalar/:id/faol-toggle", async (req, res) => {
  const { faol } = req.body;
  try {
    const u = await faollikniTekshirish(req.params.id);
    if (!u) return res.status(404).json({ xato: "Bunday usta topilmadi" });

    if (faol) {
      await pool.query("UPDATE ustalar SET faol = true, faol_boshlanish_vaqti = NOW() WHERE id = $1", [req.params.id]);
      return res.json({ xabar: "Faol qilindi" });
    }

    // O'chirishga urinish
    let qoshimchaSoniya = 0;
    if (u.faol_boshlanish_vaqti) {
      qoshimchaSoniya = Math.floor((Date.now() - new Date(u.faol_boshlanish_vaqti).getTime()) / 1000);
    }
    const yangiSoniya = u.bugun_faol_soniya + qoshimchaSoniya;
    const YETARLI_SONIYA = 12 * 3600;

    if (u.bugun_off_soni >= 3 && yangiSoniya < YETARLI_SONIYA) {
      const qolganSoat = ((YETARLI_SONIYA - yangiSoniya) / 3600).toFixed(1);
      return res.status(400).json({
        xato: `Bugun kamida 12 soat faol bo'lishingiz kerak. Yana ${qolganSoat} soat faol turishingiz kerak (3 martadan ortiq o'chirib bo'lmaydi).`
      });
    }

    await pool.query(
      "UPDATE ustalar SET faol = false, faol_boshlanish_vaqti = NULL, bugun_faol_soniya = $1, bugun_off_soni = bugun_off_soni + 1 WHERE id = $2",
      [yangiSoniya, req.params.id]
    );
    res.json({ xabar: "Nofaol qilindi" });
  } catch (err) { console.error(err); res.status(500).json({ xato: "Server xatosi" }); }
});


app.listen(PORT, () => console.log(`Server ishga tushdi: http://localhost:${PORT}`));
