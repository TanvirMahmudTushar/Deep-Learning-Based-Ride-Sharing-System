# Project Proposal: Deep Learning–Driven Ride-Sharing App

## Abstract

This project will build a working web-based ride-sharing platform that uses deep learning to cut passenger wait times, reduce driver cancellations and make pricing more predictable. Existing platforms such as Uber and Pathao still struggle with surge pricing, last-minute cancellations, inaccurate arrival estimates and weak safety monitoring, and these problems are sharper in South Asian cities with dense traffic and poor map data.

The system pairs a conventional web application (a user portal for passengers, a rider portal for bike, CNG and car riders, an admin dashboard and a backend API) with four learning components: spatio-temporal demand forecasting, graph-based ETA prediction, cancellation-aware matching and trip anomaly detection for safety. Models will be trained first on public trip datasets, such as the NYC Taxi & Limousine Commission records, and then tested on simulated local trips. Each model will be compared against simple baselines so the gain from deep learning is measured, not assumed.

The web platform is already built (Next.js with shadcn/ui, a FastAPI backend, SQLite and the Groq API), with the non-deep-learning baseline running behind each of the four components and a trip simulator for testing. Training and plugging in the deep learning models is the next phase.

## Background and problem statement

Ride-sharing is now a daily transport option in Bangladeshi cities, but passengers and drivers both report recurring problems that current apps handle with simple rules rather than learned predictions.

| Who is affected | Problem | Why current apps fall short |
| --- | --- | --- |
| Passengers | Long, unpredictable waits | Drivers are not positioned ahead of demand peaks |
| Passengers | Sudden surge pricing | Prices react to shortages after they happen, with no explanation |
| Passengers | Drivers cancel after accepting | Matching ignores how likely a driver is to cancel a given trip |
| Passengers | Inaccurate arrival times | Estimates rely on distance and map speeds that miss local traffic |
| Passengers and drivers | Safety incidents go unnoticed | Few automatic checks for route deviation or unusual stops |
| Drivers | Idle time between trips | No guidance on where demand will appear next |

Local conditions make these harder: narrow and unnamed streets, mixed traffic of cars, motorbikes and CNGs, and patchy mobile internet. The research question is whether deep learning models can measurably improve wait time, cancellation rate and ETA accuracy over the rule-based methods commonly used today.

## Objectives

The main objective is a working prototype in which deep learning models drive dispatch, ETA and safety decisions, with their benefit measured against baselines.

1. Build a functional web platform with a user portal, a rider portal (separate rider types for bikes, CNGs and cars), an admin dashboard and a backend API supporting booking, live tracking, matching and trip completion.
2. Develop a demand forecasting model that predicts ride requests per zone for the next 15–60 minutes.
3. Develop an ETA prediction model that outperforms distance-based estimates.
4. Develop a cancellation prediction model and use it in a matching algorithm that lowers expected cancellations.
5. Develop a trip anomaly detector that flags route deviations and unusual stops for safety review.
6. Evaluate every model against a non-deep-learning baseline and report the results.

Secondary objectives, if time allows: transparent price explanations shown to passengers, and lightweight, mobile-friendly pages that work on slow connections.

## Proposed system

The system is one Next.js web app (shadcn/ui components, dark theme) with three role-based portals (user, rider and admin), a FastAPI backend with a SQLite database, and a separate prediction layer the backend calls for forecasts, ETAs, match scores and anomaly checks. Each prediction component currently runs its baseline method; the deep learning models will replace them behind the same interface. The backend also calls the Groq API for text features (price explanations, alert summaries and a passenger assistant); these sit outside the four prediction models.

Three roles use the platform, and riders are registered by vehicle type (bike, CNG or car), so a trip request is only matched to riders of the requested vehicle type.

| Role | Who | Main actions |
| --- | --- | --- |
| User | Passenger | Book a ride, choose a vehicle type, track the trip, see the reason for the price, rate the ride |
| Rider | Driver of a bike, CNG or car | Register a vehicle, go online, accept or decline trips, complete trips |
| Admin | Platform operator | Verify riders, monitor live trips and safety alerts, view demand forecasts |

