# Implementācija

Publiskā lapa ir Cloudflare Worker. Pārlūks nesaņem chess-results sīkdatnes un nelasa avotu tieši. Visi apmeklētāji dala vienu Durable Object `valters-source-v2`.

## Galvenie faili

| Fails | Loma |
| --- | --- |
| `src/components/valters-app.tsx` | Četras sadaļas, galvene, partiju rindas, nākamās partijas bloks |
| `src/lib/chess/scrape.server.ts` | Meklēšana pēc FIDE, turnīru kartītes, izloze, pretinieka kopsavilkums |
| `src/lib/chess/parse.ts` | HTML pārveidošana par turnīriem, partijām un izlozes rindu |
| `src/lib/chess/types.ts` | `Tournament`, `NextGame`, `OpponentGlance` |
| `src/lib/chess/coordinator.server.ts` | Kopīgā kešatmiņa, intervāli un kļūdu aizture |
| `src/chess-cache.ts` | Durable Object glabātuve |

## Nākamā partija

Aktīvam turnīram vispirms tiek lasīta Valtera kartīte (`art=9`). Ja tajā ir partija bez rezultāta, tā ir nākamais pāris. Papildus tiek lasīta kārtas izloze (`art=2`), lai paņemtu galdiņu, krāsu un publicēšanas laiku.

Pretinieka FIDE numurs izlozes rindā parasti nav. Tas tiek lasīts no pretinieka kartītes lauka `Fide-ID`, ja rindā ir `snr`. Pēc tam `spielersuche` tiek izsaukta ar šo numuru. Rezultāts ir `OpponentGlance`: turnīru skaits, labākā vieta un trīs jaunākie turnīri. Meklēšana tiek kešota ar vēstures intervālu, lai katra atjaunošana neatsauktu meklēšanu no jauna.

Iepriekšējās savstarpējās partijas netiek meklētas pretinieka profilā. Tās tiek saliktas no Valtera jau ielādētajām partijām pēc vārda.

## Ko UI dara lokāli

Rezultāta cipara kolonna ir fiksēta: aplis 2.75rem un vārds 4.75rem, bloks 8rem, ar nelielu pabīdi pa labi. Mobilajā partiju rindā kreisā atkāpe ir noņemta, lai vārds sakrīt ar pirmo rezultāta lauciņu.

Atkārtotie pretinieki tiek izņemti no otrā saraksta pēc salocīta vārda. Zirga poga izsauc lapas pārlādi, kas atgriež Aktuālo.

## Pārbaudes

`npm run check` palaiž parsera testus un runtime pārbaudi ar viltotu avotu. Pārlūka testi nelasa chess-results. Izvietošana ir `npm run deploy` no `main`.
