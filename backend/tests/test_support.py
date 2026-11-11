"""Support desk features: live events (#22), people on alerts (#23), trip detail (#24), trip search (#25),
case notes and ownership (#26), replies to passengers (#27) and the queue summary (#28)."""

import pytest

from app.realtime import ADMINS, SUPPORT_EVENTS, hub
from app.routers import ws as ws_router

from .test_auth import _register


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _report(client, user_h, note="Left my umbrella behind") -> dict:
    """File a report on one of the demo passenger's finished trips and return its alert."""
    trips = client.get("/api/trips", headers=user_h).json()
    trip = next(t for t in trips if t["status"] in ("completed", "cancelled"))
    assert client.post(f"/api/trips/{trip['id']}/report", headers=user_h, json={"category": "other", "note": note}).status_code == 201
    alerts = client.get("/api/admin/alerts", headers=user_h)  # passengers can't list alerts
    assert alerts.status_code == 403
    return trip


def _alert_for(client, staff_h, trip_id: str, note: str) -> dict:
    return next(a for a in client.get("/api/admin/alerts", headers=staff_h).json() if a["trip_id"] == trip_id and a["details"].get("note") == note)


def _new_agent(client, admin_h, email: str, approve: bool = True) -> tuple[str, dict]:
    body = _register(client, email, role="support").json()
    if approve:
        assert client.post(f"/api/admin/support-agents/{body['profile']['id']}/approve", headers=admin_h).status_code == 200
    return body["profile"]["id"], _h(body["token"])


# --- #22 live events ---------------------------------------------------------------------


class _FakeSocket:
    pass


def test_support_gets_alert_events_but_not_admin_only_ones():
    admin_ws, support_ws = _FakeSocket(), _FakeSocket()
    hub._roles[admin_ws] = ("admin-1", "admin")
    hub._roles[support_ws] = ("agent-1", "support")
    try:
        for event_type in SUPPORT_EVENTS:
            assert set(hub._targets([ADMINS], event_type)) == {admin_ws, support_ws}
        for event_type in ("payments.changed", "riders.changed", "support.changed", "earnings.updated"):
            assert hub._targets([ADMINS], event_type) == [admin_ws], f"support must not get {event_type}"
    finally:
        hub._roles.pop(admin_ws, None)
        hub._roles.pop(support_ws, None)


def test_only_approved_agents_can_open_the_live_connection(client, admin_h):
    pending_id, _ = _new_agent(client, admin_h, "ws.pending@example.com", approve=False)
    pending_token = client.post("/api/auth/login", json={"email": "ws.pending@example.com", "password": "a-good-password"}).json()["token"]
    assert ws_router._authenticate(pending_token) is None

    agent_id, agent_h = _new_agent(client, admin_h, "ws.approved@example.com")
    token = agent_h["Authorization"].split()[1]
    assert ws_router._authenticate(token) == (agent_id, "support")


def test_removing_access_closes_the_agents_live_connection(client, admin_h, monkeypatch):
    agent_id, agent_h = _new_agent(client, admin_h, "ws.revoked@example.com")
    closed = []
    monkeypatch.setattr(hub, "close_profile", lambda profile_id, code=4403: closed.append((profile_id, code)))
    assert client.post(f"/api/admin/support-agents/{agent_id}/revoke", headers=admin_h).status_code == 200
    assert closed == [(agent_id, 4403)]
    assert ws_router._authenticate(agent_h["Authorization"].split()[1]) is None


# --- #23 who is involved -----------------------------------------------------------------


def test_alerts_show_the_passenger_and_rider_but_not_the_passenger_phone(client, support_h, user_h):
    trip = _report(client, user_h, "Who was on this trip")
    alert = _alert_for(client, support_h, trip["id"], "Who was on this trip")
    assert alert["passenger_name"] == "Demo Passenger"
    if trip["rider"]:
        assert alert["rider_name"] == trip["rider"]["full_name"]
        assert alert["rider_phone"] == trip["rider"]["phone"]
    assert "passenger_phone" not in alert


# --- #24 trip detail ---------------------------------------------------------------------