Architecture (portals talk only to the backend, which calls four prediction models and two external APIs):

```
 User portal            Rider portal             Admin dashboard
 (passengers)           (bike, CNG, car)         (monitor trips, alerts)
      \                       |                        /
       \_____________ Next.js + shadcn/ui ____________/
                              |   REST, polled every 2 s
              Backend API (FastAPI, Python)
        booking, matching, pricing, live tracking, trip records
                 /            |                         \
 Data, maps, simulation        External APIs                Prediction layer
 - SQLite (SQLAlchemy)         - Groq: price reasons,       - Demand forecasting
 - OpenStreetMap + OSRM          alert summaries,           - ETA prediction
 - Trip simulator (drives        assistant                  - Cancellation model
   simulated riders)           - Open-Meteo: hourly           (feeds matching)
                                 weather                    - Anomaly detection
                                                            Baselines now; PyTorch
                                                            models replace them later
```

Users, riders and admins never call the models or external APIs directly: the backend asks the prediction layer for forecasts, ETAs, match scores and anomaly checks, calls Groq for generated text and fetches hourly weather from Open-Meteo. The portals poll the backend every two seconds for live trip status and rider positions, which is simpler than a push channel and fast enough for a prototype.

A built-in trip simulator stands in for riders' phones. Simulated riders accept offers after a short delay and drive real OSRM road routes, sending GPS pings at a configurable speed-up (10× by default). A configurable share of trips (15% by default) gets an injected detour or long stop, so the anomaly detector can be tested. Riders using the portal can also hand their trip to the simulator ("auto-drive").

## Deep learning components

Four models form the intelligence layer; each serves one problem from the problem statement. In the code they all implement one `PredictionModel` interface and are looked up from a registry, so a trained model replaces its baseline without changes to matching, pricing or alerts.

| Component | Problem it addresses | Inputs | Proposed model | Output |
| --- | --- | --- | --- | --- |
| Demand forecasting | Long waits, driver idle time, surge pricing | Past requests per zone, time of day, day of week, weather, holidays | Spatio-temporal graph neural network (e.g. ST-GCN) or LSTM over a zone grid | Expected requests per zone, next 15–60 min |
| ETA prediction | Inaccurate arrival times | Route segments, time, historical speeds, distance, vehicle type | Graph neural network over the road network, or a Transformer over route sequences | Predicted travel time in minutes |
| Cancellation-aware matching | Drivers cancelling after accepting | Driver history, pickup distance, trip length, destination zone, time, vehicle type | Feed-forward network predicting cancellation probability, used inside the matching score | Ranked driver list per request |
| Trip anomaly detection | Unnoticed safety incidents | Live GPS trace versus expected route, stop durations, speed | LSTM autoencoder trained on normal trips | Anomaly score and alert |

The deep learning models are not built yet. Until they are, each component runs the baseline from the evaluation plan, so the full app works end to end and every later model has a measured reference point.

| Component | Baseline running now |
| --- | --- |
| Demand forecasting | Historical average requests per zone, vehicle type and local hour (weekday vs. weekend), fitted on whole past days, +15% when raining; 15-minute slots for the next hour, refreshed every 15 minutes |
| ETA prediction | Road distance ÷ typical speed per vehicle type (bike 22, CNG 16, car 14 km/h), ×1.35 at peak hours |
| Cancellation-aware matching | Fixed-weight logistic score on pickup distance, the rider's smoothed cancellation history, trip length and peak hour; riders ranked by pickup ETA + 20 min × P(cancel). The nearest-driver baseline is the same ranking with the penalty set to 0 |
| Trip anomaly detection | Flags a GPS ping more than 0.5 km from the planned route, or a stop longer than 3 minutes |

Demand forecasts also feed a smoother pricing rule, so price changes can be shown to passengers with a short reason (for example, high expected demand in the area). The fare is max(minimum, base + per km × distance + per minute × predicted ETA) × multiplier. The multiplier rises in 0.1 steps once expected requests exceed 1.2× the free riders within 3 km, and is capped per vehicle type by the admin.

## System design diagrams

