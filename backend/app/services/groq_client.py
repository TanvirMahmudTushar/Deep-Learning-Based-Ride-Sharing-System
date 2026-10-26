"""Groq language-model client.

Only used for text: price explanations, alert summaries and the passenger assistant. Prompts
never contain names, phone numbers or emails. Every caller has a template fallback, so the app
works without a GROQ_API_KEY or when the free-tier rate limit is hit.
"""

import logging
import threading

from groq import Groq

from app.config import settings

log = logging.getLogger(__name__)


class GroqClient:
    def __init__(self, api_key: str | None) -> None:
        self._client = Groq(api_key=api_key, timeout=12.0, max_retries=1) if api_key else None

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def complete(
        self,
        model: str,
        messages: list[dict],
        max_tokens: int = 200,
        temperature: float = 0.3,
        reasoning_effort: str | None = None,
    ) -> str | None:
        if self._client is None:
            return None
        extra = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
        try:
            resp = self._client.chat.completions.create(
                model=model,
                messages=messages,
                max_completion_tokens=max_tokens,
                temperature=temperature,
                **extra,
            )
        except Exception as exc:  # rate limits, network errors, model changes
            log.warning("Groq request failed (%s): %s", model, exc)
            return None
        text = (resp.choices[0].message.content or "").strip()
        return text or None


groq_client = GroqClient(settings.groq_api_key)

_price_cache: dict[tuple, str] = {}
_cache_lock = threading.Lock()


def explain_price(ctx: dict) -> str:
    """One-sentence reason for the fare multiplier. Cached on the inputs that change the wording."""
    key = (ctx["vehicle_type"], ctx["zone"], ctx["multiplier"], ctx["demand_level"], ctx["raining"], ctx["peak"])
    with _cache_lock:
        if key in _price_cache:
            return _price_cache[key]

    text = groq_client.complete(
        settings.groq_price_model,
        [
            {
                "role": "system",
                "content": "You explain ride fares to passengers in Dhaka. Reply with ONE short, friendly sentence "
                "(max 25 words), no greeting, no emojis. Never invent numbers that are not given.",
            },
            {
                "role": "user",
                "content": (
                    f"Vehicle: {ctx['vehicle_type']}. Pickup area: {ctx['zone']}. Fare multiplier: {ctx['multiplier']}x. "
                    f"Expected requests in the next hour: {ctx['expected_requests']:.0f}. "
                    f"Available riders nearby: {ctx['available_riders']}. Demand level: {ctx['demand_level']}. "
                    f"Peak hour: {'yes' if ctx['peak'] else 'no'}. Raining: {'yes' if ctx['raining'] else 'no'}. "
                    "Explain why the fare is what it is."
                ),
            },
        ],
        max_tokens=80,
    )
    text = text or _price_template(ctx)
    with _cache_lock:
        _price_cache[key] = text
    return text


def _price_template(ctx: dict) -> str:
    if ctx["multiplier"] <= 1.0:
        return f"Standard fare: demand around {ctx['zone']} is normal for {ctx['vehicle_type']} rides right now."
    reasons = [f"about {ctx['expected_requests']:.0f} requests are expected near {ctx['zone']} in the next hour"]
    reasons.append(f"only {ctx['available_riders']} {ctx['vehicle_type']} riders are nearby")
    if ctx["raining"]:
        reasons.append("it is raining")
    return f"Fare is {ctx['multiplier']}x because " + ", ".join(reasons[:-1]) + " and " + reasons[-1] + "."


def summarize_alert(info: dict) -> str:
    text = groq_client.complete(
        settings.groq_alert_model,
        [
            {
                "role": "system",
                "content": "You are a safety analyst for a ride-sharing platform. Summarise the alert for an admin in "
                "2-3 sentences: what happened, how serious it looks, and one recommended action. Plain text.",
            },
            # Free-text notes are written by passengers and may hold personal details, so they stay out of the prompt.
            {"role": "user", "content": "Alert data: " + ", ".join(f"{k}={v}" for k, v in info.items() if k != "note")},
        ],
        max_tokens=180,
    )
    return text or _alert_template(info)


def _alert_template(info: dict) -> str:
    if info.get("alert_type") == "sos":
        return (
            f"The passenger pressed the emergency button during a {info.get('vehicle_type')} trip "
            f"({info.get('trip_status')}). Treat as urgent: call the passenger and rider now and check the live position."
        )
    if info.get("alert_type") == "report":
        return (
            f"Passenger report after a {info.get('vehicle_type')} trip, category: {str(info.get('category', 'other')).replace('_', ' ')}. "
            "Review the note and trip record, then follow up with the passenger."
        )
    if info.get("alert_type") == "route_deviation":
        what = f"The {info.get('vehicle_type')} trip left the planned route by {info.get('deviation_km')} km"
    else:
        what = f"The {info.get('vehicle_type')} trip stopped for about {info.get('stop_minutes')} minutes"
    severity = "high" if float(info.get("anomaly_score", 0)) >= 2 else "moderate"
    return (
        f"{what} at {info.get('progress_pct')}% of the journey (anomaly score {info.get('anomaly_score')}). "
        f"Severity looks {severity}. Recommended action: check the live trip and contact the rider if it continues."
    )


def assistant_reply(messages: list[dict], context: str) -> str | None:
    system = (
        "You are the in-app assistant of a Dhaka ride-sharing app (bike, CNG auto-rickshaw and car rides). "
        "Be brief and helpful. Answer questions about the passenger's trip using the context below, and explain "
        "fares, vehicle types and safety features. If the passenger wants to book a ride, find the pickup and "
        "drop areas among the known zones and end your reply with one line exactly in this form:\n"
        'BOOKING: {"pickup_zone": "<zone>", "drop_zone": "<zone>", "vehicle_type": "bike|cng|car"}\n'
        "Only use zone names from the list. Never ask for or reveal personal data.\n\n"
        f"Context:\n{context}"
    )
    return groq_client.complete(
        settings.groq_assistant_model,
        [{"role": "system", "content": system}, *messages[-12:]],
        max_tokens=1024,
        temperature=0.4,
        reasoning_effort="low",
    )
