"""Saved replies for the support desk (#60)."""

from .test_support import _new_agent, _report

URL = "/api/admin/saved-replies"


def test_default_team_replies_are_there_for_every_agent(client, support_h):
    replies = client.get(URL, headers=support_h).json()
    team = [r for r in replies if r["shared"]]
    assert len(team) >= 5
    assert {"lost_item", "fare", "safety"} <= {r["category"] for r in team}
    assert all(not r["can_edit"] for r in team)  # agents can use them but not change them
    assert any("{passenger_first_name}" in r["body"] for r in team)


def test_agents_keep_their_own_replies_private(client, admin_h):
    _, first = _new_agent(client, admin_h, "replies.first@example.com")
    _, second = _new_agent(client, admin_h, "replies.second@example.com")

    created = client.post(URL, headers=first, json={"title": "Umbrella found", "body": "Hi {passenger_first_name}, we found it.", "category": "lost_item"})
    assert created.status_code == 201
    reply = created.json()
    assert reply["mine"] and reply["can_edit"] and not reply["shared"]

    # The other agent neither sees it nor can touch it; the id reveals nothing (404, not 403).
    assert reply["id"] not in {r["id"] for r in client.get(URL, headers=second).json()}
    body = {"title": "Hijacked", "body": "Changed by someone else"}
    assert client.put(f"{URL}/{reply['id']}", headers=second, json=body).status_code == 404
    assert client.delete(f"{URL}/{reply['id']}", headers=second).status_code == 404

    edited = client.put(f"{URL}/{reply['id']}", headers=first, json={"title": "Umbrella returned", "body": "We have your umbrella.", "category": None})
    assert edited.status_code == 200 and edited.json()["title"] == "Umbrella returned" and edited.json()["category"] is None
    assert client.delete(f"{URL}/{reply['id']}", headers=first).status_code == 204
    assert reply["id"] not in {r["id"] for r in client.get(URL, headers=first).json()}


def test_only_admins_manage_team_replies(client, admin_h, support_h):
    refused = client.post(URL, headers=support_h, json={"title": "Team reply", "body": "For everyone", "shared": True})
    assert refused.status_code == 403

    team = client.post(URL, headers=admin_h, json={"title": "Refund issued", "body": "We've refunded {pickup} to {drop}.", "category": "fare", "shared": True})
    assert team.status_code == 201
    tid = team.json()["id"]
    seen = next(r for r in client.get(URL, headers=support_h).json() if r["id"] == tid)
    assert seen["shared"] and not seen["can_edit"] and seen["owner_name"]

    assert client.put(f"{URL}/{tid}", headers=support_h, json={"title": "Changed", "body": "By an agent"}).status_code == 403
    assert client.delete(f"{URL}/{tid}", headers=support_h).status_code == 403
    # An agent can't turn their own reply into a team reply either.
    own = client.post(URL, headers=support_h, json={"title": "Mine", "body": "My own words"}).json()
    assert client.put(f"{URL}/{own['id']}", headers=support_h, json={"title": "Mine", "body": "My own words", "shared": True}).status_code == 403

    assert client.delete(f"{URL}/{tid}", headers=admin_h).status_code == 204


def test_saved_replies_are_staff_only(client, user_h, rider_h):
    for h in (user_h, rider_h):
        assert client.get(URL, headers=h).status_code == 403
        assert client.post(URL, headers=h, json={"title": "Nope", "body": "Not staff"}).status_code == 403


def test_alerts_carry_the_trip_date_for_placeholders(client, user_h, support_h):
    trip = _report(client, user_h, note="Saved reply placeholder check")
    alert = next(a for a in client.get("/api/admin/alerts", headers=support_h).json() if a["trip_id"] == trip["id"])
    assert alert["trip_requested_at"] == trip["requested_at"]