### Use case diagram

```mermaid
flowchart LR
  User(["User (Passenger)"])
  Rider(["Rider (bike / CNG / car)"])
  Admin(["Admin"])
  Groq(["Groq API (external LLM)"])

  subgraph SYS["Ride-sharing platform (web)"]
    direction TB
    subgraph PASS["Passenger functions"]
      u_auth(["Register / log in"])
      u_book(["Book a ride (choose vehicle type)"])
      u_fare(["View fare estimate and price reason"])
      u_track(["Track trip live"])
      u_cancel(["Cancel ride"])
      u_rate(["Rate ride"])
      u_chat(["Chat with AI assistant"])
    end
    subgraph RID["Rider functions"]
      r_veh(["Register vehicle and documents"])
      r_online(["Go online / offline"])
      r_accept(["Accept or decline trip"])
      r_complete(["Navigate and complete trip"])
    end
    subgraph ADM["Admin functions"]
      a_verify(["Verify riders"])
      a_monitor(["Monitor live trips"])
      a_alerts(["Review safety alerts"])
      a_forecast(["View demand forecast"])
      a_rules(["Manage pricing rules"])
    end
    subgraph ML["Intelligent services (included)"]
      m_match(["Match rider (cancellation-aware)"])
      m_eta(["Predict ETA"])
      m_demand(["Predict demand"])
      m_anom(["Detect trip anomaly"])
      m_explain(["Explain price (Groq)"])
      m_summ(["Summarize alert (Groq)"])
    end
  end

  User --- u_auth & u_book & u_fare & u_track & u_cancel & u_rate & u_chat
  Rider --- r_veh & r_online & r_accept & r_complete & u_auth
  Admin --- a_verify & a_monitor & a_alerts & a_forecast & a_rules & u_auth

  u_book -. include .-> m_match
  m_match -. include .-> m_eta
  u_fare -. include .-> m_explain
  u_fare -. include .-> m_eta
  a_monitor -. include .-> m_anom
  a_alerts -. include .-> m_summ
  a_forecast -. include .-> m_demand

  m_explain --- Groq
  m_summ --- Groq
  u_chat --- Groq
```

Passengers, riders and admins each have their own functions; the Groq API acts as an external actor for price explanations, alert summaries and the assistant.

### Data flow diagrams

The Level 0 diagram shows the platform as one process and the outside parties it exchanges data with.

```mermaid
flowchart LR
  User["User (Passenger)"]
  Rider["Rider (bike / CNG / car)"]
  Admin["Admin"]
  Groq["Groq API (LLM)"]
  Weather["Open-Meteo weather API"]
  P0(("0<br/>Ride-sharing<br/>platform"))

  User -->|"login details, ride request, rating"| P0
  P0 -->|"fare estimate, price reason, matched rider, live trip status"| User
  Rider -->|"vehicle and license details, live location, accept or decline, trip completion"| P0
  P0 -->|"trip offers, navigation details"| Rider
  Admin -->|"rider verification decisions, pricing rules"| P0
  P0 -->|"safety alerts, demand forecasts, trip reports"| Admin
  P0 -->|"prompts (no personal data)"| Groq
  Groq -->|"generated text"| P0
  Weather -->|"hourly weather data"| P0
```

Level 1 splits the platform into six processes (accounts, request and matching, pricing, trip tracking, demand forecasting, admin monitoring) and seven data stores.

