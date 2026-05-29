const express = require("express");
const router = express.Router();
const pool = require("../db"); // PostgreSQL connection

/* ==========================================
   SAVE EMPLOYEE MODULE PERMISSIONS
========================================== */

router.post("/save", async (req, res) => {
  try {
    const {
      employeeId,
      employeeName,
      modules,
    } = req.body;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const query = `
      INSERT INTO employee_module_permissions
      (
        employee_id,
        employee_name,
        modules
      )
      VALUES ($1,$2,$3)
      ON CONFLICT (employee_id)
      DO UPDATE SET
        employee_name = EXCLUDED.employee_name,
        modules = EXCLUDED.modules,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [
      employeeId,
      employeeName,
      JSON.stringify(modules || []),
    ];

    const result = await pool.query(query, values);

    res.json({
      success: true,
      message: "Permissions saved successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("SAVE PERMISSION ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* ==========================================
   GET SINGLE EMPLOYEE PERMISSIONS
========================================== */

router.get("/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM employee_module_permissions
      WHERE employee_id = $1
      `,
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        employeeId,
        modules: [],
      });
    }

    res.json({
      success: true,
      employeeId: result.rows[0].employee_id,
      employeeName: result.rows[0].employee_name,
      modules: result.rows[0].modules || [],
    });
  } catch (error) {
    console.error("GET PERMISSION ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* ==========================================
   GET ALL EMPLOYEE PERMISSIONS
========================================== */

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM employee_module_permissions
      ORDER BY employee_name ASC
    `);

    res.json({
      success: true,
      permissions: result.rows,
    });
  } catch (error) {
    console.error("GET ALL PERMISSIONS ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/* ==========================================
   DELETE EMPLOYEE PERMISSIONS
========================================== */

router.delete("/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    await pool.query(
      `
      DELETE FROM employee_module_permissions
      WHERE employee_id = $1
      `,
      [employeeId]
    );

    res.json({
      success: true,
      message: "Permissions deleted successfully",
    });
  } catch (error) {
    console.error("DELETE PERMISSION ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;