# Translation glossary and style

Source language: English (`messages/en.json`). Every other language is a
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

## Never translated

"Booklo", plan names, language names in the switcher (`LOCALE_NAMES`),
handles, URLs, ISO codes, the `you@company.com` placeholder.
