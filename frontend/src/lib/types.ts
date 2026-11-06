export type Role = "user" | "rider" | "admin";
export type VehicleType = "bike" | "cng" | "car";
export type TripStatus = "requested" | "accepted" | "ongoing" | "completed" | "cancelled";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  profile: Profile;
}

export interface Zone {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export interface Vehicle {
  id: string;
  vehicle_type: VehicleType;
  plate_no: string;
  model: string;
  verified: boolean;
}

export interface RiderPublic {
  id: string;
  full_name: string;
  phone: string;
  rating: number | null;
  rating_count: number;
  vehicle: Vehicle | null;
  lat: number | null;
  lng: number | null;
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  distance_km: number;
  eta_min: number;
  per_km: number;
  per_min: number;
  min_fare: number;
  min_fare_applied: boolean;
  subtotal: number;
  multiplier: number;
  demand_surcharge: number;
  total: number;
}

export interface Quote {
  vehicle_type: VehicleType;
  distance_km: number;
  eta_min: number;
  base_fare: number;
  multiplier: number;
  fare: number;
  demand_level: "low" | "normal" | "high" | "very high";
  expected_requests: number;
  available_riders: number;
  nearest_pickup_eta_min: number | null;
  zone_name: string;
  reason: string;
  breakdown: FareBreakdown;
}

export interface Estimate {
  pickup_address: string;
  drop_address: string;
  distance_km: number;
  route: [number, number][];
  route_source: "osrm" | "straight";
  quotes: Quote[];
}

export interface TripPayment {
  method: "cash";
  amount: number;
  status: "pending" | "collected" | "disputed";
  /** Only present for the rider. */
  commission: number | null;
  rider_earning: number | null;
  collected_at: string | null;
}

export interface Trip {
  id: string;
  status: TripStatus;
  vehicle_type: VehicleType;
  pickup: LatLng;
  drop: LatLng;
  pickup_address: string;
  drop_address: string;
  distance_km: number;
  fare_estimate: number;
  fare_final: number | null;
  price_multiplier: number;
  price_reason: string;
  fare_breakdown: FareBreakdown | null;
  predicted_eta_min: number;
  pickup_eta_min: number | null;
  actual_duration_min: number | null;
  cancelled_by: "user" | "rider" | "system" | null;
  cancel_reason: string | null;
  auto_drive: boolean;
  route: [number, number][];
  approach: [number, number][];
  rider: RiderPublic | null;
  passenger_name: string;
  /** Only for the assigned rider while the trip is in progress. */
  passenger_phone: string | null;
  payment: TripPayment | null;
  rating: number | null;
  rating_comment: string | null;
  has_alert: boolean;
  sos_active: boolean;
  requested_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface RiderMe {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  license_no: string;
  status: "pending" | "verified" | "suspended";
  is_online: boolean;
  lat: number | null;
  lng: number | null;
  vehicle: Vehicle | null;
  rating: number | null;
  rating_count: number;
  trips_completed: number;
  earnings_today: number;
  cancel_rate: number;
  is_simulated: boolean;
  documents_ready: boolean;
  missing_documents: string[];
  commission_due: number;
}

export interface Offer {
  trip: Trip;
  expires_at: string;
  pickup_distance_km: number;
}

export interface AdminStats {
  trips_today: number;
  completed_today: number;
  active_trips: number;
  revenue_today: number;
  cancel_rate_7d: number;
  rider_cancel_rate_7d: number;
  avg_pickup_wait_min_7d: number | null;
  eta_mae_min_7d: number | null;
  online_riders: number;
  busy_riders: number;
  online_by_type: Record<VehicleType, number>;
  pending_riders: number;
  open_alerts: number;
  weather: { temperature_c: number; precipitation_mm: number; raining: boolean } | null;
}

export interface AdminRider {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  license_no: string;
  status: "pending" | "verified" | "suspended";
  is_online: boolean;
  is_simulated: boolean;
  busy: boolean;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  rating_count: number;
  vehicle: Vehicle | null;
  joined_at: string | null;
  documents_ready: boolean;
}

export interface LiveData {
  trips: Trip[];
  riders: { id: string; lat: number; lng: number; vehicle_type: VehicleType | null; busy: boolean }[];
}

export interface SafetyAlert {
  id: string;
  trip_id: string;
  alert_type: "route_deviation" | "long_stop" | "sos" | "report";
  anomaly_score: number;
  details: {
    vehicle_type?: VehicleType;
    progress_pct?: number;
    lat?: number;
    lng?: number;
    deviation_km?: number;
    stop_minutes?: number;
    note?: string;
    category?: string;
    trip_status?: TripStatus;
  };
  summary: string | null;
  status: "open" | "reviewed" | "closed";
  created_at: string;
  trip_status: TripStatus;
  vehicle_type: VehicleType;
  pickup_address: string;
  drop_address: string;
  route: [number, number][];
  rider_name: string | null;
}

export interface ZoneForecast {
  zone_id: number;
  zone: string;
  lat: number;
  lng: number;
  bike: number;
  cng: number;
  car: number;
  total: number;
  free_riders: number;
}

export interface Forecasts {
  model: string;
  generated_at: string | null;
  raining: boolean;
  zones: ZoneForecast[];
  hourly: { hour: number; forecast: number; actual: number | null }[];
}

export interface PricingRule {
  id: number;
  vehicle_type: VehicleType;
  base_fare: number;
  per_km: number;
  per_min: number;
  min_fare: number;
  max_multiplier: number;
  commission_pct: number;
}

export interface ModelInfo {
  component: string;
  name: string;
  kind: string;
  description: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BookingSuggestion {
  pickup_zone: string;
  drop_zone: string;
  vehicle_type: VehicleType;
  pickup: LatLng;
  drop: LatLng;
}

export interface ChatResponse {
  reply: string;
  booking: BookingSuggestion | null;
  source: "groq" | "fallback";
}

export interface SavedPlace {
  id: string;
  label: string;
  lat: number;
  lng: number;
  address: string;
}

export interface PassengerSummary {
  trips_total: number;
  trips_completed: number;
  trips_cancelled: number;
  cancelled_by_you: number;
  spent_total: number;
  spent_this_month: number;
  rides_this_month: number;
  avg_fare: number | null;
  distance_km_total: number;
  minutes_total: number;
  avg_rating_given: number | null;
  favorite_vehicle: VehicleType | null;
  by_vehicle: Record<VehicleType, number>;
  weekly: { week_start: string; spent: number; rides: number }[];
  top_destinations: { address: string; trips: number; lat: number; lng: number; vehicle_type: VehicleType }[];
  member_since: string | null;
}

export interface ServerHealth {
  status: string;
  demo_mode: boolean;
  simulator: boolean;
  groq: boolean;
  osrm: boolean;
  geocoding: boolean;
  max_upload_mb: number;
}

export interface GeoResult {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export type DocumentType = "license" | "registration" | "photo";

export interface RiderDocument {
  id: string;
  doc_type: DocumentType;
  label: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  uploaded_at: string | null;
  reviewed_at: string | null;
}

export interface DocumentsOverview {
  required: { doc_type: DocumentType; label: string; document: RiderDocument | null }[];
  ready: boolean;
  missing: string[];
}

export interface RiderBalance {
  gross_collected: number;
  commission_total: number;
  rider_earnings: number;
  settled: number;
  commission_due: number;
  collected_trips: number;
  pending_confirmations: number;
}

export interface PaymentRow {
  id: string;
  trip_id: string;
  amount: number;
  commission: number;
  commission_pct: number;
  rider_earning: number;
  status: "pending" | "collected" | "disputed";
  method: string;
  created_at: string | null;
  collected_at: string | null;
  pickup_address: string;
  drop_address: string;
  vehicle_type: VehicleType;
  distance_km: number;
}

export interface EarningsPeriod {
  gross: number;
  earnings: number;
  trips: number;
}

export interface RiderEarnings {
  balance: RiderBalance;
  today: EarningsPeriod;
  week: EarningsPeriod;
  month: EarningsPeriod;
  payments: PaymentRow[];
  settlements: { id: string; amount: number; note: string; created_at: string | null }[];
}

export interface PaymentsOverview {
  today: { gross: number; commission: number; trips: number };
  week: { gross: number; commission: number; trips: number };
  month: { gross: number; commission: number; trips: number };
  commission_outstanding: number;
  balances: (RiderBalance & { rider_id: string; full_name: string; phone: string; is_simulated: boolean; vehicle_type: VehicleType | null })[];
  open_payments: PaymentRow[];
  settlements: { id: string; rider_name: string; amount: number; note: string; created_at: string | null }[];
}
