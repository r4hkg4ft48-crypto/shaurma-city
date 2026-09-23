# Lepesh migration archive

Original source: `r4hkg4ft48-crypto/beautyflow`, branch `shaurma-city`.

This directory preserves the original Lepesh client/admin/server source before the project was consolidated into `r4hkg4ft48-crypto/shaurma-city`.

Legacy Render static services that were attached to that branch:
- shaurma-city-miniapp — https://shaurma-city-miniapp.onrender.com
- shaurma-city-build8 — https://shaurma-city-build8.onrender.com
- shaurma-city-live9 — https://shaurma-city-live9.onrender.com

Original client API target found in the archived client:
- https://beautyflow-app.onrender.com

The legacy client used the same Shaurma API family (/api/shaurma/*), Telegram auth, live order stream, cart, builder and checkout logic. The legacy backend is no longer an active Render service in the accessible workspace; the surviving production database is shaurma-city-db and the active API is https://shaurma-city-api.onrender.com.

Legacy asset inventory from beautyflow/shaurma-city:
- bakery.webp
- cheesy.webp
- classic.webp
- drinks.webp
- extras.webp
- flatbread.webp
- hero.webp
- sauces.webp
- top-flatbread.webp
- top-shawarma.webp

Production source of truth after migration:
- GitHub: r4hkg4ft48-crypto/shaurma-city / main
- App: https://shaurma-city-app.onrender.com
- API: https://shaurma-city-api.onrender.com
- DB: shaurma-city-db
- Customer bot: @LepeshkaJulbot

Do not develop new Lepesh functionality in beautyflow/shaurma-city. Legacy URLs are compatibility entry points only.
