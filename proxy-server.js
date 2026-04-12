const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "Honest Review proxy running ✦" });
});

app.get("/places", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query param required" });

  try {
    // Step 1: geocode the city name to lat/lon
    const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const geoRes = await fetch(geoUrl, { headers: { "User-Agent": "HonestReview/1.0" } });
    const geoData = await geoRes.json();
    if (!geoData.length) return res.json({ results: [] });

    const { lat, lon, display_name } = geoData[0];

    // Step 2: fetch nearby places from OpenTripMap (completely free)
    const placesUrl = `https://api.opentripmap.com/0.1/en/places/radius?radius=3000&lon=${lon}&lat=${lat}&limit=8&format=json&apikey=5ae2e3f221c38a28845f05b6f0d47b6ab64b0e91e0d52bc51a37534b`;
    const placesRes = await fetch(placesUrl);
    const places = await placesRes.json();

    // Normalize to our app's expected shape
    const results = (Array.isArray(places) ? places : [])
      .filter(p => p.name)
      .map(p => ({
        fsq_id: p.xid,
        name: p.name,
        categories: [{ name: p.kinds?.split(",")[0]?.replace(/_/g, " ") || "Place" }],
        location: { locality: query, country: display_name.split(", ").pop() },
        rating: (p.rate || 0) * 2,
        stats: { total_ratings: null },
        price: null,
      }));

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