def test_trip_detail_has_route_payment_and_alerts_but_no_earnings(client, support_h, user_h):
    trip = _report(client, user_h, "Detail view check")
    detail = client.get(f"/api/admin/trips/{trip['id']}", headers=support_h)
    assert detail.status_code == 200
    body = detail.json()
    assert body["trip"]["id"] == trip["id"]
    assert len(body["trip"]["route"]) > 1
    assert any(a["details"].get("note") == "Detail view check" for a in body["alerts"])
    assert body["trip"]["passenger_phone"] is None
    if body["trip"]["payment"]:
        assert body["trip"]["payment"]["commission"] is None
        assert body["trip"]["payment"]["rider_earning"] is None
    assert client.get("/api/admin/trips/not-a-trip", headers=support_h).status_code == 404


# --- #25 search and filters --------------------------------------------------------------


def test_trip_search_by_name_plate_status_vehicle_and_date(client, support_h):
    everything = client.get("/api/admin/trips/recent", headers=support_h, params={"limit": 200}).json()
    assert everything["trips"]
    sample = next(t for t in everything["trips"] if t["rider"] and t["rider"]["vehicle"])

    by_passenger = client.get("/api/admin/trips/recent", headers=support_h, params={"q": "demo pass"}).json()["trips"]
    assert by_passenger and all(t["passenger_name"] == "Demo Passenger" for t in by_passenger)

    plate = sample["rider"]["vehicle"]["plate_no"]
    by_plate = client.get("/api/admin/trips/recent", headers=support_h, params={"q": plate.lower()}).json()["trips"]
    assert by_plate and all(t["rider"]["vehicle"]["plate_no"] == plate for t in by_plate)

    by_rider = client.get("/api/admin/trips/recent", headers=support_h, params={"q": sample["rider"]["full_name"]}).json()["trips"]
    assert any(t["id"] == sample["id"] for t in by_rider) or len(by_rider) == 50

    cancelled = client.get("/api/admin/trips/recent", headers=support_h, params={"status_filter": "cancelled"}).json()["trips"]
    assert cancelled and all(t["status"] == "cancelled" for t in cancelled)

    cars = client.get("/api/admin/trips/recent", headers=support_h, params={"vehicle_type": "car"}).json()["trips"]
    assert cars and all(t["vehicle_type"] == "car" for t in cars)

    future = client.get("/api/admin/trips/recent", headers=support_h, params={"date_from": "2999-01-01"}).json()
    assert future == {"trips": [], "has_more": False}

    assert client.get("/api/admin/trips/recent", headers=support_h, params={"status_filter": "lost"}).status_code == 422


def test_trip_search_pages_past_the_first_results(client, support_h):
    first = client.get("/api/admin/trips/recent", headers=support_h, params={"limit": 5}).json()
    second = client.get("/api/admin/trips/recent", headers=support_h, params={"limit": 5, "offset": 5}).json()
    assert first["has_more"] and len(first["trips"]) == 5 and len(second["trips"]) == 5
    assert not {t["id"] for t in first["trips"]} & {t["id"] for t in second["trips"]}


# --- #26 case notes and ownership --------------------------------------------------------


def test_one_agent_owns_an_alert_and_admins_can_take_over(client, admin_h, user_h):
    _, first = _new_agent(client, admin_h, "owner.one@example.com")
    _, second = _new_agent(client, admin_h, "owner.two@example.com")
    trip = _report(client, user_h, "Ownership check")
    alert = _alert_for(client, first, trip["id"], "Ownership check")

    claimed = client.post(f"/api/admin/alerts/{alert['id']}/claim", headers=first).json()
    assert claimed["assigned_to"]["name"] == "Auth Test"
    taken = client.post(f"/api/admin/alerts/{alert['id']}/claim", headers=second)
    assert taken.status_code == 409 and "already handling" in taken.json()["detail"]
    assert client.post(f"/api/admin/alerts/{alert['id']}/release", headers=second).status_code == 403

    assert client.post(f"/api/admin/alerts/{alert['id']}/claim", headers=admin_h).json()["assigned_to"]["name"] == "Platform Admin"
    released = client.post(f"/api/admin/alerts/{alert['id']}/release", headers=admin_h).json()
    assert released["assigned_to"] is None


