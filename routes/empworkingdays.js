const express = require("express");
const router = express.Router();
const db = require("../db"); // your PostgreSQL connection file

/* ===============================
   ADD NEW EMPLOYEE WORKING DAYS
================================ */
router.post("/add", async (req, res) => {
  try {
    const { employee_id, month, working_days } = req.body;

    if (!employee_id || !month || !working_days) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const result = await db.query(
      `INSERT INTO employee_working_days (employee_id, month, working_days)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [employee_id, month, working_days]
    );

    res.status(201).json({
      message: "Employee working days added successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error adding working days:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

/* ===============================
   FETCH ALL RECORDS
================================ */
router.get("/all", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM employee_working_days ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

/* ===============================
   FETCH BY ID
================================ */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT * FROM employee_working_days WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching record:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

/* ===============================
   UPDATE RECORD
================================ */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_id, month, working_days } = req.body;

    if (!employee_id || !month || !working_days) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const result = await db.query(
      `UPDATE employee_working_days
       SET employee_id = $1, month = $2, working_days = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [employee_id, month, working_days, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json({
      message: "Employee working days updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating record:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

/* ===============================
   DELETE RECORD
================================ */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `DELETE FROM employee_working_days WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json({
      message: "Employee working days deleted successfully",
      deleted: result.rows[0],
    });
  } catch (error) {
    console.error("Error deleting record:", error);
    res.status(500).json({ message: "Server error", error });
  }
});


module.exports = router;
