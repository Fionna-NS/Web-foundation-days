# TicketHub: System Design

TicketHub is a website that sells tickets for concerts and events. This document follows the six-part framework: requirements, estimates, API, data model, architecture, and trade-offs. It also explains how the design stops two people from buying the same seat.

---

## 1. Requirements

### Functional requirements
1. Users can register, log in and manage their account.
2. Users can browse and search events by name, artist, city and date.
3. Users can view an event page with a seat map showing which seats are available.
4. Users can select seats and temporarily hold them while they pay.
5. Users can pay and receive a confirmed ticket (with a QR code) by email and in their account.
6. Users can view their past orders and tickets.
7. Organisers (admin) can create events and set seat prices and the on-sale time.

### Non-functional requirements
| Requirement | Target |
|---|---|
| **Correctness** | A seat is **never** sold to two people. This is the most important rule. |
| **Availability** | Browsing 99.9% of the time. Checkout stays up during a big sale. |
| **Latency** | Event and seat-map pages under 300 ms; seat hold under 500 ms. |
| **Scalability** | Handle a sudden spike of about 10x to 100x normal traffic for popular sales. |
| **Durability** | A paid order is never lost (data replicated and backed up). |
| **Fairness** | During a rush, people are served in a fair order (first come, first served). |
| **Security** | Passwords hashed, HTTPS everywhere, card data handled only by the payment provider. |

Out of scope: ticket resale, refunds workflow, mobile apps.

---

## 2. Estimates

### Given facts
- 2,000,000 registered users
- Normal day: 50,000 visitors, 10 page views each, 5,000 tickets sold
- Popular concert: 200,000 people try to buy 20,000 seats in the first 10 minutes

### Normal traffic
| Item | Calculation | Result |
|---|---|---|
| Page views per day | 50,000 x 10 | 500,000 |
| Average page views per second | 500,000 / 86,400 | about 6 per second |
| Peak (assume 10x average, evenings) | 6 x 10 | about 60 per second |
| Tickets sold per day | given | 5,000 |
| Average purchases per second | 5,000 / 86,400 | about 0.06 per second |
| Peak purchases per second (10x or more) | | about 1 per second |
| Read : write ratio | 500,000 views : 5,000 sales | about 100 : 1, so **read-heavy** |

A single modest database could handle normal traffic. The hard part is the spike.

### Popular concert on sale (first 10 minutes = 600 seconds)
| Item | Calculation | Result |
|---|---|---|
| People arriving | 200,000 / 600 | about 330 new users per second |
| Requests per user (page, seat map, a few seat tries, checkout) | assume about 10 | 2,000,000 requests in 10 minutes |
| Peak request rate | 2,000,000 / 600 | about 3,300 requests per second |
| With a 3x burst in the first minute | 3,300 x 3 | up to about 10,000 requests per second |
| Seat hold attempts (about 2 per user) | 400,000 / 600 | about 670 per second, higher at the very start |
| Seats available | | 20,000 |
| Demand : supply | 200,000 : 20,000 | **10 : 1**, so about 90% of people will lose |
| Best-case sales rate | 20,000 / 600 | about 33 sales per second |

Spike versus normal: about 3,300 requests per second against about 60 normally, which is **roughly 50x or more**. Many people will fight over the same best seats, so the hold step has heavy contention.

### Comparison: normal day vs big sale
| Measure | Normal | Big sale peak | Difference |
|---|---|---|---|
| Requests per second | about 60 (peak) | about 3,300 (up to 10,000 in the first minute) | 50x to 150x |
| Purchases per second | about 1 (peak) | up to about 33 | about 30x |
| Seat hold attempts per second | under 1 | about 670 or more | about 1,000x |
| Duration | all day | 10 minutes | very short and sharp |
| Traffic pattern | spread out, mostly reads | all at once, mostly writes on the same rows | contention on popular seats |

Compared with the *average* normal rate (about 6 requests per second), the sale is roughly 550 times busier, all arriving within minutes.

Only 20,000 seats exist, so at most 20,000 orders can succeed. The other 180,000 people will not get a ticket and must be told quickly (a clear "sold out" or "seat taken" message) so they stop refreshing and adding load.

