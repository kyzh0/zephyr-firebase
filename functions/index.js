const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage, getDownloadURL } = require('firebase-admin/storage');

const functions = require('firebase-functions');
const axios = require('axios');
const fns = require('date-fns');
const fnsTz = require('date-fns-tz');
const sharp = require('sharp');
const md5 = require('md5');

initializeApp();

function getFlooredTime() {
  // floor data timestamp to 10 min
  let date = new Date();
  let rem = date.getMinutes() % 10;
  if (rem > 0) date = new Date(date.getTime() - rem * 60 * 1000);
  rem = date.getSeconds() % 60;
  if (rem > 0) date = new Date(date.getTime() - rem * 1000);
  date = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return date;
}

async function processHarvestResponse(sid, configId, graphId, traceId, longInterval, format) {
  let date = new Date();
  let utcYear = date.getUTCFullYear();
  let utcMonth = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  let utcDay = date.getUTCDate().toString().padStart(2, '0');
  let utcHours = date.getUTCHours().toString().padStart(2, '0');
  let utcMins = date.getUTCMinutes().toString().padStart(2, '0');
  const dateTo = `${utcYear}-${utcMonth}-${utcDay}T${utcHours}:${utcMins}:00.000`;

  const intervalMins = longInterval ? 40 : 20; // get data for last 20 min, with some exceptions
  date = new Date(date.getTime() - intervalMins * 60 * 1000);
  utcYear = date.getUTCFullYear();
  utcMonth = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  utcDay = date.getUTCDate().toString().padStart(2, '0');
  utcHours = date.getUTCHours().toString().padStart(2, '0');
  utcMins = date.getUTCMinutes().toString().padStart(2, '0');
  const dateFrom = `${utcYear}-${utcMonth}-${utcDay}T${utcHours}:${utcMins}:00.000`;

  try {
    const { data } = await axios.post(
      `https://data1.harvest.com//php/site_graph_functions.php?retrieve_trace=&req_ref=${sid}_${configId}_${graphId}}`,
      {
        config_id: configId,
        trace_id: traceId,
        graph_id: graphId,
        start_date: dateFrom,
        start_date_stats: dateFrom,
        end_date: dateTo
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Connection: 'keep-alive'
        }
      }
    );

    if (format === 'array') {
      if (data && data.length) {
        const d = data[0].data;
        if (d && d.length) {
          const d1 = d[d.length - 1];
          return d1.data_value;
        }
      }
    } else if (format === 'object') {
      if (data && data['1']) {
        const d = data['1'].data;
        if (d && d.length) {
          const d1 = d[d.length - 1];
          return d1.data_value;
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return null;
}

async function getHarvestData(stationId, windAvgId, windGustId, windDirId, tempId, longInterval) {
  let ids = stationId.split('_');
  if (ids.length != 2) {
    return;
  }
  const sid = ids[0];
  const configId = ids[1];

  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  // wind avg
  ids = windAvgId.split('_');
  if (ids.length == 2) {
    const result = await processHarvestResponse(
      sid,
      configId,
      ids[0],
      ids[1],
      longInterval,
      sid === '1057' ? 'array' : 'object' // station 1057 has avg/gust switched
    );
    if (result) {
      windAverage = result;
    }
  }

  // wind gust
  ids = windGustId.split('_');
  if (ids.length == 2) {
    const result = await processHarvestResponse(
      sid,
      configId,
      ids[0],
      ids[1],
      longInterval,
      sid === '1057' ? 'object' : 'array'
    );
    if (result) {
      windGust = result;
    }
  }

  // wind direction
  ids = windDirId.split('_');
  if (ids.length == 2) {
    const result = await processHarvestResponse(
      sid,
      configId,
      ids[0],
      ids[1],
      longInterval,
      'array'
    );
    if (result) {
      windBearing = result;
    }
  }

  // temperature
  ids = tempId.split('_');
  if (ids.length == 2) {
    const result = await processHarvestResponse(
      sid,
      configId,
      ids[0],
      ids[1],
      longInterval,
      'array'
    );
    if (result) {
      temperature = result;
    }
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getMetserviceData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(
      `https://www.metservice.com/publicData/webdata/weather-station-location/${stationId}/`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    const modules = data.layout.primary.slots.main.modules;
    if (modules && modules.length) {
      const wind = modules[0].observations.wind;
      if (wind && wind.length) {
        windAverage = wind[0].averageSpeed;
        windGust = wind[0].gustSpeed;

        if (wind[0].strength === 'Calm') {
          if (windAverage == null) {
            windAverage = 0;
          }
          if (windGust == null) {
            windGust = 0;
          }
        }

        switch (wind[0].direction.toUpperCase()) {
          case 'N':
            windBearing = 0;
            break;
          case 'NE':
            windBearing = 45;
            break;
          case 'E':
            windBearing = 90;
            break;
          case 'SE':
            windBearing = 135;
            break;
          case 'S':
            windBearing = 180;
            break;
          case 'SW':
            windBearing = 225;
            break;
          case 'W':
            windBearing = 270;
            break;
          case 'NW':
            windBearing = 325;
            break;
          default:
            windBearing = 0;
            break;
        }
      }
      const temp = modules[0].observations.temperature;
      if (temp && temp.length && temp[0]) {
        temperature = temp[0].current;
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getAttentisData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get('https://api.attentistechnology.com/sensor-overview', {
      headers: { Authorization: `Bearer ${process.env.ATTENTIS_KEY}`, Connection: 'keep-alive' }
    });
    if (data.data && data.data.weather_readings) {
      const d = data.data.weather_readings[stationId];
      if (d) {
        windAverage = d.wind_speed;
        windGust = d.wind_gust_speed;
        windBearing = d.wind_direction;
        temperature = d.air_temp;
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getCwuData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(`https://cwu.co.nz/forecast/${stationId}/`, {
      responseType: 'text',
      headers: {
        Connection: 'keep-alive'
      }
    });
    if (data.length) {
      // wind avg + direction
      let startStr = 'Current Windspeed:&nbsp;</label><span>&nbsp;';
      let i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('km/h.</span>', i);
        if (j > i) {
          const tempArray = data
            .slice(i + startStr.length, j)
            .trim()
            .split(' ');
          if (tempArray.length == 2) {
            const temp = tempArray[0];
            switch (temp.toUpperCase()) {
              case 'N':
                windBearing = 0;
                break;
              case 'NNE':
                windBearing = 22.5;
                break;
              case 'NE':
                windBearing = 45;
                break;
              case 'ENE':
                windBearing = 67.5;
                break;
              case 'E':
                windBearing = 90;
                break;
              case 'ESE':
                windBearing = 112.5;
                break;
              case 'SE':
                windBearing = 135;
                break;
              case 'SSE':
                windBearing = 157.5;
                break;
              case 'S':
                windBearing = 180;
                break;
              case 'SSW':
                windBearing = 202.5;
                break;
              case 'SW':
                windBearing = 225;
                break;
              case 'WSW':
                windBearing = 247.5;
                break;
              case 'W':
                windBearing = 270;
                break;
              case 'WNW':
                windBearing = 292.5;
                break;
              case 'NW':
                windBearing = 325;
                break;
              case 'NNW':
                windBearing = 337.5;
                break;
              default:
                windBearing = 0;
                break;
            }

            const temp1 = Number(tempArray[1]);
            if (!isNaN(temp1)) {
              windAverage = temp1;
            }
          }
        }
      }

      // wind gust
      startStr = 'Wind Gusting To:&nbsp;</label><span>&nbsp;';
      i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('km/h.</span>', i);
        if (j > i) {
          const temp = Number(data.slice(i + startStr.length, j).trim());
          if (!isNaN(temp)) {
            windGust = temp;
          }
        }
      }

      // temperature
      startStr = 'Now</span><br/>';
      i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('°C</p>', i);
        if (j > i) {
          const temp = Number(data.slice(i + startStr.length, j).trim());
          if (!isNaN(temp)) {
            temperature = temp;
          }
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getWeatherProData(stationId) {
  let windAverage = null;
  const windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(
      `https://www.weather-pro.com/reports/Realtime.php?SN=${stationId}`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    if (data.length) {
      // wind avg
      let startStr = 'Wind Speed</td><td style="font-size:120%;">:';
      let i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('kph</td></tr>', i);
        if (j > i) {
          const temp = Number(data.slice(i + startStr.length, j).trim());
          if (!isNaN(temp)) {
            windAverage = temp;
          }
        }
      }

      // wind direction
      startStr = 'Wind Direction</td><td style="font-size:120%;">:';
      i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('°</td></tr>', i);
        if (j > i) {
          const temp = Number(data.slice(i + startStr.length, j).trim());
          if (!isNaN(temp)) {
            windBearing = temp;
          }
        }
      }

      // temperature
      startStr = 'Air Temperature</td><td style="font-size:120%;">:';
      i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('°C</td></tr>', i);
        if (j > i) {
          const temp = Number(data.slice(i + startStr.length, j).trim());
          if (!isNaN(temp)) {
            temperature = temp;
          }
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getPortOtagoData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  const temperature = null;

  try {
    const { data } = await axios.get(
      `https://dvp.portotago.co.nz/dvp/graphs/htmx/get-graph/${stationId}`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    if (data.length) {
      // wind avg
      let startStr = '<p class="seriesName">Wind Speed Avg:</p>';
      let i = data.indexOf(startStr);
      if (i >= 0) {
        startStr = '<p class="seriesValue">';
        const j = data.indexOf(startStr, i);
        if (j > i) {
          const k = data.indexOf('</p>', j);
          if (k > i) {
            const temp = Number(data.slice(j + startStr.length, k).trim());
            if (!isNaN(temp)) {
              windAverage = temp * 1.852;
            }
          }
        }
      }

      // wind gust
      startStr = '<p class="seriesName">Wind Gust Max:</p>';
      i = data.indexOf(startStr);
      if (i >= 0) {
        startStr = '<p class="seriesValue">';
        const j = data.indexOf(startStr, i);
        if (j > i) {
          const k = data.indexOf('</p>', j);
          if (k > i) {
            const temp = Number(data.slice(j + startStr.length, k).trim());
            if (!isNaN(temp)) {
              windGust = temp * 1.852;
            }
          }
        }
      }

      // wind direction
      startStr = '<p class="seriesName">Wind Dir Avg:</p>';
      i = data.indexOf(startStr);
      if (i >= 0) {
        startStr = '<p class="seriesValue">';
        const j = data.indexOf(startStr, i);
        if (j > i) {
          const k = data.indexOf('</p>', j);
          if (k > i) {
            const temp = Number(data.slice(j + startStr.length, k).trim());
            if (!isNaN(temp)) {
              windBearing = temp;
            }
          }
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getWUndergroundData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(
      `https://api.weather.com/v2/pws/observations/current?apiKey=${process.env.WUNDERGROUND_KEY}&stationId=${stationId}&numericPrecision=decimal&format=json&units=m`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    const observations = data.observations;
    if (observations && observations.length) {
      windBearing = observations[0].winddir;
      const d = observations[0].metric;
      if (d) {
        windAverage = d.windSpeed;
        windGust = d.windGust;
        temperature = d.temp;
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getTempestData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(
      `https://swd.weatherflow.com/swd/rest/better_forecast?api_key=${process.env.TEMPEST_KEY}&station_id=${stationId}&units_temp=c&units_wind=kph`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    const cc = data.current_conditions;
    if (cc) {
      windAverage = cc.wind_avg;
      windGust = cc.wind_gust;
      windBearing = cc.wind_direction;
      temperature = cc.air_temperature;
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getCentrePortData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  const temperature = null;

  try {
    const dateFrom = new Date(Date.now() - 720 * 60 * 1000); // current time - 12h
    const dateTo = new Date(dateFrom.getTime() + 1081 * 60 * 1000); // date from + 18h 1min
    const { data } = await axios.get(
      'https://portweather-public.omcinternational.com/api/datasources/proxy/393//api/data/transformRecordsFromPackets' +
        `?sourcePath=${encodeURIComponent(`NZ/Wellington/Wind/Measured/${stationId}`)}` +
        '&transformer=LatestNoTransform' +
        `&fromDate_Utc=${encodeURIComponent(dateFrom.toISOString())}` +
        `&toDate_Utc=${encodeURIComponent(dateTo.toISOString())}` +
        '&qaStatusesString=*',
      {
        headers: { 'x-grafana-org-id': 338, Connection: 'keep-alive' }
      }
    );
    if (data.length && data[0]) {
      if (stationId === 'BaringHead') {
        const wind = data[0].value.contents;
        if (wind) {
          windAverage = wind['Wind Speed (Knots)(RAW)'] * 1.852; // data is in kt
          windGust = wind['Gust Speed (Knots)(RAW)'] * 1.852;
          windBearing = wind['Wind Direction(RAW)'];
        }
      } else {
        windAverage = data[0].WindSpd_01MnAvg * 1.852;
        windGust = data[0].WindGst_01MnMax * 1.852;
        windBearing = data[0].WindDir_01MnAvg;
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getLpcData() {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    let date = new Date();
    const dateTo = date.toISOString();
    date = new Date(date.getTime() - 1441 * 60 * 1000); // date from is current time - (1 day + 1 min)
    const dateFrom = date.toISOString();
    let { data } = await axios.get(
      'https://portweather-public.omcinternational.com/api/datasources/proxy/391//api/data/transformRecordsFromPackets' +
        `?sourcePath=${encodeURIComponent('NZ/Lyttelton/Meteo/Measured/Lyttelton TABW')}` +
        '&transformer=LatestNoTransform' +
        `&fromDate_Utc=${encodeURIComponent(dateFrom)}` +
        `&toDate_Utc=${encodeURIComponent(dateTo)}` +
        '&qaStatusesString=*',
      {
        headers: { 'x-grafana-org-id': 338, Connection: 'keep-alive' }
      }
    );
    if (data.length && data[0]) {
      windAverage = data[0].windspd_01mnavg * 1.852; // data is in kt
      windGust = data[0].windgst_01mnmax * 1.852;
      windBearing = data[0].winddir_01mnavg;
    }

    ({ data } = await axios.post(
      'https://portweather-public.omcinternational.com/api/ds/query',
      {
        from: dateFrom,
        queries: [
          {
            datasourceId: 391,
            sourcePath: 'NZ/Lyttelton/Meteo/Measured/Lyttelton IHJ3',
            sourceProperty: 'airtemp_01mnavg',
            transformerType: 'LatestMeasuredGenericPlot',
            type: 'timeseries'
          }
        ],
        to: dateTo
      },
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    ));
    const frames = data.results[''].frames;
    if (frames && frames.length) {
      const vals = frames[0].data.values;
      if (vals && vals.length == 2) {
        if (vals[1] && vals[1].length) {
          temperature = vals[1][0];
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getMpycData() {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get('https://mpyc.nz/weather/json/weewx_data.json');
    if (data.current) {
      const avg = data.current.windspeed
        ? Number(data.current.windspeed.replace(' knots', ''))
        : null;
      if (avg != null && !isNaN(avg)) {
        windAverage = avg * 1.852; // data is in kt
      }
      const gust = data.current.windGust
        ? Number(data.current.windspeed.replace(' knots', ''))
        : null;
      if (gust != null && !isNaN(gust)) {
        windGust = gust * 1.852;
      }
      const bearing = data.current.winddir_formatted
        ? Number(data.current.winddir_formatted)
        : null;
      if (bearing != null && !isNaN(bearing)) {
        windBearing = bearing;
      }
      const temp = data.current.outTemp_formatted ? Number(data.current.outTemp_formatted) : null;
      if (temp != null && !isNaN(temp)) {
        temperature = temp;
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getNavigatusData() {
  let windAverage = null;
  const windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(`https://nzqnwx.navigatus.aero/frontend/kelvin_iframe`, {
      headers: {
        Connection: 'keep-alive'
      }
    });
    if (data.length) {
      // wind direction
      let dirStr = '';
      let startStr = '<div class="wind-data">';
      let i = data.indexOf(startStr);
      if (i >= 0) {
        startStr = '<p>';
        const j = data.indexOf(startStr, i);
        if (j > i) {
          const k = data.indexOf('</p>', j);
          if (k > i) {
            dirStr = data.slice(j + startStr.length, k).trim();
            switch (dirStr.toUpperCase()) {
              case 'NORTHERLY':
                windBearing = 0;
                break;
              case 'NORTH-EASTERLY':
                windBearing = 45;
                break;
              case 'EASTERLY':
                windBearing = 90;
                break;
              case 'SOUTH-EASTERLY':
                windBearing = 135;
                break;
              case 'SOUTHERLY':
                windBearing = 180;
                break;
              case 'SOUTH-WESTERLY':
                windBearing = 225;
                break;
              case 'WESTERLY':
                windBearing = 270;
                break;
              case 'NORTH-WESTERLY':
                windBearing = 315;
                break;
              default:
                break;
            }
          }
        }
      }

      // wind avg
      startStr = `<p>${dirStr}</p>`;
      i = data.indexOf(startStr);
      if (i >= 0) {
        const startStr1 = '<p>';
        const j = data.indexOf(startStr1, i + startStr.length);
        if (j > i) {
          const k = data.indexOf('km/h</p>', j);
          if (k > i) {
            const temp = Number(data.slice(j + startStr1.length, k).trim());
            if (!isNaN(temp)) {
              windAverage = temp;
            }
          }
        }
      }

      // temperature
      startStr = '<p>Temperature:';
      i = data.indexOf(startStr);
      if (i >= 0) {
        const j = data.indexOf('&deg;</p>', i);
        if (j > i) {
          const temp = Number(data.slice(i + startStr.length, j).trim());
          if (!isNaN(temp)) {
            temperature = temp;
          }
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function stationWrapper(source) {
  try {
    const db = getFirestore();
    const snapshot = await db.collection('stations').get();
    if (!snapshot.empty) {
      const tempArray = [];
      snapshot.forEach((doc) => {
        tempArray.push(doc);
      });

      const date = getFlooredTime();

      const json = [];
      for (const doc of tempArray) {
        let data = null;
        const docData = doc.data();

        if (source === 'harvest') {
          if (docData.type === 'harvest') {
            data = await getHarvestData(
              docData.externalId,
              docData.harvestWindAverageId,
              docData.harvestWindGustId,
              docData.harvestWindDirectionId,
              docData.harvestTemperatureId,
              docData.harvestLongInterval // some harvest stations only update every 30 min
            );
          }
        } else if (source === 'metservice') {
          if (docData.type === 'metservice') {
            data = await getMetserviceData(docData.externalId);
          }
        } else {
          if (docData.type === 'attentis') {
            data = await getAttentisData(docData.externalId);
          } else if (docData.type === 'wu') {
            data = await getWUndergroundData(docData.externalId);
          } else if (docData.type === 'tempest') {
            data = await getTempestData(docData.externalId);
          } else if (docData.type === 'cwu') {
            data = await getCwuData(docData.externalId);
          } else if (docData.type === 'wp') {
            data = await getWeatherProData(docData.externalId);
          } else if (docData.type === 'cp') {
            data = await getCentrePortData(docData.externalId);
          } else if (docData.type === 'po') {
            data = await getPortOtagoData(docData.externalId);
          } else if (docData.type === 'lpc') {
            data = await getLpcData();
          } else if (docData.type === 'mpyc') {
            data = await getMpycData();
          } else if (docData.type === 'navigatus') {
            data = await getNavigatusData();
          }
        }

        functions.logger.log(
          `${docData.type} data updated${docData.externalId ? ` - ${docData.externalId}` : ''}`
        );
        functions.logger.log(data);

        if (data) {
          // handle likely erroneous values
          let avg = data.windAverage;
          if (avg < 0 || avg > 500) {
            avg = null;
          }
          let gust = data.windGust;
          if (gust < 0 || gust > 500) {
            gust = null;
          }
          let bearing = data.windBearing;
          if (bearing < 0 || bearing > 360) {
            bearing = null;
          }
          let temperature = data.temperature;
          if (temperature < -40 || temperature > 60) {
            temperature = null;
          }

          // update station data
          const s = {
            lastUpdate: new Date(), // do not floor to 10 min
            currentAverage: avg ?? null,
            currentGust: gust ?? null,
            currentBearing: bearing ?? null,
            currentTemperature: temperature ?? null
          };
          if (avg != null || gust != null) {
            s.isOffline = false;
          }
          if (avg != null && gust != null && bearing != null && temperature != null) {
            s.isError = false;
          }
          await db.doc(`stations/${doc.id}`).update(s);

          // add data
          await db.collection(`stations/${doc.id}/data`).add({
            time: date,
            expiry: new Date(date.getTime() + 24 * 60 * 60 * 1000), // 1 day expiry to be deleted by TTL policy
            windAverage: avg ?? null,
            windGust: gust ?? null,
            windBearing: bearing ?? null,
            temperature: temperature ?? null
          });

          // write to json
          json.push({
            id: doc.id,
            name: docData.name,
            type: docData.type,
            coordinates: {
              lat: docData.coordinates._latitude,
              lon: docData.coordinates._longitude
            },
            timestamp: date.getTime() / 1000,
            wind: {
              average: avg ?? null,
              gust: gust ?? null,
              bearing: bearing ?? null
            },
            temperature: temperature ?? null
          });
        }
      }

      if (json.length) {
        // save json to storage
        const bucket = getStorage().bucket();
        const file = bucket.file(
          `data/processing/${source ? source : 'all'}-${json[0].timestamp}.json`
        );
        await file.save(Buffer.from(JSON.stringify(json)));
      }
    }
    functions.logger.log('Weather station data updated.');
  } catch (error) {
    functions.logger.error(error);
    return null;
  }
}

async function getHolfuyData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { headers } = await axios.get(`https://holfuy.com/en/weather/${stationId}`);
    const cookies = headers['set-cookie'];
    if (cookies && cookies.length && cookies[0].length) {
      const { data } = await axios.get(`https://holfuy.com/puget/mjso.php?k=${stationId}`, {
        headers: {
          Cookie: cookies[0],
          Connection: 'keep-alive'
        }
      });
      windAverage = data.speed;
      windGust = data.gust;
      windBearing = data.dir;
      temperature = data.temperature;
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function holfuyWrapper() {
  try {
    const db = getFirestore();
    const snapshot = await db.collection('stations').where('type', '==', 'holfuy').get();
    if (!snapshot.empty) {
      const tempArray = [];
      snapshot.forEach((doc) => {
        tempArray.push(doc);
      });

      const date = getFlooredTime();

      const { data } = await axios.get(
        `https://api.holfuy.com/live/?pw=${process.env.HOLFUY_KEY}&m=JSON&tu=C&su=km/h&s=all`
      );

      const json = [];
      for (const doc of tempArray) {
        let d = null;
        const docData = doc.data();

        const matches = data.measurements.filter((m) => {
          return m.stationId.toString() === docData.externalId;
        });
        if (matches.length == 1) {
          const wind = matches[0].wind;
          d = {
            windAverage: wind?.speed ?? null,
            windGust: wind?.gust ?? null,
            windBearing: wind?.direction ?? null,
            temperature: matches[0]?.temperature ?? null
          };
        } else {
          d = await getHolfuyData(docData.externalId);
        }

        functions.logger.log(`holfuy data updated - ${docData.externalId}`);
        functions.logger.log(d);

        // handle likely erroneous values
        let avg = d.windAverage;
        if (avg < 0 || avg > 500) {
          avg = null;
        }
        let gust = d.windGust;
        if (gust < 0 || gust > 500) {
          gust = null;
        }
        let bearing = d.windBearing;
        if (bearing < 0 || bearing > 360) {
          bearing = null;
        }
        let temperature = d.temperature;
        if (temperature < -40 || temperature > 60) {
          temperature = null;
        }

        // update station data
        const s = {
          lastUpdate: new Date(), // do not floor to 10 min
          currentAverage: avg ?? null,
          currentGust: gust ?? null,
          currentBearing: bearing ?? null,
          currentTemperature: temperature ?? null
        };
        if (avg != null || gust != null) {
          s.isOffline = false;
        }
        if (avg != null && gust != null && bearing != null && temperature != null) {
          s.isError = false;
        }
        await db.doc(`stations/${doc.id}`).update(s);

        // add data
        await db.collection(`stations/${doc.id}/data`).add({
          time: date,
          expiry: new Date(date.getTime() + 24 * 60 * 60 * 1000), // 1 day expiry to be deleted by TTL policy
          windAverage: avg ?? null,
          windGust: gust ?? null,
          windBearing: bearing ?? null,
          temperature: temperature ?? null
        });

        // write to json
        json.push({
          id: doc.id,
          name: docData.name,
          type: docData.type,
          coordinates: {
            lat: docData.coordinates._latitude,
            lon: docData.coordinates._longitude
          },
          timestamp: date.getTime() / 1000,
          wind: {
            average: avg ?? null,
            gust: gust ?? null,
            bearing: bearing ?? null
          },
          temperature: temperature ?? null
        });
      }

      if (json.length) {
        // save json to storage
        const bucket = getStorage().bucket();
        const file = bucket.file(`data/processing/holfuy-${json[0].timestamp}.json`);
        await file.save(Buffer.from(JSON.stringify(json)));
      }
    }
    functions.logger.log('Holfuy data updated.');
  } catch (error) {
    functions.logger.error(error);
    return null;
  }
}

exports.updateWeatherStationData = functions
  .runWith({ timeoutSeconds: 60, memory: '1GB' })
  .region('australia-southeast1')
  .pubsub.schedule('*/10 * * * *') // at every 10th minute
  .onRun(() => {
    return stationWrapper();
  });

exports.updateHarvestStationData = functions
  .runWith({ timeoutSeconds: 180, memory: '1GB' })
  .region('australia-southeast1')
  .pubsub.schedule('*/10 * * * *')
  .onRun(() => {
    return stationWrapper('harvest');
  });

exports.updateHolfuyStationData = functions
  .runWith({ timeoutSeconds: 30, memory: '512MB' })
  .region('australia-southeast1')
  .pubsub.schedule('*/10 * * * *')
  .onRun(() => {
    return holfuyWrapper();
  });

exports.updateMetserviceStationData = functions
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .region('australia-southeast1')
  .pubsub.schedule('*/10 * * * *')
  .onRun(() => {
    return stationWrapper('metservice');
  });

function cmp(a, b) {
  if (a > b) return +1;
  if (a < b) return -1;
  return 0;
}
async function processJsonFile(bucket, source, timestamp) {
  try {
    const path = `data/processing/${source}-${timestamp}.json`;
    const file = await bucket.file(path).download();
    const contents = file.toString();
    if (contents) {
      await bucket.file(path).delete();
      const json = JSON.parse(contents);
      return json.sort((a, b) => {
        return cmp(a.type, b.type) || cmp(a.name, b.name);
      });
    }
  } catch (error) {
    functions.logger.error(error);
  }
  return null;
}

async function processJsonOutputWrapper() {
  try {
    const date = getFlooredTime();
    const timestamp = date.getTime() / 1000;

    const json = [];

    const bucket = getStorage().bucket();
    let data = await processJsonFile(bucket, 'harvest', timestamp);
    if (data) {
      for (const item of data) {
        json.push(item);
      }
    }
    data = await processJsonFile(bucket, 'holfuy', timestamp);
    if (data) {
      for (const item of data) {
        json.push(item);
      }
    }
    data = await processJsonFile(bucket, 'metservice', timestamp);
    if (data) {
      for (const item of data) {
        json.push(item);
      }
    }
    data = await processJsonFile(bucket, 'all', timestamp);
    if (data) {
      for (const item of data) {
        json.push(item);
      }
    }

    const file = bucket.file(
      `data/${fns.format(date, 'yyyy/MM/dd')}/zephyr-scrape-${timestamp}.json`
    );
    await file.save(Buffer.from(JSON.stringify(json)));
    const url = await getDownloadURL(file);

    const db = getFirestore();
    await db.collection(`output`).add({
      time: date,
      url: url
    });
  } catch (error) {
    functions.logger.error(error);
  }
}

exports.processJsonOutput = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .region('australia-southeast1')
  .pubsub.schedule('5-59/10 * * * *') // every 10 min with +5min offset
  .onRun(() => {
    return processJsonOutputWrapper();
  });

async function getHarvestImage(siteId, hsn, lastUpdate) {
  let updated = null;
  let base64 = null;

  try {
    const { data } = await axios.get(
      `https://live.harvest.com/php/device_camera_images_functions.php?device_camera_images&request_type=initial&site_id=${siteId}&hsn=${hsn}`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    if (data.date_utc) {
      updated = new Date(data.date_utc);
      // skip if image already up to date
      if (updated > lastUpdate && data.main_image) {
        base64 = data.main_image.replace('\\/', '/').replace('data:image/jpeg;base64,', '');
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    updated,
    base64
  };
}

async function getMetserviceImage(id, lastUpdate) {
  let updated = null;
  let base64 = null;

  try {
    const { data } = await axios.get(
      `https://www.metservice.com/publicData/webdata/traffic-camera/${id}`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    const modules = data.layout.secondary.slots.major.modules;
    if (modules && modules.length) {
      const sets = modules[0].sets;
      if (sets && sets.length) {
        const times = sets[0].times;
        if (times.length) {
          const d = times[times.length - 1];
          if (d.displayTime) {
            updated = new Date(d.displayTime);
            // skip if image already up to date
            if (updated > lastUpdate && d.url) {
              const response = await axios.get(`https://www.metservice.com${d.url}`, {
                responseType: 'arraybuffer',
                headers: {
                  Connection: 'keep-alive'
                }
              });
              base64 = Buffer.from(response.data, 'binary').toString('base64');
            }
          }
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    updated,
    base64
  };
}

async function getSrsImage(id, lastUpdate) {
  let updated = null;
  let base64 = null;

  try {
    const { data } = await axios.get(`https://hills.treshna.com/get_imagelist?camera=${id}`, {
      headers: {
        Connection: 'keep-alive'
      }
    });
    if (data.images && data.images.length) {
      const d = data.images[data.images.length - 1];
      if (d.name) {
        updated = fnsTz.fromZonedTime(
          fns.parse(d.name, 'dd MMMM yyyy hh:mma', new Date()),
          'Pacific/Auckland'
        );
        // skip if image already up to date
        if (updated > lastUpdate && d.url) {
          const response = await axios.get(`https://hills.treshna.com${d.url}`, {
            responseType: 'arraybuffer',
            headers: {
              Connection: 'keep-alive'
            }
          });
          base64 = Buffer.from(response.data, 'binary').toString('base64');
        }
      }
    }
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    updated,
    base64
  };
}

async function getQueenstownAirportImage(id) {
  let updated = null;
  let base64 = null;

  try {
    const dateTimeFormat = new Intl.DateTimeFormat('en-NZ', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      timeZone: 'Pacific/Auckland'
    });
    const parts = dateTimeFormat.formatToParts(new Date());

    let year = '';
    let month = '';
    let day = '';
    let hour = '';
    let minute = '';
    for (const p of parts) {
      switch (p.type) {
        case 'year':
          year = p.value;
          break;
        case 'month':
          month = p.value.padStart(2, '0');
          break;
        case 'day':
          day = p.value.padStart(2, '0');
          break;
        case 'hour':
          hour = p.value.padStart(2, '0');
          break;
        case 'minute':
          minute = p.value.padStart(2, '0');
          break;
      }
    }

    const response = await axios.get(
      `https://www.queenstownairport.co.nz/WebCam/${id}.jpg?dt=${year}-${month}-${day}-${hour}-${minute}`,
      {
        responseType: 'arraybuffer',
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    base64 = Buffer.from(response.data, 'binary').toString('base64');
    updated = new Date();
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    updated,
    base64
  };
}

async function getWanakaAirportImage(id) {
  let updated = null;
  let base64 = null;

  try {
    const dateTimeFormat = new Intl.DateTimeFormat('en-NZ', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      timeZone: 'Pacific/Auckland'
    });
    const parts = dateTimeFormat.formatToParts(new Date());

    let year = '';
    let month = '';
    let day = '';
    let hour = '';
    let minute = '';
    for (const p of parts) {
      switch (p.type) {
        case 'year':
          year = p.value;
          break;
        case 'month':
          month = p.value.padStart(2, '0');
          break;
        case 'day':
          day = p.value.padStart(2, '0');
          break;
        case 'hour':
          hour = p.value.padStart(2, '0');
          break;
        case 'minute':
          minute = p.value.padStart(2, '0');
          break;
      }
    }

    const response = await axios.get(
      `https://www.wanakaairport.com/WebCam/${id}.jpg?dt=${year}-${month}-${day}-${hour}-${minute}`,
      {
        responseType: 'arraybuffer',
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    base64 = Buffer.from(response.data, 'binary').toString('base64');
    updated = new Date();
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    updated,
    base64
  };
}

async function getLpcImage() {
  let updated = null;
  let base64 = null;

  try {
    const response = await axios.get('https://www.lpc.co.nz/cams/pacifica.jpg', {
      responseType: 'arraybuffer',
      headers: {
        Connection: 'keep-alive'
      }
    });
    base64 = Buffer.from(response.data, 'binary').toString('base64');
    updated = new Date();
  } catch (error) {
    functions.logger.error(error);
  }

  return {
    updated,
    base64
  };
}

async function webcamWrapper() {
  try {
    const db = getFirestore();
    const snapshot = await db.collection('cams').get();
    if (!snapshot.empty) {
      const tempArray = [];
      snapshot.forEach((doc) => {
        tempArray.push(doc);
      });

      const bucket = getStorage().bucket();
      for (const doc of tempArray) {
        let data = null;
        const docData = doc.data();
        const lastUpdate = new Date(docData.lastUpdate._seconds * 1000);

        if (docData.type === 'harvest') {
          const ids = docData.externalId.split('_');
          data = await getHarvestImage(ids[0], ids[1], lastUpdate);
        } else if (docData.type === 'metservice') {
          data = await getMetserviceImage(docData.externalId, lastUpdate);
        } else if (docData.type === 'srs') {
          data = await getSrsImage(docData.externalId, lastUpdate);
        } else if (docData.type === 'qa') {
          data = await getQueenstownAirportImage(docData.externalId);
        } else if (docData.type === 'wa') {
          data = await getWanakaAirportImage(docData.externalId);
        } else if (docData.type === 'lpc') {
          data = await getLpcImage();
        }

        if (data && data.updated && data.base64) {
          // save base64 to storage
          const imgBuff = Buffer.from(data.base64, 'base64');

          const img = {
            time: data.updated,
            expiry: new Date(data.updated.getTime() + 24 * 60 * 60 * 1000) // 1 day expiry to be deleted by TTL policy
          };

          // for types that don't have embedded timestamps, check for duplicate image
          if (docData.type === 'qa' || docData.type === 'wa' || docData.type === 'lpc') {
            img.hash = md5(imgBuff);
            img.fileSize = imgBuff.length;
            const query = db.collection(`cams/${doc.id}/images`).orderBy('time', 'desc').limit(1);
            const snap = await query.get();
            if (!snap.empty) {
              const d = snap.docs[0].data();
              if (d.fileSize == img.fileSize && d.hash == img.hash) {
                functions.logger.log(
                  `${docData.type} image update skipped${docData.externalId ? ` - ${docData.externalId}` : ''}`
                );
                continue;
              }
            }
          }

          const resizedBuff = await sharp(imgBuff).resize({ width: 600 }).toBuffer();
          const imgByteArray = new Uint8Array(resizedBuff);
          const file = bucket.file(`cams/${docData.type}/${data.updated.toISOString()}.jpg`);
          await file.save(imgByteArray);
          const url = await getDownloadURL(file);

          img.url = url;

          // update cam
          await db.doc(`cams/${doc.id}`).update({
            lastUpdate: new Date(),
            currentTime: data.updated,
            currentUrl: url
          });

          // add image
          await db.collection(`cams/${doc.id}/images`).add(img);

          functions.logger.log(
            `${docData.type} image updated${docData.externalId ? ` - ${docData.externalId}` : ''}`
          );
        } else {
          functions.logger.log(
            `${docData.type} image update skipped${docData.externalId ? ` - ${docData.externalId}` : ''}`
          );
        }
      }
    }
    functions.logger.log('Webcam images updated.');
  } catch (error) {
    functions.logger.error(error);
    return null;
  }
}

exports.updateWebcamImages = functions
  .runWith({ timeoutSeconds: 60, memory: '1GB' })
  .region('australia-southeast1')
  .pubsub.schedule('*/20 * * * *') // at every 20th minute
  .onRun(() => {
    return webcamWrapper();
  });

async function checkForErrors() {
  try {
    const errors = [];
    const timeNow = Math.round(Date.now() / 1000);
    const db = getFirestore();
    const snapshot = await db.collection('stations').get();
    if (!snapshot.empty) {
      const tempArray = [];
      snapshot.forEach((doc) => {
        tempArray.push(doc);
      });
      for (const doc of tempArray) {
        // check if last 6h data is all null
        let isDataError = true;
        let isWindError = true;
        let isBearingError = true;
        let isTempError = true;
        const query = db.collection(`stations/${doc.id}/data`).orderBy('time', 'desc').limit(36); // 36 records in 6h
        const snap = await query.get();
        if (!snap.empty) {
          const tempArray1 = [];
          snap.forEach((doc) => {
            tempArray1.push(doc);
          });
          if (tempArray1.length) {
            // check that data exists up to 20min before current time
            if (timeNow - tempArray1[0].data().time.seconds <= 20 * 60) {
              isDataError = false;
              for (const doc1 of tempArray1) {
                const data = doc1.data();
                if (data.windAverage != null || data.windGust != null) {
                  isWindError = false;
                }
                if (data.windBearing != null) {
                  isBearingError = false;
                }
                if (data.temperature != null) {
                  isTempError = false;
                }
              }
            }
          }
        }

        let errorMsg = '';
        if (isDataError) {
          errorMsg = 'ERROR: Data scraper has stopped.\n';
        } else if (isWindError) {
          errorMsg += 'ERROR: No wind avg/gust data.\n';
        }

        if (isDataError || isWindError) {
          if (!doc.data().isOffline) {
            await db.doc(`stations/${doc.id}`).update({
              isOffline: true
            });
            errors.push({
              type: doc.data().type,
              msg: `${errorMsg}Name: ${doc.data().name}\nURL: ${doc.data().externalLink}\nFirestore ID: ${doc.id}\n`
            });
          }
        }

        if (isDataError || isWindError || isBearingError || isTempError) {
          if (!doc.data().isError) {
            await db.doc(`stations/${doc.id}`).update({
              isError: true
            });
          }
        }
      }
    }

    if (errors.length) {
      // send email if >2 stations of 1 type went offline at the same time
      let msg = `Scheduled check ran successfully at ${new Date().toISOString()}\n`;
      const g = Object.groupBy(errors, ({ type }) => type);
      const singleStations = ['lpc', 'mpyc', 'navigatus'];
      for (const [key, value] of Object.entries(g)) {
        if (singleStations.includes(key) || value.length > 2) {
          msg += `\n${key.toUpperCase()}\n\n`;
          msg += value.map((x) => x.msg).join('\n');
        }
      }
      await axios.post(`https://api.emailjs.com/api/v1.0/email/send`, {
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        template_params: {
          message: msg
        },
        accessToken: process.env.EMAILJS_PRIVATE_KEY
      });
    }

    functions.logger.log(`Checked for errors - ${errors.length} stations newly offline.`);
  } catch (error) {
    functions.logger.error(error);
    return null;
  }
}

exports.checkForErrors = functions
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .region('australia-southeast1')
  .pubsub.schedule('0 */6 * * *') // every 6h
  .onRun(() => {
    return checkForErrors();
  });

async function authenticateApiKey(db, apiKey) {
  if (!apiKey) {
    return {
      success: false,
      httpCode: 401,
      error: 'API key is required.'
    };
  }
  let snapshot = await db.collection('clients').where('apiKey', '==', apiKey).get();
  if (snapshot.empty) {
    return {
      success: false,
      httpCode: 401,
      error: 'Invalid API key.'
    };
  }

  const client = snapshot.docs[0];
  const date = new Date();
  const currentMonth = fns.format(date, 'yyyy-MM');
  snapshot = await db
    .collection(`clients/${client.id}/usage`)
    .where('month', '==', currentMonth)
    .get();
  if (!snapshot.empty) {
    const usage = snapshot.docs[0];
    const calls = usage.data().apiCalls;
    const limit = client.data().monthlyLimit;
    if (calls >= limit) {
      return {
        success: false,
        httpCode: 403,
        error: `Monthly limit of ${limit} API calls exceeded.`
      };
    }

    await db.doc(`clients/${client.id}/usage/${usage.id}`).update({
      apiCalls: calls + 1
    });
  } else {
    await db.collection(`clients/${client.id}/usage`).add({
      month: currentMonth,
      apiCalls: 1
    });
  }

  return { success: true };
}

exports.data = functions
  .runWith({ timeoutSeconds: 10, memory: '256MB' })
  .region('australia-southeast1')
  .https.onRequest(async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).send('');
      return;
    }

    const geoJson = {
      type: 'FeatureCollection',
      features: []
    };

    try {
      const db = getFirestore();
      const auth = await authenticateApiKey(db, req.query.key);
      if (!auth.success) {
        res.status(auth.httpCode).json({ error: auth.error });
        return;
      }

      const snapshot = await db.collection('stations').orderBy('type').orderBy('name').get();
      if (!snapshot.empty) {
        const tempArray = [];
        snapshot.forEach((doc) => {
          tempArray.push(doc);
        });
        for (const doc of tempArray) {
          const station = doc.data();
          const feature = {
            type: 'Feature',
            properties: {
              id: doc.id,
              name: station.name,
              type: station.type,
              link: station.externalLink,
              lastUpdateUnix: station.lastUpdate._seconds,
              currentAverage:
                station.currentAverage == null ? null : Math.round(station.currentAverage),
              currentGust: station.currentGust == null ? null : Math.round(station.currentGust),
              currentBearing:
                station.currentBearing == null ? null : Math.round(station.currentBearing),
              currentTemperature:
                station.currentTemperature == null ? null : Math.round(station.currentTemperature)
            },
            geometry: {
              type: 'Point',
              coordinates: [station.coordinates._longitude, station.coordinates._latitude]
            }
          };
          geoJson.features.push(feature);
        }
      }
    } catch (e) {
      functions.logger.log(e);
    }

    res.json(geoJson);
  });

exports.output = functions
  .runWith({ timeoutSeconds: 20, memory: '256MB' })
  .region('australia-southeast1')
  .https.onRequest(async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).send('');
      return;
    }

    const output = [];

    try {
      const db = getFirestore();
      const auth = await authenticateApiKey(db, req.query.key);
      if (!auth.success) {
        res.status(auth.httpCode).json({ error: auth.error });
        return;
      }

      let dateFrom = null;
      let dateTo = null;
      if (req.query.dateFrom) {
        const temp = Number(req.query.dateFrom);
        if (!isNaN(temp)) {
          dateFrom = new Date(temp * 1000);
        } else {
          dateFrom = new Date(req.query.dateFrom);
        }
      }
      if (req.query.dateTo) {
        const temp = Number(req.query.dateTo);
        if (!isNaN(temp)) {
          dateTo = new Date(temp * 1000);
        } else {
          dateTo = new Date(req.query.dateTo);
        }
      }

      let query = db.collection('output').orderBy('time');
      if (dateFrom != null && !isNaN(dateFrom)) query = query.where('time', '>=', dateFrom);
      if (dateTo != null && !isNaN(dateTo)) query = query.where('time', '<=', dateTo);
      const snapshot = await query.get();
      if (!snapshot.empty) {
        const tempArray = [];
        snapshot.forEach((doc) => {
          tempArray.push(doc);
        });
        for (const doc of tempArray) {
          output.push({
            time: doc.data().time._seconds,
            url: doc.data().url
          });
        }
      }
    } catch (e) {
      functions.logger.log(e);
    }

    res.json(output);
  });

// exports.test = functions
//   .runWith({ timeoutSeconds: 30, memory: '1GB' })
//   .region('australia-southeast1')
//   .https.onRequest(async (req, res) => {
//     try {

//     } catch (e) {
//       functions.logger.log(e);
//     }
//     res.send('ok');
//   });
