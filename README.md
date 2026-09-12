# Lístoček

Jednoduchý spoločný nákupný zoznam optimalizovaný pre telefón.

## Lokálne spustenie

```bash
pnpm install
pnpm dev
```

Bez premenných prostredia aplikácia používa lokálny režim. Pre spoločný realtime zoznam skopírujte `.env.example` do `.env`, doplňte URL a anon kľúč Supabase projektu a aplikujte migráciu v `supabase/migrations`.

## Funkcie

- okamžité pridávanie položiek,
- nepovinné množstvo a obchod,
- zoskupenie nákupu podľa obchodov,
- návrhy podľa frekvencie používania,
- označenie položiek ako kúpených,
- inštalovateľná PWA s riadenou aktualizáciou.
- súkromné domácnosti s pozývacím kódom,
- realtime synchronizácia cez Supabase Postgres Changes.

Prihlásenie používa jednorazový e-mailový odkaz cez Supabase Auth. Produkčnú adresu aplikácie treba pridať v Supabase do **Authentication → URL Configuration → Redirect URLs**. Prístup k údajom povoľujú databázové RLS pravidlá len prihláseným členom domácnosti.
