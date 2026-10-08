# Lístoček

Jednoduchý spoločný nákupný zoznam optimalizovaný pre telefón. Frontend je PWA nasadená cez GitHub Pages; prihlasovanie, databázu a registračnú funkciu poskytuje Neon.

## Lokálne spustenie

```bash
pnpm install
pnpm dev
```

Bez premenných prostredia aplikácia funguje v lokálnom režime. Pre pripojenie k Neon skopírujte `.env.example` do `.env` a doplňte verejné endpointy Auth, Data API a registračnej funkcie. Do `VITE_*` nikdy nevkladajte databázové heslo ani iné serverové tajomstvo.

## Funkcie

- súkromné domácnosti s pozývacím kódom,
- pridávanie, úprava a označenie nákupu,
- návrhy podľa histórie položiek,
- odolná fronta zmien pri výpadku siete,
- synchronizácia otvoreného zoznamu každých 15 sekúnd a pri návrate do aplikácie,
- inštalovateľná PWA s riadenou aktualizáciou.

## Prihlasovanie a registrácia

Neon Auth spravuje e-mailové účty a relácie. Existujúci aj nový používateľ sa prihlasuje jednorazovým kódom, ktorý odošle samostatná Neon funkcia `listocekregister`. Tento tok funguje aj pre účty migrované zo Supabase bez prenosu hesla. Registrácia musí preto zostať v Neon Auth povolená.

Registračná funkcia používa serverové premenné `DATABASE_URL`, `NEON_AUTH_BASE_URL` a `LISTOCEK_ALLOWED_ORIGINS`. V databáze volá `public.listocek_reserve_registration_email`, ktorá obmedzuje odosielanie kódov. Serverové premenné nepatria do frontendu ani GitHub Actions.

Prístup k domácnostiam a položkám chránia RLS pravidlá podľa `auth.user_id()`. Neon Data API momentálne neposkytuje použité Supabase Realtime kanály, preto aplikácia počas otvorenia domácnosti pravidelne obnovuje údaje.

## Nasadenie

Push do vetvy `main` spustí `.github/workflows/deploy-pages.yml`, ktorý vykoná testy, produkčný build a nasadenie na GitHub Pages. Verejné Neon endpointy sú nastavené priamo vo workflow; žiadne tajomstvo v ňom nie je.

Pred ostrým nasadením overte:

1. Neon Auth má povolený produkčný origin `https://tomasbernik.github.io` a vytváranie účtov.
2. Nasadená funkcia `listocekregister` povoľuje ten istý origin.
3. Databázové migrácie, RPC funkcie a RLS pravidlá sú aplikované.
4. Na dvoch používateľoch funguje prihlásenie kódom, pozvanie do domácnosti a vzájomné zobrazenie zmien.

## Overenie

Použite Node.js 22.6 alebo novší:

```bash
pnpm test
pnpm test:browser
pnpm lint
pnpm build
```

Jednotkové a databázové testy používajú dočasnú PostgreSQL databázu v pamäti cez PGlite. Prehliadačové testy používajú simulované Neon Auth/Data API odpovede a neposielajú skutočné e-maily.