Conclusion: normal traffic is easy for one app server and one database. The big sale is a different problem: a short burst that is far bigger than normal and focused on the same 20,000 rows. We design for the spike, not the average.

### Storage
| Item | Calculation | Result |
|---|---|---|
| Orders/tickets per year | 5,000 x 365 (plus popular sales) | about 2 million |
| Size per ticket row | about 200 bytes | about 0.4 GB per year |
| Users | 2,000,000 x 1 KB | about 2 GB |
| Seat inventory per event | 20,000 seats x 100 bytes | about 2 MB per event |

Storage is small. The challenge is **concurrency**, not size.

---

## 3. API Design

REST over HTTPS, JSON bodies, authentication with a bearer token (JWT) for everything except browsing.

| # | Method and path | Purpose | Success | Errors |
|---|---|---|---|---|
| 1 | `POST /auth/login` | Log in, returns a token | 200 | 401 bad credentials |
| 2 | `GET /events?city=&date=&q=&page=` | Search and list events | 200 | 400 bad query |
| 3 | `GET /events/{eventId}` | Event details | 200 | 404 not found |
| 4 | `GET /events/{eventId}/seats` | Seat map with status (available, held, sold) | 200 | 404 |
| 5 | `POST /events/{eventId}/queue` | Join the waiting room for a popular sale | 202 with a queue position | 429 too many requests |
| 6 | `POST /events/{eventId}/holds` | Hold chosen seats for 10 minutes | 201 | **409 seat already taken**, 401, 403 not admitted from queue |
| 7 | `DELETE /holds/{holdId}` | Release held seats | 204 | 404 |
| 8 | `POST /orders` | Pay for a hold and create the order | 201 | 402 payment failed, 409 hold expired |
| 9 | `GET /orders/{orderId}` | Order status | 200 | 404 |
| 10 | `GET /users/me/tickets` | List my tickets | 200 | 401 |

Example: hold seats

```
POST /events/42/holds
Authorization: Bearer <token>
{ "seatIds": [1201, 1202] }

201 Created
{ "holdId": "h_9f3", "seatIds": [1201, 1202], "expiresAt": "2026-11-20T19:10:00Z" }

409 Conflict
{ "error": "SEAT_TAKEN", "seatIds": [1202] }
```

Example: pay

```
POST /orders
Idempotency-Key: 7c1e...
{ "holdId": "h_9f3", "paymentToken": "tok_abc" }

201 Created
{ "orderId": 5531, "status": "PAID", "tickets": [ ... ] }
```

The `Idempotency-Key` header means a retried request (double click, network retry) cannot create two orders or charge twice.

---

## 4. Data Model

Relational database (PostgreSQL), because ticket sales need transactions and strict consistency.

### Tables
**users**: `id (PK)`, `email (UNIQUE, NOT NULL)`, `password_hash`, `name`, `created_at`

**venues**: `id (PK)`, `name`, `city`, `capacity`

**seats**: `id (PK)`, `venue_id (FK -> venues)`, `section`, `row`, `number`, `UNIQUE(venue_id, section, row, number)`
The physical seats of a venue.

**events**: `id (PK)`, `venue_id (FK -> venues)`, `title`, `artist`, `starts_at`, `on_sale_at`, `status`

**event_seats**: `event_id (FK -> events)`, `seat_id (FK -> seats)`, `price`, `status (AVAILABLE | HELD | SOLD)`, `held_by (FK -> users, nullable)`, `hold_expires_at (nullable)`, `version`, **`PRIMARY KEY (event_id, seat_id)`**
The inventory of each seat for each event. This is the table where seats are protected from double-selling.

**orders**: `id (PK)`, `user_id (FK -> users)`, `event_id (FK -> events)`, `total_amount`, `status (PENDING | PAID | FAILED)`, `idempotency_key (UNIQUE)`, `created_at`

**tickets**: `id (PK)`, `order_id (FK -> orders)`, `event_id`, `seat_id`, `qr_code`, **`UNIQUE (event_id, seat_id)`**

**payments**: `id (PK)`, `order_id (FK -> orders)`, `provider_ref`, `amount`, `status`, `created_at`

### Relationships
- One venue has many seats and many events (1:N).
- One event has many event_seats; one seat appears in many event_seats, one per event (so `event_seats` is a join table between events and seats, M:N).
- One user has many orders (1:N). One order has many tickets (1:N) and one or more payments.
- Each ticket points to exactly one (event, seat), and that pair can appear only once.