```mermaid
flowchart TB
  User["User (Passenger)"]
  Rider["Rider"]
  Admin["Admin"]
  Groq["Groq API"]
  Weather["Open-Meteo weather API"]

  P1(("1.0 Manage accounts and authentication"))
  P2(("2.0 Request and match ride"))
  P3(("3.0 Price trip and explain fare"))
  P4(("4.0 Track trip, detect anomalies, rate"))
  P5(("5.0 Forecast demand"))
  P6(("6.0 Admin monitoring and control"))

  D1[("D1 Accounts: profiles, riders, vehicles")]
  D2[("D2 Trips and ratings")]
  D3[("D3 Trip locations")]
  D4[("D4 Zones and demand forecasts")]
  D5[("D5 Pricing rules")]
  D6[("D6 Safety alerts")]
  D7[("D7 Weather history")]

  User -->|"login / registration"| P1
  Rider -->|"vehicle and license details"| P1
  P1 -->|"session token"| User
  P1 <-->|"account records"| D1

  User -->|"ride request"| P2
  D1 -->|"online riders"| P2
  P2 -->|"trip offer"| Rider
  Rider -->|"accept / decline"| P2
  P2 -->|"matched rider details"| User
  P2 -->|"trip record"| D2
  P2 <-->|"chat text / parsed request"| Groq

  P2 -->|"trip details"| P3
  D5 -->|"pricing rules"| P3
  D4 -->|"demand forecast"| P3
  P3 -->|"fare estimate and price reason"| User
  P3 <-->|"prompt / explanation"| Groq

  Rider -->|"live location, trip completion"| P4
  User -->|"rating"| P4
  P4 -->|"live trip status"| User
  P4 -->|"location pings"| D3
  D2 -->|"trip route"| P4
  P4 -->|"trip status, rating"| D2
  P4 -->|"anomaly alerts"| D6

  D2 -->|"past trips"| P5
  Weather -->|"hourly weather"| D7
  D7 -->|"weather features"| P5
  P5 -->|"forecasts"| D4

  Admin -->|"verification decisions, pricing rules"| P6
  P6 -->|"alerts, forecasts, trip reports"| Admin
  P6 -->|"rider status"| D1
  P6 -->|"pricing rules"| D5
  D6 -->|"open alerts"| P6
  D4 -->|"forecasts"| P6
  D2 -->|"trip statistics"| P6
  P6 <-->|"alert text / summary"| Groq
```

### Entity-relationship diagram

```mermaid
erDiagram
    PROFILES ||--o| RIDERS : "is a"
    PROFILES ||--o{ TRIPS : "books"
    RIDERS ||--o{ VEHICLES : "owns"
    RIDERS ||--o{ TRIPS : "drives"
    RIDERS ||--o{ TRIPS : "is offered"
    VEHICLES ||--o{ TRIPS : "used in"
    ZONES ||--o{ TRIPS : "pickup zone"
    ZONES ||--o{ DEMAND_FORECASTS : "forecast for"
    TRIPS ||--o{ TRIP_LOCATIONS : "records"
    TRIPS ||--o| RATINGS : "receives"
    TRIPS ||--o{ MATCH_SCORES : "scored in"
    RIDERS ||--o{ MATCH_SCORES : "candidate"
    TRIPS ||--o{ SAFETY_ALERTS : "raises"
    PROFILES ||--o{ SAFETY_ALERTS : "reviews (admin)"

    PROFILES {
        text id PK "UUID"
        text full_name
        text phone
        text email "unique"
        text password_hash "bcrypt"
        text role "user, rider, admin"
        datetime created_at
    }
    RIDERS {
        text id PK
        text profile_id FK
        text license_no
        text status "pending, verified, suspended"
        boolean is_online
        boolean is_simulated
        real current_lat
        real current_lng
        datetime last_seen
    }
    VEHICLES {
        text id PK
        text rider_id FK
        text vehicle_type "bike, cng, car"
        text plate_no
        text model
        boolean verified
    }
    ZONES {
        int id PK
        text name
        real center_lat
        real center_lng
    }
    TRIPS {
        text id PK
        text user_id FK
        text rider_id FK
        text vehicle_id FK
        int pickup_zone_id FK
        text vehicle_type_requested
        real pickup_lat
        real pickup_lng
        text pickup_address
        real drop_lat
        real drop_lng
        text drop_address
        text status "requested, accepted, ongoing, completed, cancelled"
        real distance_km
        real fare_estimate
        real fare_final
        real price_multiplier
        text price_reason
        real predicted_eta_min
        real pickup_eta_min
        real actual_duration_min
        text cancelled_by "user, rider, system"
        text cancel_reason
        text offered_rider_id FK "rider currently offered"
        datetime offered_at
        text route_json "planned route [[lat, lng], ...]"
        text approach_json "rider to pickup route"
        boolean auto_drive
        real sim_progress_km
        datetime requested_at
        datetime accepted_at
        datetime started_at
        datetime completed_at
    }
    TRIP_LOCATIONS {
        int id PK
        text trip_id FK
        real lat
        real lng
        real speed_kmh
        datetime recorded_at
    }
    RATINGS {
        text id PK
        text trip_id FK "unique"
        int stars
        text comment
        datetime created_at
    }
    MATCH_SCORES {
        text id PK
        text trip_id FK
        text rider_id FK
        real pickup_eta_min
        real cancel_probability
        real score
        int rank
        text status "candidate, offered, declined, expired, accepted"
    }
    DEMAND_FORECASTS {
        int id PK
        int zone_id FK
        text vehicle_type
        datetime forecast_for
        real predicted_requests
        text model_version
        datetime created_at
    }
    SAFETY_ALERTS {
        text id PK
        text trip_id FK
        text reviewed_by FK
        text alert_type "route_deviation, long_stop"
        real anomaly_score
        text details_json
        text summary "Groq summary"
        text status "open, reviewed, closed"
        datetime created_at
    }
    PRICING_RULES {
        int id PK
        text vehicle_type "unique"
        real base_fare
        real per_km
        real per_min
        real min_fare
        real max_multiplier
    }
    WEATHER_HOURLY {
        int id PK
        datetime observed_at "unique"
        real temperature_c
        real precipitation_mm
        text source
    }
```

