const express = require("express");
const router = express.Router();
const db = require("../db"); // PostgreSQL connection

/* ===============================
   ADD NEW EMPLOYEE WORKING DAYS
================================ */
router.post("/add", async (req, res) => {
  try {
    const { employee_name, email, working_days } = req.body;

    // 1️⃣ Validate input
    if (!employee_name || !email || !working_days) {
      return res.status(400).json({ message: "employee_name, email, and working_days are required" });
    }

    // 2️⃣ Fetch employee_id from employees table using email
    const employeeQuery = `SELECT id FROM employees WHERE email = $1`;
    const employeeResult = await db.query(employeeQuery, [email]);

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found with the provided email" });
    }

    const employee_id = employeeResult.rows[0].id;

    // 3️⃣ Insert into employee_working_days (store employee_id as well)
    const insertQuery = `
      INSERT INTO employee_working_days (employee_id, employee_name, email, working_days)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const result = await db.query(insertQuery, [employee_id, employee_name, email, working_days]);

    // 4️⃣ Respond success
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
    const { employee_name, email, working_days } = req.body;

    if (!employee_name || !email || !working_days) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const result = await db.query(
      `UPDATE employee_working_days
       SET employee_name = $1, email = $2, working_days = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [employee_name, email, working_days, id]
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

/* ===============================
   FETCH BY EMAIL
================================ */
router.get("/email/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const result = await db.query(
      `SELECT * FROM employee_working_days WHERE email = $1 ORDER BY id DESC`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No records found for this email" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching by email:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

module.exports = router;
