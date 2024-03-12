import { useEffect, useRef, useState } from 'react';
import { Outlet, useLoaderData, useNavigate } from 'react-router-dom';
import { list } from '../firebase';

import Box from '@mui/material/Box';

import MapTerrainControl from './MapTerrainControl';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import arrowGreen from '../images/arrow-green.png';
import arrowYellow from '../images/arrow-yellow.png';
import arrowRed from '../images/arrow-red.png';

export default function Map() {
  const sites = useLoaderData();
  const [sitesGeoJson, setSitesGeoJson] = useState(null);

  useEffect(() => {
    if (!sites) return;
    const geoJson = {
      type: 'FeatureCollection',
      features: []
    };
    sites.forEach((site) => {
      const feature = {
        type: 'Feature',
        properties: {
          name: site.name,
          dbId: site.id,
          currentAverage: site.currentAverage,
          currentGust: site.currentGust,
          rotation: site.currentBearing
        },
        geometry: {
          type: 'Point',
          coordinates: [site.coordinates._long, site.coordinates._lat]
        }
      };
      geoJson.features.push(feature);
    });
    setSitesGeoJson(geoJson);
  }, [sites]);

  const map = useRef(null);
  const mapContainer = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_GL_KEY;

    if (map.current) return;
    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v11',
      center: [172.5, -41],
      zoom: 4.3,
      pitchWithRotate: false,
      touchPitch: false
    });

    m.dragRotate.disable();
    m.touchZoomRotate.disableRotation();

    // -------------- CONTROLS -----------------------
    m.addControl(new MapTerrainControl(), 'top-right');
    m.addControl(
      new mapboxgl.NavigationControl({
        showCompass: false
      }),
      'top-right'
    );

    // --------------- LIFECYCLE -----------------------
    m.on('load', () => {
      map.current = m;
      m.resize();
    });

    m.on('style.load', () => {
      m.loadImage(arrowGreen, (error, image) => {
        if (error) throw error;
        m.addImage('arrow-green', image);
      });
      m.loadImage(arrowYellow, (error, image) => {
        if (error) throw error;
        m.addImage('arrow-yellow', image);
      });
      m.loadImage(arrowRed, (error, image) => {
        if (error) throw error;
        m.addImage('arrow-red', image);
      });

      m.addSource('sites', {
        type: 'geojson',
        data: sitesGeoJson,
        generateId: true
      });
      m.addLayer({
        id: 'sites-layer',
        type: 'symbol',
        source: 'sites',
        layout: {
          'text-font': ['Lato Black'],
          'text-padding': 0,
          'text-anchor': 'center',
          'text-size': 10,
          'text-allow-overlap': true,
          'text-field': '{currentAverage}',
          'icon-image': [
            'case',
            ['<', ['get', 'currentAverage'], 20],
            'arrow-green',
            [
              'case',
              ['all', ['>=', ['get', 'currentAverage'], 20], ['<', ['get', 'currentAverage'], 30]],
              'arrow-yellow',
              'arrow-red'
            ]
          ],
          'icon-size': 0.07,
          'icon-allow-overlap': true,
          'icon-rotate': ['get', 'rotation']
        }
      });
    });

    // ----------------- EVENT HANDLERS -----------------------
    const handleSitesClick = (e) => {
      if (e.features.length) {
        navigate(`/sites/${e.features[0].properties.dbId}`);
      }
    };

    m.on('click', 'sites-layer', handleSitesClick);

    const handleSitesHoverOn = () => {
      m.getCanvas().style.cursor = 'pointer';
    };
    const handleSitesHoverOff = () => {
      m.getCanvas().style.cursor = '';
    };
    m.on('mouseenter', 'sites-layer', handleSitesHoverOn);
    m.on('mousemove', 'sites-layer', handleSitesHoverOn);
    m.on('mouseleave', 'sites-layer', handleSitesHoverOff);
  });

  return (
    <>
      <Box
        ref={mapContainer}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh'
        }}
      />
      <Outlet />
    </>
  );
}

export async function loader() {
  return await list('sites');
}