The database is SQLite, accessed through SQLAlchemy, so moving to PostgreSQL later only means changing the connection URL. IDs are UUID strings, and all timestamps are stored in UTC and shown in Dhaka time (UTC+6). Vehicle type on the `VEHICLES` table drives matching. Model outputs are stored in `MATCH_SCORES` and `DEMAND_FORECASTS`, and `model_version` records which model (baseline or deep learning) produced each forecast. Routes are stored as JSON on the trip, because SQLite has no PostGIS; distance-to-route checks are done in Python. `WEATHER_HOURLY` holds city-wide hourly weather from Open-Meteo for the demand model, so it has no foreign keys.

### Class diagrams

Domain classes (accounts, vehicles, trips, locations, ratings, alerts, zones):

```mermaid
classDiagram
    direction TB
    class Account {
        <<abstract>>
        +UUID id
        +String fullName
        +String phone
        +String email
        +login()
        +logout()
    }
    class Passenger {
        +requestRide(pickup, drop, vehicleType) Trip
        +cancelRide(trip)
        +rateRide(trip, stars)
    }
    class Rider {
        +RiderStatus status
        +Boolean isOnline
        +goOnline()
        +acceptTrip(trip)
        +completeTrip(trip)
    }
    class Admin {
        +verifyRider(rider)
        +reviewAlert(alert)
        +setPricingRule(rule)
    }
    class Vehicle {
        +UUID id
        +VehicleType type
        +String plateNo
        +Boolean verified
    }
    class Trip {
        +UUID id
        +TripStatus status
        +Decimal fareEstimate
        +Float predictedEtaMin
        +assignRider(rider)
        +start()
        +complete()
        +cancel(by)
    }
    class Location {
        +Float lat
        +Float lng
    }
    class Rating {
        +Int stars
        +String comment
    }
    class SafetyAlert {
        +String alertType
        +Float anomalyScore
        +AlertStatus status
    }
    class Zone {
        +Int id
        +String name
    }
    class DemandForecast {
        +VehicleType vehicleType
        +DateTime forecastFor
        +Float predictedRequests
    }
    class VehicleType {
        <<enumeration>>
        BIKE
        CNG
        CAR
    }
    class TripStatus {
        <<enumeration>>
        REQUESTED
        ACCEPTED
        ONGOING
        COMPLETED
        CANCELLED
    }
    Account <|-- Passenger
    Account <|-- Rider
    Account <|-- Admin
    Rider "1" --> "1..*" Vehicle : owns
    Passenger "1" --> "0..*" Trip : books
    Rider "1" --> "0..*" Trip : drives
    Trip "1" *-- "2" Location : pickup and drop
    Trip "1" o-- "0..1" Rating : receives
    Trip "1" --> "0..*" SafetyAlert : raises
    Admin "1" --> "0..*" SafetyAlert : reviews
    Zone "1" --> "0..*" DemandForecast : has
    Vehicle ..> VehicleType
    Trip ..> TripStatus
```

