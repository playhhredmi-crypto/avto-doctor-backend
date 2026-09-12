# Bu papkadagi fayllar endi ishlatilmaydi

`yangi-migratsiya.sql` va `yangi_ozgarishlar.sql` fayllaridagi barcha o'zgarishlar
allaqachon asosiy `schema.sql` fayliga birlashtirilgan.

`yangi_ozgarishlar.sql` faylini ISHGA TUSHIRMANG — u backend kodi bilan mos
kelmaydigan eski, tashlab yuborilgan versiya (masalan, `adminlar` jadvalini
boshqacha ustunlar bilan yaratadi va bitta ustun nomida xato bor edi).

Endilikda faqat `schema.sql`ni ishga tushirish kifoya.
