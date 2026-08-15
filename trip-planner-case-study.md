# Family Trip Planner — Product Case Study

*A working case study draft — fill in the bracketed sections as the project evolves, trim anything that doesn't serve the story you're telling a specific employer.*

## The problem

Planning family trips with young kids from London is high-friction in a specific way: the *opportunity* is well-defined (UK bank holidays create predictable long-weekend windows, and the ~3-month-ahead booking window for flights/stays is a known pattern) but the *matching* against real family constraints — aparthotels with a kitchen, genuinely varied vegetarian food, 1-2 sights/day pacing, stroller logistics — usually means starting from scratch each time. Institutional memory (where we've been, what worked, what didn't) lived in scattered notes, not anywhere useful at decision time.

## The user

One specific family — 2 adults + a toddler, based in London — modeled in enough detail that the "profile" isn't a demo placeholder, it's the actual product being served by every other feature. Built for a real user first; generalizing it into a multi-user product is a distinct, deliberately out-of-scope next step (see Roadmap).

## Approach

Started from an AI-generated MVP scaffold (Claude Cowork), then evaluated it honestly rather than assuming it was final: what actually worked (live bank-holiday tracking, a real architecture, profile-driven AI itinerary generation) versus what was thin (plain UI, no access control, static destination list, no real accommodation/flight data). Built out from there in phases, sequenced by impact vs. effort rather than by what looked most impressive.

## Key product decisions

The interesting part of this project isn't the code — it's the trade-offs. A few worth calling out specifically:

**1. Transparent match scoring over a fabricated percentage.**
An early design brief called for something like "98% match" on destination cards. That number would have been invented — there was no real scoring behind it. Built a real heuristic instead ("5/6 profile-fit criteria met," with the actual criteria shown) that a user can independently verify against the same notes the app is reading. Chose trust and explainability over a more impressive-looking but meaningless figure.

**2. Curated weather data over a live weather API.**
Considered wiring in a live forecast API. Went with curated seasonal norms instead — trips are booked ~3 months out, so a forecast wouldn't be meaningful that far ahead anyway, and it kept the data model consistent with how every other piece of destination content already worked (hand-curated, verifiable, no new external dependency for marginal benefit).

**3. Deep-linking over live price aggregation.**
Real-time flight/hotel pricing needs a paid API (Skyscanner, Amadeus) with real integration cost. Shipped live deep-links into Google Flights, Skyscanner, Booking.com, and Airbnb instead — zero cost, zero key required, and the user still reaches real current prices in one click. A conscious call not to over-build a feature whose marginal value (pricing shown one click earlier) didn't justify the added cost and complexity.

**4. A password gate added, then explicitly removed.**
Added a lightweight access-control layer proactively, since an unauthenticated deployment could let a stray link spend the owner's AI API budget. It became a blocker during active local testing, so — at the user's explicit call — it was fully removed rather than left half-working, with the trade-off (safe to test locally, not yet safe to deploy publicly) documented plainly rather than hidden. Security work is easy to bolt back on later; a frustrating dev loop has a real cost *now*.

**5. AI chat customization sequenced last.**
Of everything requested, a full conversational chat interface was the most eye-catching idea and the most expensive to build well (new interaction pattern, more API calls, message-state handling). Explicitly triaged it to the end of the roadmap, behind smaller, lower-risk wins — the right call even though it was the "coolest" feature on paper.

**6. Propose-and-accept over silent AI writes.**
When a visited-place note gets processed for durable preferences, the AI *proposes* additions to the profile — the user accepts or skips each one individually. Nothing gets silently written to a user's own stated preferences without their say-so, even when the AI is confident.

## What shipped

- Live UK bank-holiday tracking with 3-month planning-window countdowns
- Curated, profile-matched destination shortlist with transparent fit scoring
- Live flight/accommodation search links (Google Flights, Skyscanner, Booking.com, Airbnb)
- Optional live accommodation listings via Google Places (photos, ratings) when configured
- Real landmark photography per destination via Wikipedia's public API
- Interactive map of all live suggestions
- Visited-places tracking with quick sentiment ratings
- AI-generated day-by-day itineraries, grounded in the stored profile
- Notes → profile AI extraction, with human-in-the-loop approval
- AI chat for open-ended, conversational trip customization
- Mobile-first navigation and responsive layout throughout

## What's deferred, and why

- **Public access control** — removed for dev velocity, needs a real solution before any public URL
- **Multi-user support** — the profile model is single-family by design; generalizing it is a distinct product decision (auth, data isolation, onboarding), not a quick add
- **Persistent chat history** — the AI chat currently resets per session by design (kept the scope small); could become durable if usage showed it mattered
- **Live pricing** — still deep-links rather than showing prices inline; would need a real build-vs-buy call against a paid flights/hotels API

## Built with

Claude (chat) for architecture and product decisions; Claude Code for hands-on iteration with live third-party API access (Google Places, Wikipedia, gov.uk bank holidays). [Add: live URL once deployed; screenshots; your own reflection on what you'd do differently.]
