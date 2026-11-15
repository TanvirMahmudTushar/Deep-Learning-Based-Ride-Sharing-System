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