Service and model classes (the four predictors implement one `PredictionModel` interface and currently hold the baseline methods; `GroqClient` wraps the API; `TripSimulator` drives simulated riders through the same `TripService` the portals use):

```mermaid
classDiagram
    direction TB
    class PredictionModel {
        <<interface>>
        +predict(features) Float
    }
    class DemandForecaster {
        +forecast(zone, horizon) DemandForecast
    }
    class EtaPredictor {
        +predictEta(route, vehicleType) Float
    }
    class CancellationPredictor {
        +cancelProbability(trip, rider) Float
    }
    class AnomalyDetector {
        +score(trace, expectedRoute) Float
    }
    class MatchingService {
        +matchRider(trip) Rider
    }
    class PricingService {
        +estimateFare(trip) Decimal
        +explainPrice(trip) String
    }
    class AlertService {
        +checkTrip(trip)
        +summarize(alert) String
    }
    class GroqClient {
        -String apiKey
        +complete(prompt) String
    }
    class TripService {
        +createTrip(user, pickup, drop, vehicleType) Trip
        +accept(trip, rider)
        +start(trip)
        +complete(trip)
        +cancel(trip, by)
        +recordLocation(trip, point, speed)
    }
    class TripSimulator {
        +tick()
    }
    PredictionModel <|.. DemandForecaster
    PredictionModel <|.. EtaPredictor
    PredictionModel <|.. CancellationPredictor
    PredictionModel <|.. AnomalyDetector
    MatchingService ..> CancellationPredictor : uses
    MatchingService ..> EtaPredictor : uses
    PricingService ..> DemandForecaster : uses
    PricingService ..> GroqClient : uses
    AlertService ..> AnomalyDetector : uses
    AlertService ..> GroqClient : uses
    TripService ..> MatchingService : uses
    TripService ..> PricingService : uses
    TripService ..> AlertService : uses
    TripSimulator ..> TripService : drives
```

## Methodology, datasets and tech stack

The work follows an iterative approach: build the core app first, then add one model at a time, training on public data and validating in a simulated city environment.

**Datasets and data sources.** There is no public Bangladeshi ride-hailing trip dataset, so models are trained on public data from other cities and then tested on simulated local trips. All sources below were checked for availability.

| Source | Used for | Access |
| --- | --- | --- |
| NYC TLC Trip Record Data (Parquet; yellow, green, FHV and high-volume FHV) | Demand forecasting, ETA | `https://d37ci6vzurychx.cloudfront.net/trip-data/{type}_tripdata_{YYYY}-{MM}.parquet` |
| Chicago Taxi Trips (2024 onward; times rounded to 15 minutes) | Second city to test generalisation | `https://data.cityofchicago.org/d/ajtu-isnz` |
| OpenStreetMap, Bangladesh extract (Geofabrik, about 339 MB, ODbL 1.0) | Road graph, routing, simulator map | `https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf` |
| Open-Meteo Historical Weather API (hourly temperature and precipitation) | Weather input to demand model | `https://archive-api.open-meteo.com/v1/archive` |
| Own trip simulator on the Bangladeshi road map | Matching, cancellation and anomaly experiments | Built in this project (implemented) |
| Synthetic seed trips (14 days, about 400 a day, over 12 Dhaka zones) | Demo data for the dashboard and the demand baseline | Generated by the project's seed script |

The synthetic seed trips follow a realistic daily shape (morning and evening peaks, quieter weekends) and include slower zones the distance-based ETA baseline does not know about. They exist so the app and baselines can run before real data is wired in, and they will not be used to train or evaluate the final models.

The Pathao food dataset on GitHub (323,139 records) has no coordinates or timestamps, so it cannot be used for trip modelling. Chicago's licence is not stated on its portal page and Open-Meteo's terms for non-commercial use should be confirmed before the final report.

