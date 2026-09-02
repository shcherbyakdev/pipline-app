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

## Style — uk

- Formal **ви**, lowercase in running text.
- Command buttons use the infinitive ("Зберегти", "Скасувати", "Увійти"); instructions and errors use the ви-imperative ("Оберіть", "Спробуйте", "Перевірте").
- No exclamation marks. Sentence case. One idea per sentence.
- Typographic apostrophe `'` inside words (з'являвся), em dash `—` with spaces.
- Forbidden words (the `FORBIDDEN_COPY` guard, per locale): оренда, офер, пропустити.

## Never translated

"Booklo", plan names, language names in the switcher (`LOCALE_NAMES`),
handles, URLs, ISO codes, the `you@company.com` placeholder.
