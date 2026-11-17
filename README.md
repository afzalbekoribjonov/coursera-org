# learn (portfolio clone) — sertifikat tasdiqlash sayti + Telegram bot

Bitta Node.js jarayoni ichida ishlaydi:

- **Backend + frontend**: Express + EJS (`/share/<id>` tasdiqlash sahifasi, `/certificate/<id>` chop etiladigan sertifikat)
- **Telegram bot**: Telegraf. Render'da webhook, lokalda polling rejimida.
- **Baza**: MongoDB (Mongoose)

## Ishlash tartibi

1. Botga o'quvchining ism-familiyasi yuboriladi: `ILHOMJONOVA MUBINAXON HUSNIDDIN QIZI`
2. Kurs tugma orqali tanlanadi.
3. Bot avtomatik yaratadi va MongoDB'ga saqlaydi:
   - demo email: `ilhomjonova.mubinaxon586@gmail.com` (haqiqiy pochta emas)
   - parol (bazada bcrypt hash ko'rinishida saqlanadi)
   - 12 belgili tasdiqlash kodi va link: `https://<domen>/share/<32-belgili-id>`
4. Link ochilganda tasdiqlash sahifasi va sertifikat ko'rsatiladi.

Bot buyruqlari: `/start`, `/new`, `/list`, `/find ism`, `/delete KOD`

## Yo'llar

| Yo'l | Vazifasi |
|---|---|
| `/` | Kod yoki link bo'yicha tekshirish formasi |
| `/share/:shareId` | Tasdiqlash sahifasi |
| `/verify/:code` | Kod bo'yicha → `/share/...` ga yo'naltiradi |
| `/certificate/:shareId` | To'liq sertifikat (PDF qilib saqlash / chop etish) |
| `/health` | Render health check |

## Lokal ishga tushirish

```bash
npm install
cp .env.example .env   # MONGODB_URI va BOT_TOKEN ni yozing
npm run dev
```

`MONGODB_URI=memory` qilinsa, vaqtinchalik xotiradagi MongoDB ishlatiladi (sinov uchun).

## Render'ga joylash (bitta Web Service)

1. Loyihani GitHub'ga yuklang (`.env` yuklanmaydi).
2. Render → **New → Blueprint** → repo'ni tanlang (`render.yaml` avtomatik o'qiladi),
   yoki **New → Web Service**: Build `npm install`, Start `npm start`.
3. Environment'ga qo'shing: `MONGODB_URI`, `BOT_TOKEN`, ixtiyoriy `ADMIN_IDS`, `WEBHOOK_SECRET`.
4. `PUBLIC_URL` shart emas: Render `RENDER_EXTERNAL_URL` ni o'zi beradi. Bot shu manzilga webhook o'rnatadi.
5. MongoDB Atlas → Network Access'da `0.0.0.0/0` ga ruxsat bering (Render IP'lari doimiy emas).

> Render bepul tarifida servis 15 daqiqa harakatsizlikdan keyin uxlaydi. Botga yozilgan birinchi xabar uni uyg'otadi, shuning uchun birinchi javob biroz kechikishi mumkin.

## Eslatma

Bu portfolio uchun demo loyiha. "learn" brendi va sertifikatlar hech qanday haqiqiy ta'lim platformasi yoki kurs provayderi bilan bog'liq emas.
