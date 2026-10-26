"""Prediction models behind one interface.

Each class here is the non-deep-learning baseline from the proposal's evaluation plan. The
trained PyTorch models (ST-GCN demand, GNN ETA, cancellation network, LSTM autoencoder) will
implement the same `PredictionModel` interface and replace these through `registry` without
changes to the matching, pricing or alert services.
"""

import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.db import local_time

PEAK_HOURS = {8, 9, 10, 17, 18, 19, 20}
WEEKEND_DAYS = {4, 5}  # Friday and Saturday in Bangladesh (Monday == 0)


def is_peak(when: datetime) -> bool:
    return local_time(when).hour in PEAK_HOURS


class PredictionModel(Protocol):
    name: str
    kind: str  # "baseline" or "deep-learning"
    description: str

    def predict(self, features: dict) -> float: ...


class EtaPredictor:
    """Baseline: road distance / typical Dhaka speed per vehicle type, slowed at peak hours."""

    name = "distance-over-speed-v1"
    kind = "baseline"
    description = "Road distance divided by average speed per vehicle type, x1.35 at peak hours"

    SPEED_KMH = {"bike": 22.0, "cng": 16.0, "car": 14.0}
    PEAK_FACTOR = 1.35

    def predict(self, features: dict) -> float:
        return self.predict_eta(features["distance_km"], features["vehicle_type"], features["when"])

    def predict_eta(self, distance_km: float, vehicle_type: str, when: datetime) -> float:
        minutes = distance_km / self.SPEED_KMH[vehicle_type] * 60
        if is_peak(when):
            minutes *= self.PEAK_FACTOR
        return max(1.0, round(minutes, 1))


@dataclass
class HistoricalTrip:
    zone_id: int
    vehicle_type: str
    requested_at: datetime


class DemandForecaster:
    """Baseline: historical average requests per zone, vehicle type, hour and day type."""

    name = "historical-average-v1"
    kind = "baseline"
    description = "Average requests per zone, vehicle type and local hour (weekday vs weekend), +15% when raining"

    RAIN_FACTOR = 1.15
    SLOT_MINUTES = 15

    def __init__(self) -> None:
        self._avg: dict[tuple[int, str, int, bool], float] = {}

    def fit(self, trips: Iterable[HistoricalTrip]) -> None:
        counts: dict[tuple[int, str, int, bool], int] = defaultdict(int)
        days: dict[bool, set] = {True: set(), False: set()}
        for t in trips:
            lt = local_time(t.requested_at)
            weekend = lt.weekday() in WEEKEND_DAYS
            counts[(t.zone_id, t.vehicle_type, lt.hour, weekend)] += 1
            days[weekend].add(lt.date())
        self._avg = {k: v / max(1, len(days[k[3]])) for k, v in counts.items()}

    def predict(self, features: dict) -> float:
        return self.forecast(features["zone_id"], features["vehicle_type"], features["when"], features.get("raining", False))

    def forecast(self, zone_id: int, vehicle_type: str, when: datetime, raining: bool = False) -> float:
        """Expected requests in the 15-minute slot starting at `when`."""
        lt = local_time(when)
        weekend = lt.weekday() in WEEKEND_DAYS
        per_hour = self._avg.get((zone_id, vehicle_type, lt.hour, weekend))
        if per_hour is None:  # fall back to the other day type
            per_hour = self._avg.get((zone_id, vehicle_type, lt.hour, not weekend), 0.0)
        value = per_hour * self.SLOT_MINUTES / 60
        if raining:
            value *= self.RAIN_FACTOR
        return round(value, 3)


class CancellationPredictor:
    """Baseline: hand-set logistic score until logistic regression / the network is trained."""

    name = "logistic-heuristic-v1"
    kind = "baseline"
    description = "Fixed-weight logistic score on pickup distance, rider cancel history, trip length and peak hour"

    def predict(self, features: dict) -> float:
        return self.cancel_probability(**features)

    def cancel_probability(self, pickup_km: float, trip_km: float, rider_cancel_rate: float, peak: bool) -> float:
        z = -2.6 + 0.35 * pickup_km + 4.0 * rider_cancel_rate + 0.03 * max(0.0, trip_km - 10) + (0.4 if peak else 0.0)
        return round(1 / (1 + math.exp(-z)), 4)


class AnomalyDetector:
    """Baseline: fixed distance-from-route threshold, plus a long-stop rule."""

    name = "route-threshold-v1"
    kind = "baseline"
    description = "Flags GPS points more than 0.5 km off the planned route, or stops longer than 3 minutes"

    DEVIATION_THRESHOLD_KM = 0.5
    LONG_STOP_MINUTES = 3.0

    def predict(self, features: dict) -> float:
        return self.score(features["distance_from_route_km"])

    def score(self, distance_from_route_km: float) -> float:
        """Score >= 1 means anomalous."""
        return round(distance_from_route_km / self.DEVIATION_THRESHOLD_KM, 3)


eta_predictor = EtaPredictor()
demand_forecaster = DemandForecaster()
cancellation_predictor = CancellationPredictor()
anomaly_detector = AnomalyDetector()

registry: dict[str, PredictionModel] = {
    "demand": demand_forecaster,
    "eta": eta_predictor,
    "cancellation": cancellation_predictor,
    "anomaly": anomaly_detector,
}
