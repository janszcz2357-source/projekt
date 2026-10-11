#!/usr/bin/env sh
# Pobiera dane Natural Earth (domena publiczna) potrzebne do zbudowania mapy.
set -e
cd "$(dirname "$0")"
mkdir -p data
curl -sSfo data/land50.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json
curl -sSfo data/countries50.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json
curl -sSfo data/rivers.geojson https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_rivers_lake_centerlines.geojson
curl -sSfo data/lakes.geojson https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_lakes.geojson