### Index
`event_seats (event_id, status)` makes "show available seats for this event" fast.

---

## 5. Architecture

```
                    Users (browser)
                         |
                    +----v-----+
                    |   CDN    |  static files, event images, cached event pages
                    +----+-----+
                         |
                  +------v-------+
                  | Load balancer|
                  +------+-------+
                         |
              +----------v-----------+
              |   API gateway /      |  auth, rate limiting
              |   waiting room       |
              +----------+-----------+
                         |
        +----------------+------------------+
        |                |                  |
+-------v------+  +------v-------+  +-------v-------+
| Event/Search |  | Booking      |  | Order/Payment |
| service      |  | service      |  | service       |
| (read heavy) |  | (holds)      |  |               |
+---+-------+--+  +---+------+---+  +---+-------+---+
    |       |         |      |          |       |
    |   +---v---------v--+   |          |   +---v------------+
    |   |  Redis cache   |   |          |   | Payment        |
    |   | (seat holds,   |   |          |   | provider (ext.)|
    |   |  seat map,     |   |          |   +----------------+
    |   |  queue)        |   |          |
    |   +----------------+   |          |
    |                        |          |
+---v------------------------v----------v---+     +---------------+
|        PostgreSQL (primary)               +---->| Read replicas |
|  users, events, event_seats, orders...    |     +---------------+
+---------------------+---------------------+
                      |
              +-------v--------+      +----------------------+
              | Message queue  +----->| Worker: email, QR    |
              +----------------+      | code, expire holds   |
                                      +----------------------+
```

### Components
- **CDN**: serves images, JavaScript and cached event pages close to the user. It removes most of the read load from our servers, which matters because traffic is about 100:1 reads.
- **Load balancer**: spreads requests over many app servers and removes failed servers.
- **API gateway and waiting room**: checks tokens, applies rate limits, and during a popular sale puts users in a queue and lets them through at a rate the booking service can handle (for example 500 per second). This protects the system from the 200,000-person rush.
- **Event/Search service**: handles browsing, search and event pages. Reads from replicas and cache.
- **Booking service**: handles seat holds. This is the most critical service and the one that enforces "no double sale".
- **Order/Payment service**: turns a valid hold into a paid order, calls the payment provider, and writes tickets.
- **Redis cache**: stores the seat map (very fast reads, cached for only a few seconds so it is never far out of date), the waiting-room queue, and short-lived seat locks. The final check always happens in the database, never in the cache.
- **PostgreSQL primary**: the single source of truth for seat status and orders; all seat writes go here for strong consistency.
- **Read replicas**: serve event and search reads so the primary is free for bookings.
- **Message queue and workers**: do slow work in the background (send email, generate QR codes, release expired holds) so checkout stays fast.
- **Payment provider (external)**: handles card details so we never store them.

### How the architecture survives the big sale
1. **Absorb reads at the edge.** The event page, images and scripts come from the CDN, so most of the 3,300 requests per second never reach our servers.
2. **Throttle with the waiting room.** 200,000 people cannot all hit the booking service at once. The waiting room admits about 500 users per second, so the database sees a steady, safe load instead of a spike. Admission is in join order, which keeps it fair.
3. **Serve the seat map from Redis.** Thousands of people refreshing the map read from memory, not from PostgreSQL.
4. **Filter losers early.** The Redis seat lock rejects most of the 90% who lose a seat before they touch the database.
5. **Keep writes small and correct.** The database only handles the few hundred conditional updates per second that matter, each touching one row.
6. **Scale out the stateless parts.** Extra app servers are added behind the load balancer before the sale (auto-scaling on schedule), since they hold no state.
7. **Move slow work off the critical path.** Emails and QR codes go through the message queue, so checkout stays fast.
8. **Fail safely.** If Redis fails, requests fall back to the database, which is slower but still correct. If a payment fails or a user leaves, the hold expires and the seat is released.

### Purchase flow
1. User joins the waiting room and is admitted.
2. User loads the seat map (from cache) and picks seats.
3. `POST /holds` tries to hold the seats (see section 6).
4. User pays within 10 minutes: `POST /orders`.
5. Payment succeeds, seats become SOLD, tickets are created, email is queued.

