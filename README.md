# Valters — personīgais šaha asistents

Valtera Avotiņa turnīri, nākamās partijas un rezultātu vēsture no chess-results.com (FIDE 11662255). Nav nepieciešama avota API. Lapa vispirms parāda galdiņu, krāsu, pretinieku un kārtas **sākuma** laiku. Sadaļas: Turnīri, Pretinieki un Statistika. Gada un tempa filtri vienādi ietekmē kopsavilkumu, pretiniekus un grafikus; teksta meklēšana sašaurina sarakstus.

## Saudzīga datu ielāde

Visi apmeklētāji izmanto vienu servera kešatmiņu. Poga **Atjaunot**, automātika un jauna cilne nevar apiet servera aizturi.

| Dati | Minimālais intervāls |
| --- | --- |
| Aktīva turnīra spēlētāja kartīte un nākamās kārtas izloze | 1 minūte |
| Aktīvā turnīra vietu kaimiņi | 15 minūtes |
| Turnīra apraksts un datumi | 24 stundas |
| Spēlētāja turnīru meklēšana | 6 stundas |
| Nākotnes un vēsturisko turnīru kartītes | 7 dienas (aktīvajam turnīram pārslēdzas uz 1 minūti) |

- Vienlaicīgi ienākušie pieprasījumi tiek apvienoti. Avota pieprasījumi ir secīgi, ar vismaz 2 sekunžu atstarpi.
- Nav cron, fonā darbojošās avota aptaujas vai automātisku tūlītēju atkārtojumu. Paslēpta lapa un bezsaistes režīms neaptaujā serveri.
- Pēc pirmās kļūmes atkārtota pārbaude pēc 1 minūtes; secīgām kļūmēm — 2, 4, 8 un līdz 15 minūtēm. Avota `Retry-After` vienmēr ir saistošs, arī ja tas ir ilgāks; atpazītai cilvēka pārbaudes lapai — 15 minūšu aizture. Sākotnējais kļūdas iemesls tiek saglabāts un parādīts arī aiztures laikā.
- Kļūda aptur konkrēto ielādes ciklu. Neatpazīts HTML un cita spēlētāja kartīte neaizstāj iepriekšējos derīgos datus.
- Aizture, parsētās lapas un pēdējais derīgais kopsavilkums saglabājas pēc servera pārstartēšanas. Arī neveiksmīga pirmā ielāde saglabā aizturi.
- Pirmā ielāde ir lēnāka, jo vēsture jānolasa ar pauzēm. Turpmāk avots tiek pieprasīts tikai novecojušajām kešatmiņas daļām.

Avotam nav publicēta API limita, tāpēc šie intervāli nesniedz garantiju pret bloķēšanu. Pieprasījumu biežumu nevajag palielināt, lai kompensētu avota kavētu izlozes publicēšanu.

## Lokāla palaišana / Node serveris

Nepieciešams Node.js 24.

```sh
npm ci
npm run dev
```

Pārlūks: http://127.0.0.1:8080. Node variantā dati glabājas `.cache/valters`; ar `VALTERS_CACHE_DIR` var norādīt pastāvīgu disku. Faila slēdzene koordinē procesus uz kopīga diska. Vairākām neatkarīgām servera mašīnām bez kopīga diska jāizmanto Cloudflare variants: atsevišķi lokālie diski nedod globālu avota limitu. Šis variants nav statiska HTML lapa.

## Cloudflare Workers

```sh
npm run dev:cloudflare
npm run build
npm run deploy
```

`wrangler.jsonc` satur `CHESS_CACHE` Durable Object saistījumu un SQLite migrāciju. Visas Worker instances izmanto vienu objektu `valters-source-v2`, tādēļ apmeklētāju un ierīču skaits nepavairo avota pieprasījumus. Objekts glabā kešatmiņu un aiztures pastāvīgā storage.