def test_notes_record_who_wrote_them_and_who_changed_the_status(client, support_h, admin_h, user_h):
    trip = _report(client, user_h, "Notes check")
    alert = _alert_for(client, support_h, trip["id"], "Notes check")
    noted = client.post(f"/api/admin/alerts/{alert['id']}/notes", headers=support_h, json={"body": "Called the rider, umbrella found"})
    assert noted.status_code == 201
    note = noted.json()["notes"][-1]
    assert note["author_name"] == "Demo Support Agent" and note["author_role"] == "support" and not note["for_passenger"]

    changed = client.post(f"/api/admin/alerts/{alert['id']}/status", headers=support_h, json={"status": "reviewed"}).json()
    assert changed["last_changed_by"] == "Demo Support Agent"
    # Admins see the same notes in the Safety tab.
    seen_by_admin = _alert_for(client, admin_h, trip["id"], "Notes check")
    assert [n["body"] for n in seen_by_admin["notes"]] == ["Called the rider, umbrella found"]
    assert client.post(f"/api/admin/alerts/{alert['id']}/notes", headers=support_h, json={"body": "   "}).status_code == 422


# --- #27 replies to passengers -----------------------------------------------------------


def test_passenger_sees_report_status_and_replies_but_not_internal_notes(client, support_h, user_h):
    trip = _report(client, user_h, "Reply check")
    alert = _alert_for(client, support_h, trip["id"], "Reply check")
    client.post(f"/api/admin/alerts/{alert['id']}/notes", headers=support_h, json={"body": "Internal: rider says no umbrella"})
    client.post(f"/api/admin/alerts/{alert['id']}/notes", headers=support_h, json={"body": "We're looking into it.", "for_passenger": True})
    client.post(f"/api/admin/alerts/{alert['id']}/status", headers=support_h, json={"status": "reviewed"})

    reports = client.get(f"/api/trips/{trip['id']}/reports", headers=user_h).json()
    mine = next(r for r in reports if r["note"] == "Reply check")
    assert mine["status"] == "in_review"
    assert [r["body"] for r in mine["replies"]] == ["We're looking into it."]
    assert "author_name" not in mine["replies"][0]


def test_replies_are_only_for_reports_and_only_the_passenger_can_read_them(client, support_h, user_h):
    trip = _report(client, user_h, "Privacy check")
    other = _register(client, "other.passenger@example.com").json()
    assert client.get(f"/api/trips/{trip['id']}/reports", headers=_h(other["token"])).status_code == 404

    alerts = client.get("/api/admin/alerts", headers=support_h, params={"status_filter": "open"}).json()
    detector_alert = next((a for a in alerts if a["alert_type"] in ("route_deviation", "long_stop")), None)
    if detector_alert is None:
        pytest.skip("no detector alert in the demo data at this point in the run")
    reply = client.post(f"/api/admin/alerts/{detector_alert['id']}/notes", headers=support_h, json={"body": "Hello", "for_passenger": True})
    assert reply.status_code == 409


# --- #28 queue summary -------------------------------------------------------------------


def test_queue_summary_counts_open_work_without_admin_figures(client, support_h, user_h):
    _report(client, user_h, "Summary check")
    summary = client.get("/api/admin/alerts/summary", headers=support_h).json()
    assert set(summary["by_type"]) == {"sos", "report", "route_deviation", "long_stop"}
    assert summary["open_total"] == sum(summary["by_type"].values()) >= 1
    assert summary["by_type"]["report"] >= 1
    assert summary["oldest_open_minutes"] is not None
    assert not {"revenue_today", "trips_today", "pending_riders"} & set(summary)

    open_alerts = client.get("/api/admin/alerts", headers=support_h, params={"status_filter": "open"}).json()
    assert summary["open_total"] == len(open_alerts) or len(open_alerts) == 100


def test_open_sos_alerts_come_first(client, support_h):
    alerts = client.get("/api/admin/alerts", headers=support_h).json()
    is_open_sos = [a["alert_type"] == "sos" and a["status"] == "open" for a in alerts]
    assert is_open_sos == sorted(is_open_sos, reverse=True)
