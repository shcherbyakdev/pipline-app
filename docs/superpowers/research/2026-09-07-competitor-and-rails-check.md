# Competitor capability check + Stripe rails check (2026-09-07)

Desk research for a booking-ops product aimed at multi-room photo studios in Poland.
Primary sources only (vendor help centres / pricing pages / Stripe docs). Quotes are verbatim;
"not documented" means the vendor's public docs are silent — it is not a claim the feature is absent.
Fetched 2026-09-07.

---

## A. Competitor capability check

### List prices (from pricing pages, fetched 2026-09-07)

| Vendor | Plans | Source |
|---|---|---|
| **Bookero** | Basic **19.90 PLN netto/mo**, Standard **49.90 PLN netto/mo**, Premium **89.90 PLN netto/mo** (5% off on 6-month term; "VAT 23%" on top). "Reguły cen i rabaty" only in Premium. | https://www.bookero.pl/cennik |
| **Calendesk** | Standard **197 PLN netto/mo** (157 netto/mo on annual), Pro **347 PLN netto/mo** (287 netto/mo on annual), Enterprise "Ustalane indywidualnie". API + Zapier only from Pro. | https://calendesk.com/pl/cennik/ |
| **AllBooked** | Core **$99 USD/mo** ("up to 3 spaces"), Business **$149 USD/mo** ("Everything in Core + booking & pricing rules + equipment and instrument rentals + integrations"), Advanced **$199 USD/mo**, Franchise & Enterprise custom. Extra spaces $4.99 each. | https://www.allbooked.com/pricing |

### Capability table

Legend: **Yes / No / Partial / Not documented** + short quote (Polish quotes kept verbatim).

