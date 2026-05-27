const https = require('https')

const FRED_API_KEY = '5dbee5cd207c8dc08ae81eeae0a3ec0f'

exports.handler = async function (event) {
  const params = event.queryStringParameters || {}
  const seriesId = params.series_id
  const limit    = params.limit || '260'

  if (!seriesId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'series_id is required' }),
    }
  }

  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${FRED_API_KEY}` +
    `&file_type=json` +
    `&limit=${limit}` +
    `&sort_order=desc`

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(raw)
          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(json),
          })
        } catch (e) {
          resolve({
            statusCode: 500,
            body: JSON.stringify({ error: 'JSON parse error', detail: e.message }),
          })
        }
      })
    }).on('error', (e) => {
      resolve({
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream fetch error', detail: e.message }),
      })
    })
  })
}
