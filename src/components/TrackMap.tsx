/** Leaflet track renderer. All decoded route and telemetry data stay local. */

import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TrackAnalysis } from '../calculations/trackAnalysis';
import { findNearestTrackPointIndex } from '../calculations/trackAnalysis';

interface TrackMapProps {
  track: TrackAnalysis;
  selectedPointIndex: number | null;
  onSelectPoint: (pointIndex: number) => void;
  compact?: boolean;
}

const SPEED_COLORS = ['#3987e5', '#199e70', '#c98500', '#d95926', '#d03b3b'] as const;

function speedColor(speedKmh: number, minimumKmh: number, maximumKmh: number): string {
  const range = maximumKmh - minimumKmh;
  const normalized = range > 0 ? (speedKmh - minimumKmh) / range : 0.5;
  const index = Math.min(
    SPEED_COLORS.length - 1,
    Math.max(0, Math.floor(normalized * SPEED_COLORS.length)),
  );
  return SPEED_COLORS[index];
}

export function TrackMap({
  track,
  selectedPointIndex,
  onSelectPoint,
  compact = false,
}: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selectedMarkerRef = useRef<L.CircleMarker | null>(null);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || track.points.length === 0) return;

    setTilesUnavailable(false);
    const map = L.map(container, {
      attributionControl: true,
      preferCanvas: true,
      zoomControl: true,
    });
    mapRef.current = map;

    // Only background tile coordinates leave the browser. Parsed log and
    // decoded vehicle telemetry are never sent to OpenStreetMap.
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });
    tiles.on('tileerror', () => setTilesUnavailable(true));
    tiles.addTo(map);

    const minimumSpeedKmh = track.minimumSpeedKmh ?? 0;
    const maximumSpeedKmh = track.maximumSpeedKmh ?? minimumSpeedKmh;
    for (const segment of track.segments) {
      const start = track.points[segment.startPointIndex];
      const end = track.points[segment.endPointIndex];
      L.polyline(
        [
          [start.latitudeDeg, start.longitudeDeg],
          [end.latitudeDeg, end.longitudeDeg],
        ],
        {
          color: speedColor(segment.speedKmh, minimumSpeedKmh, maximumSpeedKmh),
          interactive: false,
          opacity: 0.95,
          weight: 5,
        },
      ).addTo(map);
    }

    const routeCoordinates = track.points.map(
      (point) => [point.latitudeDeg, point.longitudeDeg] as L.LatLngTuple,
    );
    if (routeCoordinates.length > 1) {
      L.polyline(routeCoordinates, {
        color: '#ffffff',
        opacity: 0.01,
        weight: 18,
      })
        .on('click', (event: L.LeafletMouseEvent) => {
          const index = findNearestTrackPointIndex(
            track.points,
            event.latlng.lat,
            event.latlng.lng,
          );
          if (index !== null) onSelectPoint(index);
        })
        .addTo(map);
    }

    const addEndpoint = (
      pointIndex: number,
      label: string,
      color: string,
      direction: L.Direction,
    ): void => {
      const point = track.points[pointIndex];
      L.circleMarker([point.latitudeDeg, point.longitudeDeg], {
        color: '#111110',
        fillColor: color,
        fillOpacity: 1,
        radius: 6,
        weight: 2,
      })
        .bindTooltip(label, {
          className: 'track-endpoint-label',
          direction,
          offset: direction === 'left' ? [-5, 0] : [5, 0],
          permanent: true,
        })
        .on('click', () => onSelectPoint(pointIndex))
        .addTo(map);
    };

    addEndpoint(0, 'START', '#0ca30c', 'left');
    addEndpoint(track.points.length - 1, 'END', '#d03b3b', 'right');

    if (routeCoordinates.length === 1) {
      map.setView(routeCoordinates[0], 17);
    } else {
      map.fitBounds(L.latLngBounds(routeCoordinates), { padding: [24, 24] });
    }

    return () => {
      selectedMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [track, onSelectPoint]);

  useEffect(() => {
    const map = mapRef.current;
    const point = selectedPointIndex === null ? undefined : track.points[selectedPointIndex];
    if (map === null) return;
    if (point === undefined) {
      selectedMarkerRef.current?.remove();
      selectedMarkerRef.current = null;
      return;
    }

    if (selectedMarkerRef.current === null) {
      selectedMarkerRef.current = L.circleMarker(
        [point.latitudeDeg, point.longitudeDeg],
        {
          color: '#ffffff',
          fillColor: '#3987e5',
          fillOpacity: 1,
          interactive: false,
          radius: 8,
          weight: 2,
        },
      )
        .bindTooltip('SELECTED', { direction: 'top', offset: [0, -7] })
        .addTo(map);
    } else {
      selectedMarkerRef.current.setLatLng([point.latitudeDeg, point.longitudeDeg]);
    }
  }, [track, selectedPointIndex]);

  return (
    <div className={`track-map-shell${compact ? ' track-map-shell-compact' : ''}`}>
      <div
        ref={containerRef}
        className="track-map"
        role="application"
        aria-label="GPS track map. Select a route position to inspect nearby telemetry."
      />
      {tilesUnavailable && (
        <div className="map-tile-warning" role="status">
          ▲ Map tiles unavailable · GPS route remains available
        </div>
      )}
      <div className="speed-legend" aria-label="Route color indicates low to high GPS speed">
        <span>Low speed</span>
        <span className="speed-legend-gradient" aria-hidden="true" />
        <span>High speed</span>
      </div>
    </div>
  );
}
