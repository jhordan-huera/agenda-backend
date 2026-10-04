// Copia de agenda-front/src/lib/maps.ts: mantener ambos archivos iguales (sólo cambian las rutas de import).
import type { HomeVisitAddress } from "../types/index.ts";

/**
 * Enlaces a Google Maps. En el celular abren la app de Maps y en el ordenador,
 * Google Maps en el navegador. No necesitan clave de API.
 */

/** Un lugar: la dirección escrita y, si se marcó en el mapa, su punto exacto. */
export interface MapPlace {
  address: string;
  lat: number | null;
  lng: number | null;
}

export const hasMapPoint = (place: MapPlace) => place.lat !== null && place.lng !== null;

/** Búsqueda de una dirección escrita. */
export function getMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Un lugar en el mapa: el punto exacto o, si no lo hay, la dirección. */
export function getPlaceMapsUrl(place: MapPlace): string {
  return hasMapPoint(place)
    ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
    : getMapsUrl(place.address);
}

/** Indicaciones para llegar al lugar desde la ubicación actual. */
export function getDirectionsUrl(place: MapPlace): string {
  const destination = hasMapPoint(place) ? `${place.lat},${place.lng}` : place.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** "Av. Amazonas N34-120 (casa blanca, timbre 3)" */
export function describeHomeVisit(visit: HomeVisitAddress): string {
  return visit.reference ? `${visit.address} (${visit.reference})` : visit.address;
}
