const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const FSQ_KEY = process.env.FSQ_KEY;

// Allow requests from any origin (your browser app)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Honest Review proxy running ✦" });
});

// Foursquare places search
// Usage: GET /places?query=Vienna
app.get("/places", async (req, res) => {
  const { query, limit = 8 } = req.query;
  if (!query) return res.status(400).json({ error: "query param required" });
  if (!FSQ_KEY) return res.status(500).json({ error: "FSQ_KEY not set on server" });

  try {
    const url = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=name,categories,location,rating,stats,price`;
    const response = await fetch(url, {
      headers: { Authorization: FSQ_KEY, Accept: "application/json" },
    });
    if (!response.ok) {
      const txt = await response.text();
      return res.status(response.status).json({ error: txt });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
