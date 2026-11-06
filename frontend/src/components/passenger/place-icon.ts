import { Briefcase, Dumbbell, Home, MapPin } from "lucide-react";

export const QUICK_PLACE_LABELS = [
  { label: "Home", icon: Home },
  { label: "Work", icon: Briefcase },
  { label: "Gym", icon: Dumbbell },
];

export function placeIcon(label: string) {
  return QUICK_PLACE_LABELS.find((q) => q.label.toLowerCase() === label.toLowerCase())?.icon ?? MapPin;
}
