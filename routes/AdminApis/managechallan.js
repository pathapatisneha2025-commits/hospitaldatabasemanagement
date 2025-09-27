const express = require("express");
const router = express.Router();
const pool = require("../../db");

// 1️⃣ Add new challan
router.post("/add", async (req, res) => {
  try {
    const { challanno, purchaseorderno, rakes, rakers, status } = req.body;

    const result = await pool.query(
      `INSERT INTO managechallan 
       (challanno, purchaseorderno, rakes, rakers, status) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [challanno, purchaseorderno, rakes, rakers, status]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error inserting challan:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 2️⃣ Get all challans
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM managechallan ORDER BY id DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching challans:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 3️⃣ Get challan by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM managechallan WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Challan not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching challan:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 4️⃣ Update challan
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { challanno, purchaseorderno, rakes, rakers, status } = req.body;

    const result = await pool.query(
      `UPDATE managechallan 
       SET challanno = $1, purchaseorderno = $2, rakes = $3, rakers = $4, status = $5
       WHERE id = $6 RETURNING *`,
      [challanno, purchaseorderno, rakes, rakers, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Challan not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating challan:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 5️⃣ Delete challan
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`DELETE FROM managechallan WHERE id = $1 RETURNING *`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Challan not found" });
    }

    res.json({ message: "Challan deleted successfully", deleted: result.rows[0] });
  } catch (err) {
    console.error("Error deleting challan:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