**Groq API (language-model services).** Groq provides an OpenAI-compatible API (base URL `https://api.groq.com/openai/v1`, key stored in the `GROQ_API_KEY` environment variable on the backend only). It is used for text tasks, not for the core predictions, which stay in the four prediction models. The backend calls it through the official `groq` Python SDK.

| Use | Model | Purpose |
| --- | --- | --- |
| Price explanation | `llama-3.1-8b-instant` | Turns the pricing inputs (demand forecast, time, weather) into a one-sentence reason shown to the passenger |
| Safety alert summary | `llama-3.3-70b-versatile` | Summarises an anomaly score, route deviation and stop duration for the admin |
| Passenger assistant | `openai/gpt-oss-20b` (131,072-token context) | Answers questions about a trip and helps fill a booking |

Free-tier limits are low (the documentation lists about 30 requests per minute and 1,000 per day for the gpt-oss models), so the backend caches repeated explanations, sends no personal data in prompts and falls back to a fixed template if Groq is unavailable. Model names and limits change, so they should be checked at `console.groq.com` before use. Unsupported parameters include `logprobs`, `logit_bias` and `n` greater than 1.

**Tech stack.**

| Layer | Tools | Status |
| --- | --- | --- |
| Frontend (user, rider and admin portals) | Next.js 16 (React 19), shadcn/ui components with a dark theme, Tailwind CSS, SWR for data fetching and polling, Recharts for dashboard charts | Built |
| Backend API | FastAPI (Python 3.12), Pydantic validation | Built |
| Database | SQLite through SQLAlchemy 2 (portable to PostgreSQL) | Built |
| Authentication | Email and password with bcrypt hashing; JWT bearer tokens; role checks (user, rider, admin) on every endpoint | Built |
| Live updates | Portals poll the API every 2 seconds | Built |
| Maps and routing | OpenStreetMap tiles, Leaflet (map display), OSRM public server (road routes, with a straight-line fallback when offline) | Built |
| Weather | Open-Meteo hourly forecast API, stored in `WEATHER_HOURLY` | Built |
| Language model | Groq API (Llama and gpt-oss models), with template fallbacks | Built |
| Prediction models | Baselines behind a `PredictionModel` interface | Built |
| Deep learning | PyTorch, PyTorch Geometric | Planned |
| Model serving | Trained models loaded inside the FastAPI backend (ONNX export if memory is tight) | Planned |
| Testing | pytest end-to-end API tests (booking, matching, offers, alerts, admin, roles) with an isolated database and no network | Built |
| Hosting | Runs locally today; a free-tier deployment (for example Vercel for the frontend and Render for the backend) is optional for the demo | Planned |
| Version control | GitHub | In use |

## Evaluation plan

Each model succeeds only if it beats a simpler baseline on held-out data; system-level gains are measured in the trip simulator.

| Component | Baseline | Metrics |
| --- | --- | --- |
| Demand forecasting | Historical average per zone and hour; gradient boosting (XGBoost) | MAE, RMSE |
| ETA prediction | Distance ÷ average speed; OSRM estimate | MAE in minutes, MAPE |
| Cancellation prediction | Logistic regression | ROC-AUC, F1 |
| Matching (system level) | Nearest available driver | Average passenger wait time, cancellation rate, driver idle time |
| Anomaly detection | Fixed distance-from-route threshold | Precision, recall on injected anomalous trips |

Several of these baselines already run inside the app: the historical-average demand forecast, the distance ÷ speed ETA and the distance-from-route threshold. Matching uses a fixed-weight logistic score for cancellation risk, and the nearest-driver baseline is the same ranking with the cancellation penalty set to zero. The admin dashboard reports live figures, such as the 7-day ETA mean absolute error and the cancellation rate, which the deep learning models will be compared against. The remaining baselines (gradient boosting for demand, the OSRM time estimate, and a fitted logistic regression for cancellations) will be trained offline alongside the deep learning models.

The app itself is covered by automated end-to-end API tests (booking, matching, offer expiry, cancellation, safety alerts, rider verification, pricing and role checks). Response time under simulated load will be measured during the evaluation phase.

