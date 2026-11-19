# Implementācija

Publiskā lapa ir Cloudflare Worker. Pārlūks nesaņem chess-results sīkdatnes un nelasa avotu tieši. Visi apmeklētāji dala vienu Durable Object `valters-source-v2`.

## Galvenie faili

| Fails | Loma |
| --- | --- |
| `src/components/valters-app.tsx` | Četras sadaļas, galvene, partiju rindas, nākamās partijas bloks |
| `src/lib/chess/scrape.server.ts` | Meklēšana pēc FIDE, turnīru kartītes, izloze, pretinieka kopsavilkums |
| `src/lib/chess/parse.ts` | HTML pārveidošana par turnīriem, partijām un izlozes rindu |
| `src/lib/chess/types.ts` | `Tournament`, `NextGame`, `OpponentGlance` |
| `src/lib/chess/config.ts` | Spēlētāja vārds, FIDE numurs, turnīri bez FIDE numura, vietas un sporta klases |
| `src/lib/chess/stats.ts` | Tempa noteikšana (`paceOf`) un filtrētā statistika (`scopedDossier`) |
| `src/lib/chess/coordinator.server.ts` | Kopīgā kešatmiņa, intervāli un kļūdu aizture |
| `src/chess-cache.ts` | Durable Object: 10 s gaidīšana uz atjaunošanu, alarm tās pabeigšanai |
| `src/lib/chess/insights.ts` | Statistikas aprēķini: filtri, sērijas, pret stiprākiem/vājākiem, turnīra puses, galdi, sporta klases, atkārtotie pretinieki |
| `src/lib/chess/sql-store.ts` | Kešatmiņa SQLite: viena rinda katrai avota lapai, vecā formāta pārnešana |

## Nākamā partija

Aktīvam turnīram vispirms tiek lasīta Valtera kartīte (`art=9`). Ja tajā ir partija bez rezultāta, tā ir nākamais pāris. Papildus tiek lasīta kārtas izloze (`art=2`), lai paņemtu galdiņu, krāsu un kārtas sākuma laiku. Izlozes publicēšanas laiku chess-results nedod, tāpēc lapa to nerāda.

Pretinieka FIDE numurs izlozes rindā parasti nav. Tas tiek lasīts no pretinieka kartītes lauka `Fide-ID`, ja rindā ir `snr`. Pēc tam `spielersuche` tiek izsaukta ar šo numuru. Rezultāts ir `OpponentGlance`: turnīru skaits, labākā vieta un trīs jaunākie turnīri. Gan pretinieka kartīte (`opp:<turnīrs>:<snr>`), gan meklēšana (`glance:<FIDE>`) tiek kešotas ar vēstures intervālu, lai katra atjaunošana tās neatsauktu no jauna; ieraksti tiek izmesti pēc 7 dienām. Nākamās partijas kartē pie pretinieka ir arī viņa punkti šajā turnīrā.

Iepriekšējās savstarpējās partijas netiek meklētas pretinieka profilā. Tās tiek saliktas no Valtera jau ielādētajām partijām pēc vārda.

## Ko UI dara lokāli

Partiju rindā rezultāta aplis ir 2.25rem; no `sm` platuma blakus ir vārds, bloks 8rem. Mobilajā rindā kreisā atkāpe ir noņemta, lai vārds sakrīt ar pirmo rezultāta lauciņu.

Kārtas sākuma datums nāk no izlozes lapas teikuma “Round N on YYYY/MM/DD at HH:MM” (`parseRoundDate`), laiks tiek pārrēķināts no Rīgas laika ar `rigaInstant`, un atskaite atjaunojas ik pēc 30 sekundēm. Galvenes josla Aktuālajā ir pārklājums zem galvenes (neietekmē lapas plūsmu), un to parāda `IntersectionObserver`, kad nākamās partijas karte vairs nav redzama. Galvenes sašaurināšanai ir histerēze (64 px / 8 px), lai augstuma maiņa neizraisītu svārstības. Teksts uz zaļajām kartēm izmanto `--color-on-pine`, kas abās tēmās paliek gaišs.

Pretinieku sarakstā tie, kas sastapti vairākas reizes, tiek apvienoti pēc salocīta vārda (`foldName`), nevis pēc FIDE numura, jo iesācējiem tā bieži nav. Gada un tempa filtrs pārrēķina pretiniekus ar `scopedDossier`, tāpēc “N×” skaita tikai nospēlētās partijas arī filtrētā skatā. Lokālās glabātuves piekļuve iet caur `safeStorage`, lai bloķēta glabātuve neapturētu lapu. Zirga poga izsauc lapas pārlādi, kas atgriež Aktuālo.

## Pārbaudes

`npm run check` palaiž parsera testus un runtime pārbaudi ar viltotu avotu. Pārlūka testi nelasa chess-results. Izvietošana ir `npm run deploy` no `main`.