Cloudflare Git savienojumam: build komanda `npm run build`, deploy komanda `npm run deploy`. Arī `npm run build:cloudflare` paliek pieejama. Parastā būve pēc noklusējuma veido Cloudflare variantu; Node servera būvei jālieto `npm run build:node`. Izvietošanas komanda skaidri izmanto saknes `wrangler.jsonc`, pati palaiž būvi un augšupielādē `dist/server/index.js` kopā ar `dist/client` resursiem; tā nekompilē TanStack pirmkodu ar Wrangler bundleri. Esošam Worker jāsaglabā tā pašreizējais nosaukums laukā `name` un esošie domēna/Access iestatījumi. Jauna konfigurācija pati nepārceļ domēnu un neizvieto lapu. Ja ieslēgta Cloudflare Access aizsardzība, tā jāpiemēro visai lietotnei, ieskaitot servera funkcijas. `AuthProvider` nav autentifikācijas mehānisms.

## Statistikas precizitāte

Nospēlētās un gaidāmās partijas tiek skaitītas atsevišķi. Krāsu punktu procents izmanto tikai partijas ar rezultātu. Turnīriem glabājas sākuma un beigu datums. Pretiniekiem priekšroka ir FIDE ID, ja tas ir atrodams avota HTML; atšķirīgi ID netiek apvienoti. Bez ID izmanto normalizētu vārdu, federāciju un klubu, lai neapvienotu iespējamos vārdabrāļus. Nosaukumi bez ID tiek piesaistīti zināmam ID tikai tad, ja sakritība ir nepārprotama.

## Paziņojumi un instalēšana telefonā

Manifestam un PNG ikonām ir vietējās adreses. Safari: kopīgošanas izvēlne → pievienot sākuma ekrānam.

Paziņojumi ir papildiespēja aktīvai lapai, neatkarīga no automātiskās datu atjaunošanas. To piegāde aizvērtā lapā vai bloķētā telefonā nav garantēta. Servisa darbinieks pats neaptaujā chess-results un neievieš fona trafiku. Pilnam Web Push vajadzīgs atsevišķi konfigurēts abonementu/piegādes risinājums; šajā versijā tas netiek izlikts par darbojošos.

## Pārbaudes

```sh
npm run check
npm run test:runtime
npm run test:deploy
npx playwright install chromium
npm run test:visual
```

Node testi izmanto saglabātus HTML piemērus, kontrolētu pulksteni un viltotu avotu. Tie pārbauda parsēšanu, statistiku, datumu robežas, vienlaicīgus apmeklējumus, servera pārstartēšanu, aiztures un avota atteikumus. Pārlūka testi izmanto izolētu, iepriekš aizpildītu kešatmiņu `.cache/visual`, nevis avota lapu ielādi. Tie pārbauda 375/768/1440 px, abas tēmas, navigāciju, filtrus un ikonas. GitHub Actions palaiž šīs pārbaudes automātiski.

### TanStack virtuālo moduļu kļūdas izvietošanā

`#tanstack-router-entry`, `#tanstack-start-entry` un `tanstack-start-manifest:v` ir Vite ģenerēti moduļi. Tiem nav jāpievieno manuāli alias ieraksti. Ja vecā Cloudflare būve tos nevar atrast, iestati build komandu `npm run build`, deploy komandu `npm run deploy` un atkārto būvi no jaunākā `main` komita. Deploy saknes konfigurācija ar `no_bundle` izmanto jau sakompilēto rezultātu. Vite adapteris ignorē Wrangler izvietošanas laukus `build`, `no_bundle`, `rules`; Vite izdotais brīdinājums par šiem laukiem ir paredzēts un neaptur būvi.

`npm run test:deploy` pārbauda `wrangler deploy --dry-run` atsevišķā pagaidu direktorijā bez `dist` un `.wrangler`, tādēļ lokāli saglabāta iepriekšējās būves konfigurācija nevar noslēpt šo kļūdu. Pārbaude neko neizvieto un nepieprasa chess-results lapas.

Vecāku turnīru aprakstu avots mēdz paslēpt aiz “Show tournament details”. Šāda lapa netiek uzskatīta par bojātu: sistēma izmanto pieejamos meklēšanas datumus un spēlētāja kartītes, neizraisot visa paneļa atteici vai papildu pieprasījumus apraksta atvēršanai.

`npm run test:runtime` pārbauda noklusēto `fetch` piesaisti un kopīgo kešatmiņu īstā Workers `workerd` izpildvidē (Miniflare). Avota atbildes tiek aizstātas lokāli; ārēji pieprasījumi netiek veikti. Šī pārbaude ir iekļauta `npm run check`.
