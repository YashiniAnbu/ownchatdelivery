# End-to-End Implementation Prompt — Chat Delivery Rider Assignment & Live Tracking System

*Use this as a single, complete prompt/spec to hand to a developer or an AI coding assistant (e.g., Claude Code) to build the entire feature end-to-end.*

---

## Project Context

I'm building a chat-based delivery/ride app. I need a complete backend implementation covering: address geocoding, Google Maps URL resolution, rider location storage, distance calculation, rider assignment (Nearest, Round Robin, Load Balancer), trip state management, live tracking, precalculation, and cron jobs. Build this as a working Node.js/Express service, implemented in the stage order given at the end.

No Haversine or custom distance-math formulas anywhere — all proximity logic uses Redis geospatial commands.

---

## 1. Geocoding for Address (Forward Geocoding)

Implement a service that takes a plain address string and returns coordinates using the **Google Geocoding API**.

- Endpoint: `POST /api/trips/resolve-location` accepting `{ address }`.
- Call the Geocoding API with the address + API key.
- From the response, extract and return:
  - `lat`, `lng` from `geometry.location`
  - `formatted_address` (standardized address text)
  - `place_id` (store this too — lets you re-fetch the same place later without re-geocoding)
  - `address_components` (city/state/postal breakdown — use this to validate the address falls inside your serviceable area)
- **Ambiguous addresses**: if multiple results come back, decide and implement one behavior consistently — either auto-select the top (highest-confidence) result, or return the top 3-5 candidates and let the customer confirm which one.
- **Component restriction**: bias/restrict the geocoding request to the relevant country/region so a common place name doesn't match somewhere irrelevant.
- **Caching**: cache geocode results keyed by the normalized address string (e.g., in Redis or a `geocode_cache` table) with a reasonable TTL, so frequently-requested addresses (popular landmarks, common pickup points) don't re-trigger a paid API call.
- **Reverse geocoding**: also implement the inverse — given `lat, lng`, call the Geocoding API's reverse mode and return a human-readable address, for cases like labeling the rider's live position or a pin the customer drops on a map.

## 2. Google Maps URL Resolution (with Geocoding as fallback)

Extend the same `resolve-location` endpoint to also accept `{ mapsUrl }`.

- If the URL is shortened (`maps.app.goo.gl/...`, `goo.gl/...`), follow the redirect first to get the real, expanded URL.
- Try extracting coordinates directly from the expanded URL:
  - `@lat,lng` pattern
  - `q=lat,lng` pattern
- If neither pattern matches — meaning the URL only contains a place name — extract that name and pass it through **the same forward geocoding function from Section 1** as a fallback. Do not duplicate geocoding logic; reuse the one function.

## 3. Store Once, Never Re-Resolve

When a trip is created:
- Resolve pickup location (address or Maps URL) → store `{ lat, lng, formatted_address }` on the trip row.
- Resolve drop location the same way, separately → store on the trip row too.
- All downstream logic (rider shortlisting, Distance Matrix, tracking, ETA) reads these stored values only. Never call geocoding again for the same trip.

## 4. Rider Location Storage (Redis GEO)

- Riders send live GPS pings (`lat`, `lng`, `heading`, `speed`, `timestamp`) every 3–5 seconds over WebSocket.
- Write every rider's current position into Redis using `GEOADD`.
- Maintain a short-TTL "last seen" key per rider, refreshed on every ping, to detect stale/offline riders automatically.
- Implement nearby-rider search using Redis `GEOSEARCH ... BYRADIUS ... ASC` — this is the sole mechanism for finding riders near a pickup point, already sorted by distance. No custom distance math anywhere.

## 5. Distance Matrix Integration

- Implement a service that calls the **Google Distance Matrix API**, batching all shortlisted rider coordinates as `origins` (pipe-separated) against the pickup point as a single `destination`, in one request.
- Use `departure_time=now` for traffic-aware `duration_in_traffic`.
- Cache identical origin/destination batches for ~15 seconds to avoid duplicate calls in quick succession.
- Fallback: if the call fails or times out, use the distance-sorted order already returned by Redis's `GEOSEARCH` so assignment is never blocked.

## 6. Rider Assignment Strategies

Implement all three, each built on the Redis-GEOSEARCH shortlist (10–20 nearby riders):

