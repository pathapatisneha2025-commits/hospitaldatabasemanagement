const express = require("express");
const router = express.Router();
const pool = require("../db");


// ✅ CREATE department limit
router.post("/add", async (req, res) => {
  try {
    const { department, maxLeavesPerDay } = req.body;

    if (!department || maxLeavesPerDay === undefined) {
      return res.status(400).json({ message: "Invalid data" });
    }

    const query = `
      INSERT INTO departments_leave_limit (department, max_leaves_per_day)
      VALUES ($1, $2)
      RETURNING *;
    `;

    const result = await pool.query(query, [
      department.trim(),
      maxLeavesPerDay,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Department already exists" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// ✅ UPDATE department limit
router.put("/update", async (req, res) => {
  try {
    const { department } = req.params;
    const { maxLeavesPerDay } = req.body;

    const query = `
      UPDATE departments_leave_limit
      SET max_leaves_per_day = $1
      WHERE department = $2
      RETURNING *;
    `;

    const result = await pool.query(query, [
      maxLeavesPerDay,
      department,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Department not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// ✅ DELETE department limit
router.delete("/delete/", async (req, res) => {
  try {
    const { department } = req.params;

    const result = await pool.query(
      "DELETE FROM departments_leave_limit WHERE department = $1 RETURNING *;",
      [department]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Department not found" });
    }

    res.json({ message: "Department deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// ✅ GET all department limits
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM departments_leave_limit ORDER BY department"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// ✅ TODAY STATUS (Admin Dashboard)
router.get("/today-status", async (req, res) => {
  try {
    const query = `
      SELECT
        d.department,
        d.max_leaves_per_day,
        COUNT(l.id) FILTER (WHERE l.status='APPROVED') AS taken
      FROM departments_leave_limit d
      LEFT JOIN leaves l
        ON d.department = l.department
        AND l.leave_date = CURRENT_DATE
      GROUP BY d.department, d.max_leaves_per_day
      ORDER BY d.department;
    `;

    const result = await pool.query(query);

    const data = result.rows.map(r => ({
      department: r.department,
      maxLeavesPerDay: r.max_leaves_per_day,
      taken: Number(r.taken),
      remaining: r.max_leaves_per_day - Number(r.taken),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
