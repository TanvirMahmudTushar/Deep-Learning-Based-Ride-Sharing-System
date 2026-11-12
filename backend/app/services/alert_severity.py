HIGH_SEVERITY_SCORE = 2.0


def anomaly_severity(score: float) -> str:
    return "high" if score >= HIGH_SEVERITY_SCORE else "moderate"
