# Real Estate Listings Intelligence

**Every primary-market listing posted in Egypt's developer and broker WhatsApp groups, turned into one clean, searchable, always-current database.**

_Last updated: 27 October 2026 · Status: core system, operator console and firm dashboard built and tested; first live run with real groups is next._

---

## The problem

Egypt's primary real estate market runs on WhatsApp. Developers and brokers post new launches, price lists, payment plans and price changes in hundreds of groups, all day, in Arabic, English and Franco-Arabic, as text, flyers, screenshots and PDFs.

For a brokerage firm, that means:

- **Agents spend hours reading groups** instead of selling.
- **The same unit appears dozens of times**, posted by different brokers with slightly different numbers.
- **Prices change quietly**, in a reply under a post from last week, and nobody notices.
- **Nothing is searchable.** "3-bedroom apartments in New Cairo under 8 million, delivery 2028" can't be answered without scrolling.
- **Information disappears.** Messages get buried; units sell and nobody says so.

## The solution

A system that sits in those groups, reads every listing, and turns it into a structured database that firms can search, export and get alerts from.

Firms get **fresher and cleaner data than they could collect themselves**, without anyone reading a single group.

---

## Why it stands out

### 1. One unit, not fifty posts

When the same apartment is posted in ten groups by ten brokers, the system recognises it and keeps **one record**, linked to every post that mentioned it. Agents see the real supply, not the noise, and can see how widely a unit is being marketed.

### 2. Full price history and price changes

Every change in price or payment plan is recorded with its date and source. When a broker replies "the price is now 7 million" under an old post, the system **finds the unit that reply is about and updates it**, keeping the old price in the history. Firms can see which units dropped in price and when.

### 3. Knows what's sold and what's gone quiet

"Sold" replies mark the unit as sold. Listings nobody has posted for 45 days are automatically marked **stale**, and come back to life if they are posted again. The database reflects what is actually available today.

### 4. Reads flyers, price sheets and brochures, not just text

Most new launches arrive as a designed flyer, a screenshot of a price table or a PDF brochure. The system **reads the text and tables inside images and PDFs**, including Arabic, and turns every row of a price sheet into its own listing: one flyer with four unit types becomes four searchable units. Excel price lists are read directly. A caption the broker sends right after the flyer is read together with it, so nothing is split.

It is also economical: PDFs that contain real text are read for free, and only scanned pages go to the AI. Every image read is logged with its cost and time.

### 5. Built for how Egyptians actually write

Listings are messy: "٣٫٥ مليون", "مليون ونص", "3.5M", "من 120 ل 180 متر", "على 8 سنين ربع سنوي", Arabic and Western digits, Franco-Arabic, typos in project names. The system understands all of these. It already knows **17 cities and areas, 20 major developers and 57 projects, under 360 different spellings**, and it learns new ones.

### 6. Accuracy you can trust

- **The AI reads, the system calculates.** AI copies what the message says; all numbers, currencies, payment calculations and dates are worked out by tested code, so the AI cannot make arithmetic mistakes.
- **Nothing is invented.** Every value must actually appear in the original message. If the AI produces something that isn't there, it is thrown out and the listing is flagged.
- **Images get the same safeguards as text**: the AI first copies the text out of the image, then the same checks apply.
- **Every listing gets a confidence score** and plain-English reasons when something needs a human check ("no price stated", "project name unclear").
- **Accuracy is measured, not assumed.** A test set of real messages checks every field before any change to the AI or its instructions goes live.

### 7. Fits the way firms already work

Exports come out **exactly in the firm's existing Excel template** (the 26-column Primary Units sheet), ready to use. Prices are shown in **Egyptian pounds**; units priced in dollars are converted at a rate the operator sets, and marked as such.

### 8. Never misses a message

Messages are saved the moment they arrive, before any processing. If the AI is slow, down or out of quota, nothing is lost: listings wait and are processed later. If the system restarts, it catches up on its own. Old messages can be **re-processed at any time** with improved logic, without creating duplicates.

### 9. Privacy by design

- The people posting are **never identified**: no names, no phone numbers are stored. Each sender is reduced to an anonymous code.
- Phone numbers and e-mails inside messages are **removed before any text reaches an AI service**.
- Only groups the operator chooses are read; private chats are never stored.
- Built with Egypt's Personal Data Protection Law (Law 151 of 2020) in mind; a formal legal review is scheduled before onboarding paying firms.

### 10. Low running cost, no lock-in

- Runs on **free tiers of three independent AI providers** (Google Gemini first, then Groq, then OpenRouter), switching automatically if one is busy or down.
- Changing provider is a settings change, not a rebuild, so the business is never tied to one vendor's pricing.
- The whole system runs on **one small server**, with one database that holds everything and is easy to back up.

### 11. Run from a browser, no technical staff needed

The operator runs everything from a simple web console, without touching a server:

