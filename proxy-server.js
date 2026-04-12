const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const FSQ_KEY = process.env.FSQ_KEY;

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
  if (!FSQ_KEY) return res.status(500).json({ error: "FSQ_KEY not set on server" });

  try {
    const url = `https://places-api.foursquare.com/places/search?query=${encodeURIComponent(query)}&limit=8&fields=fsq_place_id,name,categories,location,rating,stats,price&near=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${FSQ_KEY}`,
        Accept: "application/json",
        "X-Places-Api-Version": "2025-06-17"
      },
    });
    const text = await response.text();
    console.log("FSQ response:", text.slice(0, 300));
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
