from app.services.geocoding import short_name


def test_named_place_without_road():
    item = {"name": "Dhanmondi Lake", "address": {"suburb": "Dhanmondi", "city": "Dhaka"}}
    assert short_name(item) == "Dhanmondi Lake, Dhanmondi"


def test_named_place_with_road():
    item = {"name": "Bashundhara City", "address": {"road": "Panthapath", "neighbourhood": "Kawran Bazar"}}
    assert short_name(item) == "Bashundhara City, Panthapath, Kawran Bazar"


def test_street_address():
    item = {"name": "", "address": {"house_number": "12", "road": "Road 5", "suburb": "Banani"}}
    assert short_name(item) == "12 Road 5, Banani"


def test_road_already_in_name_and_repeated_area():
    item = {"name": "Road 27", "address": {"road": "Road 27", "suburb": "Road 27"}}
    assert short_name(item) == "Road 27"


def test_falls_back_to_display_name():
    assert short_name({"display_name": "Somewhere, Bangladesh", "address": {}}) == "Somewhere, Bangladesh"