- **Connect the WhatsApp number** by scanning a QR code on screen.
- **Choose which groups to read** with a tick box, and mark each as a developer or broker group.
- **Check flagged listings side by side**: the original post or flyer on the left, the extracted listing on the right. Fix a field, approve, or throw it out, in a few seconds.
- **Every correction makes the system more accurate to test**: each reviewed listing automatically becomes a new item in the accuracy test set, so the more the operator reviews, the better the system is measured.
- **Teach it new names**: add a new project or a new spelling ("ميفيدا", "MV") and future posts using it are recognised; merge duplicates with one click.
- **See the health of the business at a glance**: messages read per day, success rate, AI cost, listings waiting for review, and anything that failed, with a retry button.
- **Set the dollar rate and download the Excel** export from the same place.

Access is protected by a password login with attempt limits, and every sign-in and change is recorded in an audit log.

### 12. A dashboard firms can use from day one, in Arabic or English

Each firm gets its own login and a dashboard built for brokers:

- **Search the whole market in seconds**: area, developer, project, unit type, bedrooms, size, price, delivery year, down payment, installment years, finishing, ready to move, and "price dropped". Type a project's name in Arabic or English, or its nickname, and it is found.
- **Every price in Egyptian pounds**, with **price per m²** to compare across projects; dollar listings are converted at the owner's rate.
- **A full page per listing**: all details, its price history, how many times it was reposted, and the original post and flyer.
- **Private notes** on any listing ("client Ahmed is interested"), seen only by the firm's own team.
- **Saved searches**, ready for instant alerts when the chat bot goes live.
- **Exports** of any search to the firm's Excel template or CSV.
- **Share cards**: one tap gives a clean summary for a client, as WhatsApp text or a ready-made image, with nothing that points back to the source groups.
- **Arabic or English**, chosen by each person; Arabic reads right to left, as it should.
- **The firm runs its own team**: its admin adds agents with a link sent on WhatsApp, and removes them in one click.

**Each firm is walled off from the others.** Listings are shared, but a firm can never see another firm's notes, searches or people; this is checked by automated tests on every part of the system. Firms never see who posted a listing, which group it came from, or the broker's contact details, so the service can't be bypassed.

**For the operator:** create a firm, set its user limit and contract dates, and see each firm's searches and exports for billing. Suspending a firm, or reaching its contract end date, cuts access instantly.

### 13. Built to be operated and trusted

- **More than 400 automated tests** check the system on every change, including complete runs through the console and the firm dashboard, and attempts to cross from one firm into another.
- A complete operator manual covers setup from zero, daily operations and what to do when something goes wrong.
- Every AI decision is logged (what was asked, what came back, cost and time), so any listing can be traced back to its source message.

---

## What firms will get

| For agents                                                                                             | For firm managers                                           |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Search every live listing by city, project, developer, unit type, bedrooms, size, price, delivery year | One clean source instead of agents reading groups           |
| See price history and which units dropped in price                                                     | Excel exports in their own template                         |
| Save searches and get alerts on WhatsApp or Telegram when a matching unit appears or drops in price    | Usage per agent, per firm                                   |
| Ask the bot in plain Arabic or English: "شقة 3 غرف التجمع تحت 8 مليون"                                 | Private notes and saved searches that other firms can't see |

---

## Progress

| Stage                                   | What it delivers                                                                      | Status                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Foundation                              | Secure, documented base; market knowledge of cities, developers and projects          | ✅ Built and tested                                                               |
| Capture                                 | Reads the chosen WhatsApp groups and never loses a message                            | ✅ Built and tested · live run waits for the dedicated number                     |
| Understanding listings                  | Turns text listings into structured data in the firm's template, with accuracy checks | ✅ Built and tested · accuracy figures after the first real-message test set      |
| Flyers and PDFs                         | Reads images, price-sheet screenshots and PDF brochures                               | ✅ Built and tested · accuracy figures after the first real-flyer test set        |
| One unit, price history, sold and stale | Duplicates merged, price changes tracked, sold and inactive units marked              | ✅ Built and tested                                                               |
| Operator console                        | Connect the number, choose groups, review flagged listings, from a browser            | ✅ Built and tested · pairing a real number waits for the dedicated number        |
| Firm dashboard                          | Multi-firm search, saved searches, exports, Arabic and English                        | ✅ Built and tested · first paying firm after plans, pricing and the legal review |
| Chat bot and alerts                     | Ask in plain language on WhatsApp, Telegram backup, instant alerts                    | ⏭ Next                                                                            |
| Launch                                  | Hosted server, daily backups, monitoring, usage reports                               | Planned                                                                           |

**Honest status:** everything marked "Built and tested" works and is covered by automated tests. It has not yet run on live group traffic. That first live run, and published accuracy figures from a test set of real messages, are the next milestones.