| # | Question | Bookero | Calendesk | AllBooked |
|---|---|---|---|---|
| 1 | One booking requiring SEVERAL resources at once (room + shared lamp), each conflict-checked? Or add-ons without own availability? | **No (add-ons have no availability).** Add-ons are form "parametry": "wybór dodatkowych usług, które wchodzą w skład usługi głównej, zarówno w formie płatnej jak i bezpłatnej" [B-param]. No stock/availability field documented for parameters [B-param-price]. The cart is not a multi-resource booking: "Każdy z dodanych do koszyka terminów doda się do systemu jako oddzielna rezerwacja" [B-cart]. No "resource" concept in the help centre. | **Partial.** Resources exist, are quantity-limited and conflict-checked, but they hang off the *service*, are not client-selectable extras, and "several per service" is not spelled out: "Zasoby to takie przedmioty, które są niezbędne przy obsłudze klienta… Liczba dostępnych przedmiotów – zasobów jest ograniczona, dlatego przy dokonywaniu rezerwacji system uniemożliwi klientowi zapisanie rezerwacji, z powodu braku przedmiotów niezbędnych przy obsłudze." [C-res]. "Zasoby określają pomieszczenia lub urządzenia potrzebne do wykonania usługi. Np. krzesło, pokój, stół do masażu itp." [C-service]. Admin override: "Jeśli rezerwacja jest robiona z poziomu konta administratora, to system nie zablokuje możliwości dodania rezerwacji w przypadku braku zasobów." [C-res] | **Yes.** Add-Ons with stock: "Restrict specific Add-Ons to specific spaces, based on physical space limitations" and "a maximum quantity available across your entire venue" [A-addons]. Music-studio page: instruments/equipment "set up as Add-Ons in Settings, complete with stock limits, and linked to specific rooms… availability is enforced automatically – so the same amp or mic can't end up double-booked across two sessions" [A-music, via search snippet of that page]. Plan gate: "AllBooked Business and Advanced plans include add-ons, while Core plans are limited to one active add-on at a time." [A-addons] |
| 2 | Whole-studio booking blocks the rooms (parent blocks children) or vice versa? | **Not documented.** Closest thing is a per-slot booking rule that can apply to one service or all: "W pierwszym przypadku system weryfikuje dodaną regułę jedynie dla wybranej pozycji, czyli na tą samą godzinę może być dokonana druga rezerwacja pod warunkiem, że dotyczy innej usługi." [B-rules]. No parent/child or blocking-between-services feature described. | **Not documented.** Nothing in the resources/services articles about one service blocking another or grouped spaces. | **Yes (via Space Sharing; article is Skedda-branded, shared help centre).** "Create a Skedda space for each of the individual spaces and then an extra space for the whole entire venue. Set up the pricing rules for this new space too. Add space sharing rules for each individual space to connect them to the entire venue space. This way if one individual space is booked the entire venue can't be booked and vice-versa." [A-share] |
| 3 | Partial deposit online with balance owed and tracked on the booking? | **Not documented.** Only full online payment with a pay-by deadline, or cash on site: "W przypadku płatności gotówką rezerwacja jest automatycznie (lub ręcznie jeśli tak jest ustawiona) zaakceptowana i rozliczenie następuje w miejscu realizacji usługi" [B-payform]. No zaliczka/procent option in any help article found (deposit wording appears only on individual studios' own Bookero pages as policy text). | **No (full prepayment only).** "Twoje usługi w Calendesk możesz oznaczyć, jako takie, które wymagają przedpłaty." [C-prepay]. Amount = service price; no percentage/deposit field documented. Balance tracking: not documented. | **Partial (card-on-file, not a deposit).** "users are not charged anything immediately to secure a booking. However, the booking holder is required to provide a valid credit card." [A-pay]. Search-snippet wording from the same help centre: "Online charges can act as a substitute for a deposit." No percentage deposit / balance-due field documented. |
| 4 | Post-booking charges (overtime, extra people, damage) added to the same booking and collected? | **Not documented.** No article on editing a booking's price after the fact or requesting an extra payment. | **Not documented.** Only client-side bulk payment of *unpaid* bookings: "Przycisk oznaczony cyfrą 2 umożliwia dodanie nieopłaconej rezerwacji do koszyka w celu dokonania płatności zbiorczej" [C-client]. Nothing on adding charges to a completed booking. | **Yes, with a caveat (charge happens in Stripe, not on the booking).** One-off fees: "If you've set up online payments and the user has card details entered in AllBooked, then this can be done from their customer profile in your Stripe account" [A-pay]. Add-ons on existing bookings: "Venue admins can edit an active or upcoming booking from the calendar and manually add or remove Add-Ons as needed." [A-addons]. Invoicing: "Handle unpaid bookings as they happen, or batch invoice multiple bookings within a date range." [A-pp] |
| 5 | Time-limited hold: unpaid booking auto-cancels after N hours? | **Yes.** "W przypadku braku płatności po określonym przez Ciebie czasie rezerwacja zostaje anulowana" [B-funkcje]. "Wpisana wartość określa ile czasu przewidujemy na opłacenie rezerwacji przez klienta. Jeśli po tym czasie rezerwacja nie zostanie opłacona, zostaje ona automatycznie anulowana przez system" [B-payform]. Cart hold: "Dodanie terminu do koszyka blokuje jego wybór przez innych użytkowników na 30 minut" [B-cart]. | **Yes.** "Musisz ustawić czas, który chcesz przeznaczyć na oczekiwanie na płatność Twojego klienta. Czas około 1 godziny powinien być czasem optymalnym." … "po wyznaczonym czasie, zostanie ona usunięta z systemu" … "twój kalendarz zostanie odblokowany zaraz po usunięciu tego spotkania." [C-prepay] | **Not documented.** Booking Payments article describes only manual status changes ("Paid" / "Unpaid" / "Not applicable"); no auto-cancel timer found [A-pay]. |
| 6 | Pricing rules: duration tiers, per person, weekday/time, paid extras with own unit? | **Partial.** Price rules (Premium plan) conditions: "Zależne od daty rezerwacji", "Zależne od dnia rezerwacji", "Zależne od godziny rezerwacji", "Zależne od liczby osób", "Zależne od dodatkowych parametrów"; output is a fixed "Nowa cena"; all conditions AND-ed [B-rules-price]. Weekday/weekend and morning/evening: yes ("w godzinach porannych, a inną w wieczornych"). Per-person: yes ("naliczanie obniżonej ceny, w przypadku dokonania rezerwacji na większą liczbę osób"). Duration tiers (first hour vs next): not documented. Paid extras: price per parameter value ("Ma wpływ na cenę"), unit (per hour / per piece) not documented; "Przypisanie ceny jest możliwe jedynie dla dwóch rodzajów parametrów" [B-param-price]. | **Partial.** Service variants carry "nazwa, cenę i czas trwania" (so duration tiers = separate variants); minimum paid price 3 PLN [C-service]. Per-person, weekday/time pricing, paid extras with units: not documented. | **Yes (except per-person).** "Skedda's pricing rules are per booking and can be based on which space(s) is selected, duration, time of the day, day of the week, and user tag." Example "a fixed rate of $40 for bookings over 4 hours" [A-price]. Add-on units: "A one-time charge per booking", "based on the length of the booking", or "per Item" [A-addons]. Per-person pricing: not documented. |
| 7 | Must the client create an account to book, or is guest booking supported? | **Guest (Partial — login never mentioned).** "Użytkownik dokonuje rezerwacji korzystając z formularza umieszczonego na stronie internetowej za pomocą specjalnej wtyczki." [B-faq]. No client login/registration step documented. | **Partial.** Client panel is optional: "Jeśli Twoi klienci mają możliwość logowania się do Panelu klienta" [C-client]. Whether booking *requires* an account: not documented. | **Partial (venue setting).** "Some venues let anyone book, so you can book right away without signing in." vs new users must "create one before booking" if the venue requires it [A-howto]. Generic Skedda doc: "Regular users need to have an account (possibly with certain permissions) to make a booking themselves." [A-user] |
| 8 | Export bookings and customers (CSV/API) to leave? | **Partial.** "Możesz wygenerować raporty rezerwacji w programie Excel" [B-funkcje]. Client list export to xls (marketing-consent filter) appears in search snippet of /funkcje. No public API: "O ile zewnętrzny system przewiduje taką możliwość, jesteśmy w stanie wykonać integrację na indywidualne zamówienie." [B-faq] | **Yes.** Clients: "Pobieranie listy klientów w następujących formatach: Microsoft Excel, vCard, Open Office, Libre Office, CSV, HTML" [C-clients]. API (Pro plan): Admin API "Full access to all resources. Manage bookings, services, employees, settings, and more."; `GET /api/admin/users` paginated [C-api]. Zapier: "Aktualnie tylko osoby korzystające z zaproszenia od Calendesk oraz klienci planu Calendesk Pro mogą połączyć konto Calendesk z Zapier." [C-zapier]. Bookings CSV export UI: not documented (API covers it). | **Yes (bookings); users not documented.** "Click on the List View. To the right-hand side of the 'Filters' button, click on the dropdown menu to find the 'Export' option." → XLSX or CSV, includes holder name/org/phone/email [A-export]. API key exists for Zapier [A-zapier]. Dedicated customer export: not documented. |
| 9 | Przelewy24 / BLIK / PayU supported? | **Yes.** "W systemie mamy możliwość wyboru spośród 7 dostawców płatności: PayU, PayPal, Przelewy24, Tpay, Hotpay, Paynow, ING Pay lub Stripe." [B-faq]. BLIK referenced: "Co czwarty użytkownik do finalizacji transakcji wykorzystuje BLIKa" [B-secure]. | **Yes for P24 + BLIK (via Stripe only); PayU not documented.** "Przelewy24 - Twój klient ma dostęp do wszystkich banków w Polsce"; "BLIK - błyskawiczne płatności"; "Pamiętaj, że nie wszystkie metody są wspierane dla polskiej waluty" [C-blik]. Enabled in the merchant's own Stripe dashboard. | **No / not documented.** "We have a direct integration with Stripe that accepts credit cards, Google Pay, and Apple Pay." [A-pay]. "AllBooked's payment processing is powered by Stripe Connect, meaning we're able to offer payment processing in every country Stripe operates in." [A-faq]. P24/BLIK/PayU never mentioned. |

### Source list — Task A

Bookero
- [B-cennik] https://www.bookero.pl/cennik
- [B-funkcje] https://www.bookero.pl/funkcje
- [B-faq] https://www.bookero.pl/faq
- [B-secure] https://www.bookero.pl/news/bezpieczne-oplacanie-rezerwacji-poznaj-systemy-i-funkcje-wspierajace-proces
- [B-payform] https://www.bookero.pl/news/wybor-formy-platnosci-z-poziomu-formularza-rezerwacyjnego
- [B-cart] https://www.bookero.pl/news/koszyk-uslug-i-jego-zastosowanie-w-formularzu-rezerwacyjnym
- [B-param] https://www.bookero.pl/news/dodawanie-dodatkowych-parametrow-rezerwacji-nie-widocznych-dla-klientow
- [B-param-price] https://www.bookero.pl/news/dodawanie-cen-do-parametrow-rezerwacji
- [B-rules] https://www.bookero.pl/news/zastosowanie-regul-rezerwacji-w-praktyce
- [B-rules-price] https://www.bookero.pl/news/stworzenie-zaawansowanego-cennika-za-pomoca-regul-cen
- [B-integracja] https://www.bookero.pl/integracja (no API/export/webhooks mentioned)
- [B-conf] https://www.bookero.pl/news/system-rezerwacji-sal-konferencyjnych-dlaczego-go-potrzebujesz (names the "projektor nie został zarezerwowany razem z salą" pain; does not describe a fix)

Calendesk
- [C-cennik] https://calendesk.com/pl/cennik/
- [C-prepay] https://calendesk.com/pl/help/jak-dzialaja-przedplaty-dla-rezerwacji
- [C-res] https://calendesk.com/pl/help/czym-sa-etykiety-grupy-oraz-zasoby
- [C-service] https://calendesk.com/pl/help/jak-dodac-usluge
- [C-client] https://calendesk.com/pl/help/jak-klienci-moga-zarzadzac-rezerwacjami
- [C-clients] https://calendesk.com/pl/help/jak-zarzadzac-klientami
- [C-blik] https://calendesk.com/pl/blog/system-rezerwacji-z-platnosciami-blik-wsparcie-dla-nowej-metody-w-calendesk
- [C-zapier] https://calendesk.com/pl/blog/calendesk-zapier-otwieramy-sie-na-ponad-3000-integracji
- [C-api] https://api.calendesk.com/docs
- [C-stripe] https://calendesk.com/pl/help/czym-jest-system-platnosci-stripe-oraz-jak-go-podlaczyc-do-platformy-calendesk (describes creating a Stripe sub-account; silent on methods/fees/refunds)
- [C-panel] https://calendesk.com/pl/help/jak-stworzyc-panel-do-logowania-dla-klienta (silent on whether booking needs an account)

AllBooked (help centre is shared with Skedda at support.skedda.com)
- [A-pricing] https://www.allbooked.com/pricing
- [A-pp] https://www.allbooked.com/platform/pricing-payments
- [A-faq] https://www.allbooked.com/faqs
- [A-howto] https://www.allbooked.com/how-to-book
- [A-music] https://www.allbooked.com/solutions/music-studio-booking-software
- [A-addons] https://support.skedda.com/en/articles/13633554-add-ons-allbooked
- [A-pay] https://support.skedda.com/en/articles/6076125-booking-payments
- [A-price] https://support.skedda.com/en/articles/105740-pricing-rules
- [A-share] https://support.skedda.com/en/articles/105725-space-sharing
- [A-export] https://support.skedda.com/en/articles/105786-export-or-print-booking-data
- [A-user] https://support.skedda.com/en/articles/105724-using-the-scheduler-as-a-regular-user
- [A-zapier] https://support.skedda.com/en/articles/105758-skedda-allbooked-zapier-introduction

---

## B. Payment rails check (Stripe docs)

### B1. Stripe Connect + Express in Poland (platform and connected accounts)

**Yes, both sides.**

- Platform side — Express accounts page: "Platforms in Australia, Austria, Belgium, Brazil, Bulgaria, Canada, Croatia, Cyprus, the Czech Republic, Denmark, Estonia, Finland, France, Germany, Greece, Hong Kong, Hungary, Ireland, Italy, Japan, Latvia, Lithuania, Luxembourg, Malta, Mexico, the Netherlands, New Zealand, Norway, **Poland**, Portugal, Romania, Singapore, Slovakia, Slovenia, Spain, Sweden, Switzerland, Thailand, the United Kingdom, and the United States can create Express accounts for most countries Stripe supports."
  https://docs.stripe.com/connect/express-accounts
- Connected-account side — "Express connected account availability … Select one of the available countries when you create an Express connected account." List includes **PL**.
  https://docs.stripe.com/connect/accounts
- Individual / sole trader: the create-account example uses `business_type=individual` with `type=express` (https://docs.stripe.com/connect/express-accounts). Onboarding flow "is currently localized in … Polish".
- Caveat: Stripe now labels typed accounts as legacy: "Stripe recommends that you use controller properties instead of account types. If you want to use account types, we recommend Express or Standard connected accounts". New platforms are pointed at Accounts v2 / controller properties (https://docs.stripe.com/connect/accounts). "There's an additional cost for using Express or Custom connected accounts."

### B2. Przelewy24 and BLIK on Checkout + Connect

**Yes, both, on Checkout and with Connect; PLN required for BLIK, EUR/PLN for P24.**

Przelewy24 — https://docs.stripe.com/payments/p24
- "Business location: AT, AU, BE, BG, CA, CH, CY, CZ, DE, DK, EE, ES, FI, FR, GB, GI, GR, HK, HR, HU, IE, IT, JP, LI, LT, LU, LV, MT, MX, NL, NO, NZ, **PL**, PT, RO, SE, SG, SI, SK, US"
- "Account type: ✓ Merchant, ✓ Platform or marketplace (Connect)"
- "Buyer location: PL / Presentment currency: EUR, PLN / … Minimum amount: 0.50 EUR"
- Products: "✓ Checkout ✓ Payment Links ✓ Payment Element … ✓ Connect"; APIs: "✓ PaymentIntents ✗ PaymentIntents with setup_future_usage ✗ SetupIntents ✓ CheckoutSessions"
- Customer must complete "within one hour of checkout".
- **Website requirements** for the P24 capability: "Must clearly display the business address. Must display the tax identification number. Must display the business registration number. Must clearly indicate the return and refund policy. Must display a privacy policy. Must display terms of service."
- **MCC caveats** relevant to studios: "7333 | Commercial Photography, Art and Graphics | Restricted" and "7299 | Miscellaneous General Services | Restricted" ("Restricted MCCs may be supported, but require additional information at account creation"); "6513 | Real Estate Agents and Managers - Rentals | Prohibited" and "Real estate management and brokerage services" prohibited — the connected account's MCC must not land in the rental bucket.
- Per-charge-type table (direct / destination / on_behalf_of) for P24: **not documented** on the Connect support page (https://docs.stripe.com/payments/payment-methods/payment-method-connect-support has no P24 section). Capability page: "To enable connected accounts to accept a payment method for direct charges or charges with `on_behalf_of`, you must request that payment method's capability for those accounts." and lists `p24_payments` for Express/Custom ("Generally available: Yes"). https://docs.stripe.com/connect/account-capabilities

BLIK — https://docs.stripe.com/payments/blik
- "Customer locations: Poland / Presentment currency: PLN / … Connect support: Yes / Dispute support: Yes / Manual capture support: No / Refunds / Partial refunds: Yes / Yes"
- Business locations list includes **PL**. Product support: "Connect, Checkout, Payment Links, Elements".
- Connect: "Set the `blik_payments` capability to `active` on your platform account, and on any connected accounts you want to enable BLIK for."
- Charge-type table (descriptor / merchant name source): "Direct → Connected Account; Destination → Platform; Separate charge and transfer → Platform; Destination (with `on_behalf_of`) → Connected Account; Separate charge and transfer (with `on_behalf_of`) → Connected Account" — i.e. all three charge types and `on_behalf_of` are listed.
- BLIK code "valid for 2 minutes; customers have 60 seconds to authorize".

### B3. Refunds for P24 / BLIK

- P24: "Refunds: ✓ Partial refunds ✓ Full refunds / Submission window: 180 days / Processing time: 3 business days". "You have up to 180 days from the original payment to submit a refund". "Refunds for P24 payments are asynchronous and take up to 3 business days to complete. P24 refunds can't be canceled." Refund is "a separate credit to the customer's bank account … never issued as a reversal." Disputes: "✗ Partial disputes ✗ Full disputes". https://docs.stripe.com/payments/p24
- BLIK: "BLIK supports full and partial refunds. Depending on the bank, refunds are processed immediately or within a couple of hours." Refund time limit: **not documented**. Disputes exist: "You must submit the requested information within 12 calendar days." https://docs.stripe.com/payments/blik

### B4. What the platform pays (Poland)

Connect pricing (https://stripe.com/en-pl/connect/pricing), when the platform handles pricing (Express/Custom):
- "9zł per monthly active account" — "An account is active in any month payouts are sent to its bank account or debit card."
- "0.25% + 1.35zł per payout sent"
- Account debits "1.4% of debit volume"; cross-border payouts "Starting at 0.25% of payout volume"
- When Stripe handles pricing (Standard accounts): "No fees for your platform".

Transaction fees, Poland (https://stripe.com/en-pl/pricing and https://stripe.com/pl/pricing/local-payment-methods):
- Cards: "1.5% + 1.00zł" standard EEA cards; "1.9% + 1.00zł" premium EEA cards; "2.5% + 1.00zł" UK cards; "3.25% + 1.00zł" international cards; "+ 2%" if currency conversion.
- **BLIK "1.6% + 1.00zł"**; **Przelewy24 "1.9% + 1.00zł"**; +2% for currency conversion on either.
- Disputes "90.00zł" per dispute (countered fee refunded if won). Instant Payouts "1%" (min 2.00zł).
- With `on_behalf_of` on indirect charges: "the country of the connected account is used to determine the country specific fees charged to your platform account." https://docs.stripe.com/connect/charges

### B5. Connected account as merchant of record, platform never holds the money

**Charge type: direct charges** (Checkout Session created with the `Stripe-Account` header).

- MoR rule: "Direct charges: The merchant of record is the connected account." / "Indirect charges using the `on_behalf_of` parameter: The merchant of record is the connected account. However, if a connected account's balance becomes negative, your platform is ultimately responsible for covering any losses." / "Indirect charges without using the `on_behalf_of` parameter: The merchant of record is the platform." https://docs.stripe.com/connect/merchant-of-record
- Funds flow for direct: "You create a charge on your connected account, so the payment appears in the connected account's balance, not in your platform's balance." … "Funds always settle in the country of the connected account." … "Refunds and chargebacks reduce the connected account's balance." https://docs.stripe.com/connect/charges
- Checkout mechanics: `curl https://api.stripe.com/v1/checkout/sessions -H "Stripe-Account: {{CONNECTEDACCOUNT_ID}}" … -d "payment_intent_data[application_fee_amount]=123"`; "`Stripe-Account`: This header indicates a direct charge for your connected account. The connected account's branding is used in Checkout". https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted
- Destination + `on_behalf_of` also makes the studio MoR, but the money still transits the platform: "You create a charge on your platform, so the payment appears in your platform's balance." — so it does **not** satisfy "platform never holds client money". https://docs.stripe.com/connect/charges
- **Caveats for direct charges on Express:**
  - "Direct charges aren't recommended for legacy v1 Express and Custom accounts. Switch to v2 accounts, or use destination charges with these accounts instead." https://docs.stripe.com/connect/charges
  - "Using direct charges on legacy Express or Custom accounts charges connected accounts directly at standard sticker rates rather than billing the platform. For pricing control, use destination charges instead." https://docs.stripe.com/connect/accounts
  - "We recommend using direct charges for connected accounts that have access to the full Stripe Dashboard." https://docs.stripe.com/connect/direct-charges
  - "Your connected accounts must have the card_payments capability active in order to use direct charges." Payment-method capabilities (`p24_payments`, `blik_payments`) must be requested per account for direct / `on_behalf_of`.
  - Direct charges have "limited visibility at the platform level" — PaymentIntents live on the connected account; "Direct charges don't show in exports".

### B6. Authorize-now-capture-later / SetupIntent holds

- **Cards: yes**, incl. Checkout. "specify `capture_method` as `manual` when creating the Checkout Session." Authorization validity (card-not-present, customer-initiated): "Visa 7 days, Mastercard 7 days, American Express 7 days, Discover 7 days"; "Usually, an authorization for an online card payment is valid for 7 days. To increase the validity period, you can place an extended hold". No Poland-specific restriction documented. Per-method mixing: "`payment_method_options[card][capture_method]=manual`" places only cards on hold. https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- **Przelewy24: no.** "Payment captures: ✗ Manual capture ✗ Partial capture"; "✗ SetupIntents"; "✗ PaymentIntents with setup_future_usage"; "Recurring payments: ✗ Not supported". https://docs.stripe.com/payments/p24
- **BLIK: no manual capture** ("Manual capture support: No"). Saving BLIK for later off-session charges is described but flagged preview: "Recurring payments: Yes (Private preview)"; "Deferred intent support: Client-side confirmation only (Private preview)"; "Stripe supports saving a BLIK payment method … SetupIntent with `usage` set to `off_session`." https://docs.stripe.com/payments/blik
- Implication: a "hold" on P24/BLIK is impossible; post-session extras on those rails mean a second payment request. Card SetupIntent (card on file) is the documented route for later charges; a 7-day auth cannot cover a session booked weeks ahead.

---

## Verdicts

### (a) Kill rule — do Bookero / Calendesk visibly do questions 1–4 at ≤ 200 PLN/month?

| | Q1 multi-resource w/ conflict check | Q2 parent/child blocking | Q3 partial deposit + balance | Q4 post-booking charges | All four? |
|---|---|---|---|---|---|
| **Bookero** (19.90–89.90 PLN netto) | No — add-ons are form parameters with no availability; cart = separate bookings | Not documented | Not documented (full prepay or cash on site) | Not documented | **No** |
| **Calendesk** (197 PLN netto Standard) | Partial — quantity-limited resources attached to a service, conflict-checked, not client-selectable | Not documented | No — prepayment = full service price | Not documented | **No** |

**Kill rule not triggered.** Neither Polish incumbent documents partial deposits with a tracked balance, post-session charges on the same booking, or parent/child space blocking. Calendesk is the closer one on Q1 (real resource quantities) and already sits at 197 PLN netto, i.e. the market already pays ~200 PLN for a resource-aware appointment tool. Both do time-limited holds (Q5) and P24/BLIK (Q9), so those are table stakes, not differentiators.

AllBooked (for reference) does Q1, Q2 (Space Sharing) and Q4 (charge card on file in Stripe, edit add-ons, batch invoice) but not a true partial deposit, has no documented unpaid-hold timer, no P24/BLIK, requires Business ($149) for add-ons, and is priced in USD at 3–7x the Polish tools.

### (b) Stripe Connect Express + P24/BLIK for a Polish sole-trader studio — viable?

**Yes, with caveats.**

1. Poland is on both the platform list and the Express connected-account list; `business_type=individual` is the documented JDG shape; onboarding is localized in Polish.
2. P24 and BLIK work on Checkout and Connect, PLN presentment, partial refunds supported (P24: 180-day window, ~3 business days; BLIK: near-instant, no window documented). Request `p24_payments` / `blik_payments` per connected account.
3. Cost to the platform: 9 zł per active account per month + 0.25% + 1.35 zł per payout, on top of BLIK 1.6% + 1 zł / P24 1.9% + 1 zł / cards 1.5% + 1 zł.
4. "Never hold client money" = **direct charges** (studio is MoR, funds settle in the studio's balance). But Stripe says direct charges "aren't recommended for legacy v1 Express" and bills sticker rates to the studio — so build on **Accounts v2 / controller properties** (Stripe-hosted onboarding + Express-style dashboard) rather than literal `type=express`, or accept destination + `on_behalf_of` (studio is MoR, but money transits the platform balance and the platform eats negative balances).
5. P24 capability has website requirements (address, NIP, registration number, refund policy, ToS, privacy) and MCC 7333 "Commercial Photography" is **Restricted** (extra info at account creation); rental MCCs (6513) are **Prohibited** for P24 — set MCC deliberately.
6. Holds: cards only (7-day auth, or SetupIntent card-on-file for later charges). No manual capture or SetupIntent on P24; BLIK saved-payment is private preview. Overtime/damage collection therefore = card on file or a second P24/BLIK payment link, not an authorization.
