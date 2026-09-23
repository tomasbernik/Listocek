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

Prvé prihlásenie používa overovací e-mailový odkaz cez Supabase Auth, po ktorom si používateľ nastaví heslo. Ďalšie prihlásenia používajú e-mail a heslo; e-mailový odkaz je potrebný už len pri zabudnutom hesle. Produkčnú adresu aplikácie treba pridať v Supabase do **Authentication → URL Configuration → Redirect URLs**. Prístup k údajom povoľujú databázové RLS pravidlá len prihláseným členom domácnosti.

## Domácnosti a pozvánky

Každá rodina si vytvorí vlastnú domácnosť. Ďalší členovia sa pripoja pozývacím odkazom alebo osemmiestnym kódom. Pozvanie sa zapamätá aj počas prihlasovania e-mailom. V detaile členov možno zmeniť názov domácnosti alebo ju opustiť; zoznam a prístup ostatných členov zostanú zachované. Posledný člen si môže pred odchodom odložiť pozývací odkaz na neskorší návrat.

„Zdieľať pozvanie“ otvorí systémovú ponuku zariadenia, ktoré určuje dostupné aplikácie (napríklad WhatsApp, Messenger či e-mail). Samostatne je dostupné kopírovanie odkazu a otvorenie e-mailového klienta. Aplikácia sama žiadnu správu neposiela. Systémové zdieľanie vyžaduje podporovaný prehliadač a HTTPS; ak nie je dostupné, zostáva kopírovanie a e-mail.

## Nasadenie aktualizácie synchronizácie a domácností

1. **Pred nasadením nového frontendu** aplikujte na príslušný Supabase projekt migráciu `supabase/migrations/202609160001_reliable_sync_and_households.sql` (po predchádzajúcich troch migráciách). Pridáva spracovanie zmien s ochranou proti opakovanému vykonaniu, odchod a premenovanie domácnosti. Existujúce zoznamy ani členov nemaže. Staršie funkcie pre pôvodný frontend ostávajú dostupné.
2. V Supabase **Authentication → URL Configuration → Redirect URLs** ponechajte presnú adresu aplikácie a pridajte aj vzor pre pozvánky, napríklad `https://tomasbernik.github.io/Listocek/?invite=*`. Ak používate inú doménu, nahraďte ju vlastnou. Parameter `invite` sa tak prenesie aj pri otvorení prihlasovacieho e-mailu v inom prehliadači. Pozrite [pravidlá Supabase pre presmerovania](https://supabase.com/docs/guides/auth/redirect-urls).
3. Nasaďte frontend obvyklým postupom. V dvoch telefónoch overte pridanie, odškrtnutie a úpravu položky, návrat zo stavu bez internetu a prijatie pozvánky cez skutočný prihlasovací e-mail.

Čakajúce zmeny sa uchovávajú v zariadení a prekrývajú serverové údaje až do potvrdenia. Neúspešné načítanie zachová posledný zoznam. Pri zlyhaní odoslania zostane zmena vo fronte; opätovné odoslanie spustí tlačidlo „Skúsiť znova“, návrat do aplikácie alebo obnovenie internetu. Odchod a odhlásenie sú pri neodoslaných zmenách zablokované. Úprava názvu, množstva či obchodu nemení stav kúpenia; pri súčasných úpravách rovnakých detailov platí posledná doručená úprava.

## Overenie

Použite Node.js 22.6 alebo novší:

```bash
pnpm test
pnpm test:browser
pnpm build
```

Jednotkové a databázové testy používajú dočasnú PostgreSQL databázu v pamäti cez PGlite. Prehliadačové testy vyžadujú nainštalovaný Chrome, spustia lokálny server na porte 4175 a používajú fiktívne Supabase odpovede. Nepripájajú sa k živej databáze a neposielajú e-maily ani správy. Skutočná ponuka systémového zdieľania a doručenie prihlasovacích e-mailov sa overujú na zariadení po nasadení.


## Nasadenie prihlasovania heslom

- Nie je potrebná nová SQL migrácia. Heslá spravuje Supabase Auth; aplikácia ich neukladá do localStorage ani do tabuliek domácností.
- V Authentication → URL Configuration zachovajte existujúce adresy a doplňte `https://tomasbernik.github.io/Listocek/?auth=password` a `https://tomasbernik.github.io/Listocek/?auth=password&invite=*`. Nemeňte Site URL ostatných aplikácií. E-mailové šablóny musia používať Supabase ConfirmationURL, aby sa zachovalo presmerovanie.
- Email provider musí byť povolený. Registrácia vyžaduje povolené vytváranie nových používateľov. Platí aj prípadná prísnejšia serverová politika hesiel.
- Doterajší prihlásení používatelia dostanú výzvu na nastavenie hesla. Odhlásení používatelia bez hesla zvolia „Ešte nemám heslo“. Existujúce heslo z inej aplikácie rovnakého Supabase projektu možno použiť priamo.
- Heslo patrí spoločnému Supabase účtu: jeho nastavenie alebo obnova mení heslo aj pre ďalšie aplikácie používajúce ten istý účet. Metadáta `listocek_password_set` slúžia iba na zobrazenie úvodnej obrazovky, nikdy na autorizáciu.
- Odhlásenie používa scope `local`, takže Lístoček nezruší všetky ostatné relácie účtu. Ostatné aplikácie môžu stále používať globálne odhlasovanie. Predvolené úložisko existujúcich relácií ostáva zachované.
- Po nasadení overte doručenie prvého aj obnovovacieho odkazu na telefóne, nastavenie hesla a následné prihlásenie heslom. Automatické testy používajú simulovaný Auth server, neposielajú skutočné e-maily.
