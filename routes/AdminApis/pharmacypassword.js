const express = require("express");
const router = express.Router();
const pool = require("../../db");

//  1️ Add new employee (Admin)
router.post("/add", async (req, res) => {
  try {
    const { employee_name, email, password } = req.body;

    const result = await pool.query(
      "INSERT INTO employee_pharmacy_password (employee_name, email, password) VALUES ($1, $2, $3) RETURNING *",
      [employee_name, email, password]
    );

    res.status(201).json({
      message: "✅ Employee added successfully",
      employee: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error adding employee:", error);
    res.status(500).json({ message: "Error adding employee" });
  }
});

//  2️ Get all employees
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM employee_pharmacy_password ORDER BY id ASC");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching employees:", error);
    res.status(500).json({ message: "Error fetching employees" });
  }
});

//  3️ Get employee by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM employee_pharmacy_password WHERE id = $1", [id]);

    if (result.rows.length > 0) {
      res.status(200).json(result.rows[0]);
    } else {
      res.status(404).json({ message: "Employee not found" });
    }
  } catch (error) {
    console.error("❌ Error fetching employee:", error);
    res.status(500).json({ message: "Error fetching employee" });
  }
});

//  4️ Update employee details
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, email, password } = req.body;

    const result = await pool.query(
      "UPDATE employee_pharmacy_password SET employee_name = $1, email = $2, password = $3 WHERE id = $4 RETURNING *",
      [employee_name, email, password, id]
    );

    if (result.rows.length > 0) {
      res.status(200).json({
        message: "✅ Employee updated successfully",
        employee: result.rows[0],
      });
    } else {
      res.status(404).json({ message: "Employee not found" });
    }
  } catch (error) {
    console.error("❌ Error updating employee:", error);
    res.status(500).json({ message: "Error updating employee" });
  }
});

//  5️ Delete employee by ID
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM employee_pharmacy_password WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length > 0) {
      res.status(200).json({ message: "✅ Employee deleted successfully" });
    } else {
      res.status(404).json({ message: "Employee not found" });
    }
  } catch (error) {
    console.error("❌ Error deleting employee:", error);
    res.status(500).json({ message: "Error deleting employee" });
  }
});



//  Export router
module.exports = router;