- **Nearest** — Distance Matrix on the shortlist → sort by `duration_in_traffic` → assign the fastest rider.
- **Round Robin** — rotate through shortlisted available riders in turn (track "last assigned rider" per zone) → call Distance Matrix once for the selected rider just to produce a real ETA.
- **Load Balancer** — combine each shortlisted rider's Distance Matrix ETA with a precomputed load score (active trip count, distance traveled today) into a weighted combined score → assign the best-scoring rider.

Make the strategy selectable per trip or per system config (`nearest | round_robin | load_balancer`).

## 7. Trip State Machine

```
ASSIGNED → RIDER_EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → IN_TRIP → COMPLETED
(any active state) → CANCELLED
```

- Enforce valid transitions only.
- Auto-trigger `ARRIVED_AT_PICKUP` when the rider's live position is within ~50 meters of the stored pickup coordinates, using Redis's geo-distance command (not manual math).
- Broadcast every state change immediately to the trip's live channel.

## 8. Live Tracking (WebSocket)

- Each trip has its own channel (e.g., `trip:{tripId}`).
- Every rider location ping for an active trip:
  1. Updates Redis (source of truth for reconnects).
  2. Pushes live to the trip's channel for the customer app.
  3. Is periodically (not every single ping) persisted to a permanent breadcrumb history table.
- Recalculate ETA every 30–60 seconds, or on significant route deviation — not on every ping.
- If no ping arrives for 60 seconds, mark tracking as "connection lost" instead of freezing the last marker silently.

## 9. Precalculation Layer

- Precompute zone-to-zone average travel durations (divide the map into zones, e.g. H3 hexagons or geohash) for rough estimates before any live API call.
- Precompute and cache each rider's load score on a schedule so the Load Balancer strategy reads it instantly.
- Learn peak-hour traffic multipliers from historical completed trips (compare estimated vs actual duration).
- Maintain the geocode cache from Section 1 as an ongoing precalculation asset.

## 10. Cron Jobs

- Stale rider cleanup — every 1 min.
- Rider load score recalculation — every 2–5 min.
- Zone distance matrix refresh — daily, low-traffic hours.
- Traffic multiplier aggregation — every hour.
- Trip breadcrumb archival to cold storage — daily.
- Stale "ASSIGNED" trip detection and auto-reassignment trigger — every 30 sec.

## 11. Database Schema

Provide tables for:
- `riders` (id, name, phone, status, last_ping_at)
- `trips` (id, customer_id, rider_id, pickup_lat/lng/address, drop_lat/lng/address, assignment_strategy, status, estimated_duration/distance, timestamps)
- `trip_location_history` (trip_id, lat, lng, recorded_at)
- `rider_load_scores` (rider_id, active_trip_count, distance_today, last_calculated_at)
- `round_robin_state` (zone_id, last_assigned_rider_id)
- `geocode_cache` (address_text, lat, lng, formatted_address, last_used_at)

## 12. API Surface

- `POST /api/trips/resolve-location` — `{ address }` or `{ mapsUrl }` → `{ lat, lng, formatted_address }`
- `POST /api/trips` — create trip with resolved pickup/drop
- `POST /api/trips/:id/assign` — run configured strategy, return rider + ETA
- `POST /api/trips/:id/transition` — move trip through state machine
- `GET /api/trips/:id` — fetch trip status/details
- WebSocket in: `rider:location`
- WebSocket out: `location:update`, `trip:status`

## 13. Non-Functional Requirements

- No custom Haversine/manual distance formulas anywhere — Redis GEO commands only.
- Every external Google API call (Geocoding, Distance Matrix) must be minimized via caching and never called speculatively.
- Every external API call must have a graceful fallback so a provider outage never blocks trip creation, assignment, or tracking.
- Cron-driven precomputation keeps the live request path fast — assignment/tracking endpoints must not perform expensive work inline.

---

## Build Order (implement and confirm each stage before moving to the next)

1. Geocoding for address (Section 1) + Maps URL resolution with geocoding fallback (Section 2)
2. Trip creation with stored pickup/drop coordinates (Section 3)
3. Redis rider location storage + GEOSEARCH shortlist (Section 4)
4. Distance Matrix integration with caching/fallback (Section 5)
5. Assignment strategies — all three (Section 6)
6. Trip state machine + WebSocket live tracking (Sections 7–8)
7. Cron jobs (Section 10)
8. Precalculation layer (Section 9)

For each stage, show the relevant schema/config used, confirm it works, and note any assumptions made before proceeding to the next stage.
