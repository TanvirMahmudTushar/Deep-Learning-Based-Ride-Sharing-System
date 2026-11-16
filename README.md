# Cholo: Deep Learning Based Ride-Sharing System

A web ride-sharing platform for Bangladeshi cities, with separate portals for passengers, riders (bike, CNG and car), admins and support agents. The aim is to cut waits, cancellations and surprise prices with learned predictions, and to measure each model against a simple baseline.

Live app: https://heycholo.vercel.app (the backend runs on a free plan and can take about a minute to wake up).

## What's in it

| Part | What it does |
| --- | --- |
| Passenger portal (`/user`) | Book a ride, see why it costs what it does, track it live, chat with the rider, raise an SOS, pay in cash, rate, save places, review past trips, ask the AI assistant |
| Rider portal (`/rider`) | Sign up with a vehicle (documents are optional), go online, accept or decline offers, complete trips, record cash, see earnings and demand hints |
| Admin dashboard (`/admin`) | Review any documents riders upload, suspend riders, watch live trips and safety alerts, see demand forecasts, set pricing, settle commission payments, approve support agents |
| Support dashboard (`/support`) | Read live and recent trips, alerts and passenger reports, reply with saved replies, close cases |
| Backend (`backend/`) | FastAPI, SQLAlchemy and WebSockets: matching, pricing, payments, alerts and a trip simulator |
| Prediction layer | Four models behind one interface in `backend/app/services/predictors.py`: demand, ETA, cancellation and anomaly detection |

## Screenshots

Taken from a test database filled through the app's own API: about three weeks of trips, ratings, an SOS, reports and cash settlements. The names and numbers are made up.

### Getting started

Anyone can sign up and log in, with no approval step and no phone code.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/01-home.webp" alt="Home page"><br><sub>Home page</sub></td>
<td width="50%"><img src="Docs/screenshots/02-login.webp" alt="Log in"><br><sub>Log in</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/03-register.webp" alt="Sign up as a passenger, rider or support agent"><br><sub>Sign up as a passenger, rider or support agent</sub></td>
<td width="50%"></td>
</tr>
</table>

### Passenger: booking

Fares for every vehicle type, the reason for the price, and free riders shown on the map around the pickup.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/10-passenger-book.webp" alt="Book a ride: fare per vehicle, price reason, riders nearby (coloured dots)"><br><sub>Book a ride: fare per vehicle, price reason, riders nearby (coloured dots)</sub></td>
<td width="50%"><img src="Docs/screenshots/11-passenger-assistant.webp" alt="Assistant turns a sentence into a booking"><br><sub>Assistant turns a sentence into a booking</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/12-passenger-history.webp" alt="Trip history next to the map"><br><sub>Trip history next to the map</sub></td>
<td width="50%"></td>
</tr>
</table>

### Passenger: following a ride

From request to payment. Rider position, chat, share trip and the emergency button are all on the trip panel.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/21-passenger-finding-rider.webp" alt="Finding a rider"><br><sub>Finding a rider</sub></td>
<td width="50%"><img src="Docs/screenshots/22-passenger-rider-on-the-way.webp" alt="Rider on the way, with live position and pickup time"><br><sub>Rider on the way, with live position and pickup time</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/23-passenger-rider-arrived.webp" alt="Rider has arrived, with chat"><br><sub>Rider has arrived, with chat</sub></td>
<td width="50%"><img src="Docs/screenshots/24-passenger-trip-in-progress.webp" alt="Trip in progress"><br><sub>Trip in progress</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/25-passenger-pay-and-rate.webp" alt="Pay in cash, favourite or block the rider, and rate"><br><sub>Pay in cash, favourite or block the rider, and rate</sub></td>
<td width="50%"><img src="Docs/screenshots/26-passenger-rating.webp" alt="Rating the ride"><br><sub>Rating the ride</sub></td>
</tr>
</table>

### Passenger: dashboard

Spending, reviews, favourite riders and saved places.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/13-dashboard-overview.webp" alt="Overview: spending, ratings, frequent destinations"><br><sub>Overview: spending, ratings, frequent destinations</sub></td>
<td width="50%"><img src="Docs/screenshots/14-dashboard-trips.webp" alt="All trips"><br><sub>All trips</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/15-dashboard-reviews.webp" alt="Reviews you gave"><br><sub>Reviews you gave</sub></td>
<td width="50%"><img src="Docs/screenshots/16-dashboard-riders.webp" alt="Favourite and blocked riders"><br><sub>Favourite and blocked riders</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/17-dashboard-places.webp" alt="Saved places"><br><sub>Saved places</sub></td>
<td width="50%"><img src="Docs/screenshots/18-dashboard-account.webp" alt="Account and password"><br><sub>Account and password</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/19-trip-detail.webp" alt="Trip details, with reporting a problem"><br><sub>Trip details, with reporting a problem</sub></td>
<td width="50%"><img src="Docs/screenshots/20-receipt.webp" alt="Receipt, printable as PDF"><br><sub>Receipt, printable as PDF</sub></td>
</tr>
</table>

### Rider