## Timeline

The project fits one 16-week semester, with a checkpoint at week 10 that guarantees a complete minimum project.

| Phase | Weeks | Work | Status |
| --- | --- | --- | --- |
| Research | 1–2 | Literature review, requirements, dataset preparation | Requirements and data sources identified in this proposal |
| Core app | 3–6 | Web portals and authentication, backend, maps, live tracking | Done, ahead of schedule, including baselines, Groq features and the trip simulator |
| Core models | 7–10 | Demand forecasting, ETA prediction | Not started |
| **Gate: minimum scope met (end of week 10)** | | Core app plus demand and ETA models working | |
| Stretch models | 11–13 | Cancellation model, anomaly detection | Not started |
| Evaluation | 14–16 | Baseline tests, report, demo | Baselines already measurable in the app |

If the week-10 gate slips, the stretch models are dropped and the remaining time goes to evaluation and the report.

**Implementation status.** The parts of the project that do not involve deep learning are complete:

- **Passenger portal:** choose pickup and drop-off on the map or by area; compare bike, CNG and car fares with an explained price; book; track the rider live; cancel; rate; view trip history; chat with the Groq assistant, which can fill in a booking.
- **Rider portal:** register with a vehicle and licence, wait for verification, go online, receive offers with a 30-second timer, accept or decline, start and complete trips, view earnings, rating and cancellation rate.
- **Admin dashboard:** live platform stats and map, rider verification and suspension, safety alerts with Groq summaries and review status, demand forecasts per zone and per hour (with a table view), and editable pricing rules.
- **Backend:** cancellation-aware matching that offers a trip to one rider at a time, with fallback to the next candidate on decline or timeout; demand-based pricing with explanations; route-deviation and long-stop alerts; weather ingestion; and the trip simulator.

The remaining work is the deep learning: data pipelines for NYC TLC and Chicago, training the four models, swapping them into the prediction registry, and the evaluation against the baselines.

## Expected outcomes, risks and limitations

The project will deliver a working prototype, trained demand and ETA models (plus cancellation and anomaly models if the week-10 gate is met) and a written comparison showing where deep learning helps and where simpler methods are enough.

**Deliverables.**

- Web platform with user portal, rider portal, admin dashboard and backend API (built; source code on GitHub, optionally deployed for the demo).
- Trained demand and ETA models with evaluation results; cancellation and anomaly models as stretch deliverables.
- A trip simulator for testing dispatch strategies (built).
- A final report and live demonstration.

**Risks and mitigation.**

| Risk | Mitigation |
| --- | --- |
| No real local trip data | Train on public datasets; validate on simulated trips over a real Bangladeshi road map |
| Models trained on New York data may not transfer to Bangladeshi traffic | Report this as a limitation; test transfer on a second city (Chicago); design models to retrain on local data later |
| Deep learning may not beat simpler baselines on small data | Treat this as a valid finding and report it honestly |
| Scope too large for one semester | Core app and two models (demand, ETA) are the minimum; matching and anomaly detection are stretch goals |
| Free-tier hosting limits if deployed (servers sleep when idle and have limited memory) | Train offline (laptop or Colab), serve small exported models such as ONNX, and warm the server before demos; the demo can also run locally |
| SQLite allows only one writer at a time, and the simulator and API write together | Write-ahead logging and a busy timeout are enabled, which is enough for a prototype; move to PostgreSQL by changing the connection URL if load testing shows contention |
| Public OSRM and OpenStreetMap tile servers have usage limits and no uptime guarantee | Routes are cached and fall back to a straight-line estimate; for heavier use, self-host OSRM on the Bangladesh extract and use a tile provider with a key |

The prototype will not process real payments or carry real passengers; safety and pricing features are demonstrated in simulation only.

## Conclusion

This project tests a practical question: whether deep learning can make ride-sharing faster, fairer and safer in conditions like Bangladesh's, compared with the simple rules most apps use. It combines full-stack app development with applied deep learning and honest evaluation, and its results could guide local ride-sharing services. I would welcome your guidance on scope and supervision.
