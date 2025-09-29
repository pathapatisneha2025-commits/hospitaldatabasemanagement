const express = require("express");
const router = express.Router();
const pool = require("../../db");

// -------------------- CREATE Supplier --------------------
router.post("/add", async (req, res) => {
  try {
    const { name, delivery_type, address, phone } = req.body;

    if (!name || !delivery_type) {
      return res.status(400).json({ success: false, message: "Name and delivery_type are required" });
    }

    const result = await pool.query(
      "INSERT INTO suppliers (name, delivery_type, address, phone) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, delivery_type, address, phone]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- GET All Suppliers --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM suppliers ");
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- GET Supplier by ID --------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM suppliers WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- UPDATE Supplier --------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, delivery_type, address, phone } = req.body;

    const result = await pool.query(
      "UPDATE suppliers SET name = $1, delivery_type = $2, address = $3, phone = $4 WHERE id = $5 RETURNING *",
      [name, delivery_type, address, phone, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- DELETE Supplier --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM suppliers WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Supplier not found" });
    }

    res.json({ success: true, message: "Supplier deleted successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
