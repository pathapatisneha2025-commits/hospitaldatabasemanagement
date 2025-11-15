const express = require("express");
const pool = require("../db");
const router = express.Router();

// -------------------------------
// GET ALL SALARY DEDUCTIONS
// -------------------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM salary_deductions ORDER BY min_salary");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});



// -------------------------------
// CREATE NEW SALARY DEDUCTION
// -------------------------------
router.post("/add", async (req, res) => {
  const { min_salary, max_salary, deduction_per_day, unauthorized_penalty } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO salary_deductions (min_salary, max_salary, deduction_per_day, unauthorized_penalty)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [min_salary, max_salary, deduction_per_day, unauthorized_penalty]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------------------
// UPDATE SALARY DEDUCTION BY ID
// -------------------------------
router.put("/update/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const { min_salary, max_salary, deduction_per_day, unauthorized_penalty } = req.body;
  try {
    const result = await pool.query(
      `UPDATE salary_deductions
       SET min_salary = $1, max_salary = $2, deduction_per_day = $3, unauthorized_penalty = $4
       WHERE id = $5 RETURNING *`,
      [min_salary, max_salary, deduction_per_day, unauthorized_penalty, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "ID not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------------------
// DELETE SALARY DEDUCTION BY ID
// -------------------------------
router.delete("/delete/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await pool.query("DELETE FROM salary_deductions WHERE id = $1 RETURNING *", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "ID not found" });
    res.json({ message: "Deleted successfully", deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
