const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());


app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, "public")));

// 🔗 Routes
console.log("🔗 Loading /slots...");
const slotsRoutes = require("./routes/slots");
app.use("/slots", slotsRoutes);

// (Optionnel) Ajouter si tu as des routes utilisateur :
try {
  console.log("🔗 Loading /user...");
  const userRoutes = require("./routes/user");
  app.use("/user", userRoutes);
} catch (err) {
  console.warn("⚠️ /user route not loaded (optional):", err.message);
}

const distributeRoute = require("./routes/distribute");
app.use("/distribute", distributeRoute);
console.log("🔗 Loading /distribute...");


// 👂 Start server
app.listen(PORT,"0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