---

## 6. How We Prevent Two People Buying the Same Seat

The problem: thousands of people click the same good seat at the same instant. A naive "read the status, then write it" approach lets two people both read AVAILABLE and both succeed. We use **three layers**, and the database is always the final judge.

**Layer 1: atomic conditional update (the main protection).**
Holding a seat is one single SQL statement, not a read followed by a write:

```sql
UPDATE event_seats
SET status = 'HELD', held_by = :userId, hold_expires_at = now() + interval '10 minutes'
WHERE event_id = :eventId AND seat_id = :seatId
  AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at < now()));
```

The database locks the row while this runs, so two simultaneous requests are processed one after the other. The first one changes 1 row. The second finds the status is no longer AVAILABLE, changes **0 rows**, and the API returns **409 SEAT_TAKEN**. 

When a user holds several seats, the same update runs inside one transaction so the hold is all-or-nothing:

```sql
BEGIN;
UPDATE event_seats
SET status = 'HELD', held_by = :userId, hold_expires_at = now() + interval '10 minutes'
WHERE event_id = :eventId AND seat_id IN (1201, 1202)
  AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at < now()));
-- if fewer rows changed than seats requested, someone else got a seat first:
--   ROLLBACK;  and reply 409 Conflict
-- otherwise:
COMMIT;        -- and reply 201 Created
```

Seats are always processed in order of id, which avoids deadlocks between two buyers who want overlapping seats. Expired holds become available again automatically, because the `WHERE` clause treats them like available seats.

**Layer 2: time-limited hold.**
A held seat belongs to one user for 10 minutes. Payment only completes if `held_by` is that user and `hold_expires_at` has not passed:

```sql
UPDATE event_seats SET status = 'SOLD'
WHERE event_id = :e AND seat_id = :s AND held_by = :userId
  AND status = 'HELD' AND hold_expires_at > now();
```

If the user abandons checkout, a worker (and the expiry check above) frees the seat for others. This stops a seat being locked forever without ever being sold.

**Layer 3: unique constraint as a safety net.**
`tickets` has `UNIQUE (event_id, seat_id)`. Even if a bug in our code tried to create two tickets for one seat, the database would reject the second insert.

**Supporting measures.**
- A Redis `SET seat:{event}:{seat} NX EX 600` is tried first. It rejects most losing requests in microseconds, so the database only sees a small part of the 670+ attempts per second. Redis is only a shield; **the database decides**.
- The waiting room limits how many people reach the booking service at once.
- Idempotency keys stop the same payment or order being processed twice.
- If payment fails, the seat returns to AVAILABLE.

Result: for any (event, seat) pair, at most one `HELD` owner at a time and at most one ticket ever.

---

## 7. Trade-offs

**1. Strong consistency (SQL) instead of a faster eventually-consistent store.**
*Chosen:* PostgreSQL with transactions for seat inventory. *Gain:* correctness; no double sales. *Cost:* one primary database is a bottleneck. We reduce the pressure with Redis, replicas, a waiting room, and by sharding by `event_id` if needed (one event's seats live together, so a transaction never crosses shards). We accept this because selling the same seat twice is far worse than being a little slower.

**2. Waiting room (queue) instead of letting everyone in.**
*Gain:* the system stays up under 200,000 people, and the order is fair. *Cost:* users wait, some think the site is slow, and it adds a component to build. Without it, the site could crash and nobody could buy.

**3. 10-minute seat hold.**
*Gain:* people have time to pay and do not lose seats mid-checkout. *Cost:* abandoned holds keep seats unavailable for up to 10 minutes, so some seats look sold when they are not. A shorter hold (for example 5 minutes) frees seats faster but pressures users and breaks slow payments.

**4. Redis in front of the database (two layers).**
*Gain:* handles the burst cheaply. *Cost:* more complexity; Redis and the DB can disagree (for example Redis crashes). That is why the DB stays the source of truth and Redis only speeds things up.

**5. Cached seat map may be slightly stale.**
*Gain:* the seat map is served fast to thousands of people. *Cost:* a user may click a seat that was just taken and get a 409 error. We accept this because the hold step is always checked against the database.
