// Retired public account proxy. Public results are available through public-performance.
exports.handler = async () => ({
  statusCode: 410,
  headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
  body: JSON.stringify({error:'This endpoint is no longer public.',performance:'/.netlify/functions/public-performance'})
});