A rider can go online as soon as they add a vehicle. Documents are optional.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/40-rider-onboarding.webp" alt="New rider adds a vehicle"><br><sub>New rider adds a vehicle</sub></td>
<td width="50%"><img src="Docs/screenshots/30-rider-home-online.webp" alt="Online, with earnings and demand hints for the next hour"><br><sub>Online, with earnings and demand hints for the next hour</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/31-rider-offer.webp" alt="Incoming request with a countdown"><br><sub>Incoming request with a countdown</sub></td>
<td width="50%"><img src="Docs/screenshots/32-rider-heading-to-pickup.webp" alt="Heading to the pickup"><br><sub>Heading to the pickup</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/33-rider-trip-in-progress.webp" alt="Trip in progress, with navigation links and chat"><br><sub>Trip in progress, with navigation links and chat</sub></td>
<td width="50%"><img src="Docs/screenshots/34-rider-collect-cash.webp" alt="Confirm the cash received"><br><sub>Confirm the cash received</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/35-rider-profile.webp" alt="Profile, rating and commission owed"><br><sub>Profile, rating and commission owed</sub></td>
<td width="50%"><img src="Docs/screenshots/36-rider-earnings.webp" alt="Daily and weekly earnings"><br><sub>Daily and weekly earnings</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/37-rider-documents.webp" alt="Optional documents"><br><sub>Optional documents</sub></td>
<td width="50%"><img src="Docs/screenshots/38-rider-change-vehicle.webp" alt="Change vehicle (an admin approves it)"><br><sub>Change vehicle (an admin approves it)</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/39-rider-edit-details.webp" alt="Edit contact details"><br><sub>Edit contact details</sub></td>
<td width="50%"></td>
</tr>
</table>

### Admin

Live operations, accounts, safety, payments, demand forecasts and pricing.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/50-admin-overview.webp" alt="Overview with live map and active trips"><br><sub>Overview with live map and active trips</sub></td>
<td width="50%"><img src="Docs/screenshots/51-admin-accounts.webp" alt="Account directory"><br><sub>Account directory</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/52-admin-account-details.webp" alt="Account details and trip history"><br><sub>Account details and trip history</sub></td>
<td width="50%"><img src="Docs/screenshots/53-admin-safety.webp" alt="Safety alerts: SOS, reports, long stops and route deviations"><br><sub>Safety alerts: SOS, reports, long stops and route deviations</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/54-admin-safety-report.webp" alt="Alert detail with notes and a reply to the passenger"><br><sub>Alert detail with notes and a reply to the passenger</sub></td>
<td width="50%"><img src="Docs/screenshots/55-admin-support-agents.webp" alt="Support agents and their access"><br><sub>Support agents and their access</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/56-admin-payments.webp" alt="Cash collected, commission and settlements"><br><sub>Cash collected, commission and settlements</sub></td>
<td width="50%"><img src="Docs/screenshots/57-admin-demand.webp" alt="Demand forecasts and model metrics"><br><sub>Demand forecasts and model metrics</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/58-admin-pricing.webp" alt="Pricing rules and multiplier history"><br><sub>Pricing rules and multiplier history</sub></td>
<td width="50%"></td>
</tr>
</table>

### Support

Support agents work the safety queue and can see trips, but not money or rider documents.

<table>
<tr>
<td width="50%"><img src="Docs/screenshots/60-support-safety.webp" alt="Safety and reports queue"><br><sub>Safety and reports queue</sub></td>
<td width="50%"><img src="Docs/screenshots/61-support-live-trips.webp" alt="Live trips"><br><sub>Live trips</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/62-support-trips.webp" alt="Trip search"><br><sub>Trip search</sub></td>
<td width="50%"><img src="Docs/screenshots/63-support-trip-detail.webp" alt="Trip detail"><br><sub>Trip detail</sub></td>
</tr>
<tr>
<td width="50%"><img src="Docs/screenshots/64-support-saved-replies.webp" alt="Saved replies for common cases"><br><sub>Saved replies for common cases</sub></td>
<td width="50%"></td>
</tr>
</table>

## Project status

The web platform is built and tested. All four prediction models currently run **non-deep-learning baselines**. The PyTorch models (demand forecasting, ETA, cancellation, anomaly detection) are the next phase. Each one will replace its baseline through `registry`, without changes to matching, pricing or alerts. See [Docs/Plan.md](Docs/Plan.md#deep-learning) for the datasets and the order of work.

## Run it locally

You need Python 3.12 and Node.js.

**Backend**, from `backend/`:

```
python -m venv .venv
.venv\Scripts\activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend**, from `frontend/`:

```
npm install
npm run dev
```

Open http://localhost:3000.

**Settings.** Copy `.env.example` to `.env` in the project root and fill it in.

| Setting | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs login tokens. Use a long random string |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Create the first admin account if the database has none |
| `DEMO_MODE` | `true` adds demo accounts, simulated riders, 14 days of fake trips and the trip simulator. Leave it `false` for a clean database |
| `GROQ_API_KEY` | Optional. Turns on AI text such as price explanations and the assistant. Without it the app uses fixed text |
| `GEOCODER_EMAIL` | Optional contact address for the place-search service |
| `CORS_ORIGINS` | Websites allowed to call the API from a browser |

Never commit `.env`.

### Demo accounts

With `DEMO_MODE=true`, the login page has one-click buttons for a passenger, a rider and a support agent. The admin is the account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

### With Docker

```
cp .env.example .env     # fill it in
docker compose up --build
```

The frontend is on port 3000 and the backend on port 8000.

## Checks

From `backend/`:

```
python -m pytest
```

From `frontend/`:

```
npx tsc --noEmit
npm run lint
npm run build
```

## Documentation

- [Project proposal](Docs/Project%20Proposal.md): goals, models and evaluation plan
- [Team plan](Docs/Plan.md): how the four roles connect, testing a full ride, deployment and Git workflow
