# Translation glossary and style

Source language: English (`messages/en.json`). Every other language (`uk`, `pl`) is a
full translation of it; `src/i18n/messages.test.ts` refuses a partial one.

Before drafting a language: read the term table, then the style notes.
A term missing here is added here first, then used.

## Terms

| en | uk | note |
|---|---|---|
| appointment | запис | a time booked with a person |
| service | послуга | |
| space | простір | rooms, studios and gear alike (H5a ruling) |
| unit (of a space) | одиниця | the individual room or item |
| booking | бронювання | |
| request (pending approval) | запит | |
| client | клієнт | |
| team member | учасник команди | never "персонал" |
| the provider (you) | ви / ваш бізнес | never "провайдер" |
| availability, hours | графік, робочі години | |
| time / slot | час | never "слот" in client-facing copy |
| stay (nights) | проживання | |
| check-in / check-out | заїзд / виїзд | |
| reschedule / cancel / confirm | перенести / скасувати / підтвердити | |
| deposit | завдаток | |
| widget / booking page | віджет / сторінка бронювання | |
| embed | код для сайту | the noun; the verb is "вбудувати" |
| handle (page address) | адреса сторінки | |
| Free / Pro | Free / Pro | plan names stay |
| Booklo | Booklo | |
| the venue / the provider (client-facing) | заклад | what the client calls the business: "у часовому поясі закладу", "зверніться до закладу" |
| team member (client-facing "with Anna") | спеціаліст | "(спеціаліст: Анна)", "Спеціаліст: Анна" — sidesteps name declension; never "майстер" |
| anyone (staff switch) | будь-хто | |
| night / day / hour (counts) | ніч, ночі, ночей · день, дні, днів · година, години, годин | four ICU forms (one/few/many/other) — `public.units.*` |
| min / h (short units) | хв / год | "60 хв", "1 год 30 хв" |
| Powered by Booklo | Працює на Booklo | |
| pickup / return (day stays) | отримання / повернення | |
| Overview (admin page, named in provider mails) | «Огляд» | provisional until Wave 3 names the admin nav |
| booked / cancelled / moved (a client, unknown gender) | забронював(ла) / скасував(ла) / змінив(ла) час | provider-facing mails; only verbs whose feminine is stem + ла take the (ла) ending — never переніс(ла), whose feminine is перенесла |
| admin nav | Огляд · Бронювання · Клієнти · Простори · Послуги · Команда · Графік · Сторінка бронювання · Код для сайту · Оплата · Налаштування | sidebar sections: Пропозиція (Offer), Поширення (Share) |
| overview / availability / billing (pages) | Огляд / Графік / Оплата | |
| nightly / daily (a space's mode) | на ніч / на день | never «подобово/поденно» |
| require approval (toggle) | Потрібне підтвердження | the same label on services and spaces |
| booking window (days) | Вікно бронювання (днів) | |
| request (booking approval, admin) | запит | "Очікує підтвердження" for the pending status |
| layout (widget template) | макет | |
| section (of the booking page) | розділ | |
| cover (hero section) | обкладинка | |
| publish / draft | опублікувати / чернетка | |
| Latin only (font note) | Лише латиниця | Geist, DM Sans, Space Grotesk |
| an org as the subject of a verb | Заклад {orgName} … | anchors the verb to a masculine noun, since org names are mostly feminine/neuter (Студія, Клініка) |

## Style — uk

- Formal **ви**, lowercase in running text.
- Command buttons use the infinitive ("Зберегти", "Скасувати", "Увійти"); instructions and errors use the ви-imperative ("Оберіть", "Спробуйте", "Перевірте").
- No exclamation marks. Sentence case. One idea per sentence.
- Typographic apostrophe `’` inside words (з’являвся), em dash `—` with spaces.
- Forbidden words (the `FORBIDDEN_COPY` guard, per locale): оренда, офер, пропустити.

## Terms — pl

| en | pl | note |
|---|---|---|
| appointment | wizyta | |
| service | usługa | |
| space | przestrzeń | rooms, studios and gear alike |
| unit (of a space) | jednostka | the individual room or item |
| booking | rezerwacja | |
| request (pending approval) | prośba (o rezerwację) | "Czeka na zatwierdzenie" for the pending status |
| client | klient | |
| team member | członek zespołu | never "personel" / "pracownik" |
| the provider (you) | Ty / Twoja firma | never "usługodawca" when addressing the provider |
| the provider (client-facing) | usługodawca | "skontaktuj się z usługodawcą"; "na miejscu" for the venue |
| availability, hours | dostępność, godziny pracy | |
| time / slot | termin | never "slot" |
| stay (nights) | pobyt | |
| check-in / check-out | zameldowanie / wymeldowanie | |
| pickup / return (day stays) | odbiór / zwrot | |
| reschedule / cancel / confirm | przełożyć / anulować / potwierdzić | "przenieść" when the provider moves a booking |
| deposit | zaliczka | |
| widget / booking page | widżet / strona rezerwacji | |
| embed | osadzenie na stronie / kod do osadzenia | the nav item and the snippet |
| handle (page address) | adres strony | |
| Powered by Booklo | Działa na Booklo | |
| team member (client-facing "with Anna") | u: Anna | "u:" with a colon sidesteps name declension |
| anyone (staff switch) | ktokolwiek | |
| night / day / hour (counts) | noc, noce, nocy · dzień, dni, dni · godzina, godziny, godzin | four ICU forms: one/few/many/other |
| min / h (short units) | min / godz. | "60 min", "1 godz. 30 min" |
| admin nav | Przegląd · Rezerwacje · Klienci · Przestrzenie · Usługi · Zespół · Dostępność · Strona rezerwacji · Osadzenie na stronie · Rozliczenia · Powiadomienia · Ustawienia | sections: Oferta (Offer), Udostępnianie (Share) |
| billing (page) | Rozliczenia | not "Płatności" — that word is reserved for client payments |
| hourly / nightly / daily (a space's mode) | na godziny / na noce / na dni | |
| turnover | przerwa techniczna | |
| require approval (toggle) | Wymaga zatwierdzenia | |
| booking window (days) | Okno rezerwacji (dni) | |
| date override | wyjątek dla daty | |
| layout / section / cover | układ / sekcja / okładka | |
| publish / draft | opublikuj / wersja robocza | |
| Free / Pro / Premium | Free / Pro / Premium | plan names stay; "Premium" is the same word |

## Style — pl

- Informal **ty**, with the polite capital in direct address ("Twoja strona", "u Ciebie").
- Command buttons use the imperative ("Zapisz", "Anuluj", "Zaloguj się"); errors and instructions too ("Wybierz", "Spróbuj ponownie").
- No exclamation marks. Sentence case. One idea per sentence.
- Polish quotation marks „ ”, em dash — with spaces, decimal comma in prose ("4,5:1").
- Forbidden words (the `FORBIDDEN` guard, per locale): wynaj- (wynajem/wynająć), pomiń; the studio also never says "później".
- Same as English on purpose (`SAME_IN_EVERY_LOCALE`): min, Link, Plan:, FAQ, Logo, Premium.

## Never translated

"Booklo", plan names, language names in the switcher (`LOCALE_NAMES`),
handles, URLs, ISO codes, the `you@company.com` placeholder.
