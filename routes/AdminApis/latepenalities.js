const express = require("express");
const router = express.Router();
const pool = require("../../db");

// 1️ Add Penalty
router.post("/add", async (req, res) => {
  try {
    const { employee_id, employee_name, penalty_amount } = req.body;

    const result = await pool.query(
      `INSERT INTO latepenalties (employee_id, employee_name, penalty_amount) 
       VALUES ($1, $2, $3) RETURNING *`,
      [employee_id, employee_name, penalty_amount]
    );

    res.status(201).json({ message: "Penalty added successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add penalty" });
  }
});

// 2️ Get All Penalties
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM latepenalties ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch penalties" });
  }
});

// 3️ Get Penalty by ID (Primary Key)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM latepenalties WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Penalty not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch penalty" });
  }
});

// 4️.Update Penalty Amount

router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_id, employee_name, penalty_amount } = req.body;

    const result = await pool.query(
      `UPDATE latepenalties
       SET employee_id = $1,
           employee_name = $2,
           penalty_amount = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [employee_id, employee_name, penalty_amount, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Penalty not found" });
    }

    res.json({ message: "Penalty updated successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update penalty" });
  }
});


// 5️ Delete Penalty
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM latepenalties WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Penalty not found" });
    }

    res.json({ message: "Penalty deleted successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete penalty" });
  }
});

module.exports = router;
