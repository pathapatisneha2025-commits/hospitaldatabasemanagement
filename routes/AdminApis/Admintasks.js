const express = require("express");
const router = express.Router();
const pool = require("../../db"); 

// -------------------- ADD TASK --------------------
router.post("/add", async (req, res) => {
  try {
    const {
      title,
      startDate,
      endDate,
      assignedTo,
      priority,
      attachment,
      description,
      recurringType = "Not Recurring",
      status = "Pending"
    } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Title, StartDate, and EndDate are required"
      });
    }

    // 1️⃣ Convert emails → employee IDs
    let employeeIds = [];

    if (Array.isArray(assignedTo) && assignedTo.length > 0) {
      const placeholders = assignedTo.map((_, i) => `$${i + 1}`).join(",");

      const employeeQuery = `
        SELECT id
        FROM employees
        WHERE email IN (${placeholders})
      `;

      const employeeResult = await pool.query(employeeQuery, assignedTo);

      employeeIds = employeeResult.rows.map(row => row.id);

      if (employeeIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid employees found for assigned emails"
        });
      }
    }

    // 2️⃣ Insert task (FIXED COLUMN NAMES - LOWERCASE SAFE)
    const query = `
      INSERT INTO admintasks
      (title, startdate, duedate, assignedto, employeeids, priority, attachment, description, recurringtype, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;
    `;

    const values = [
      title,
      startDate,
      endDate,
      assignedTo || null,
      employeeIds.length ? employeeIds : null,
      priority || null,
      attachment || null,
      description || null,
      recurringType,
      status
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Error creating task:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});


// -------------------- GET ALL TASKS --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM admintasks ORDER BY id DESC");
    res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error("Error fetching tasks:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});


// -------------------- GET A SINGLE TASK --------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM admintasks WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error fetching task:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});


// -------------------- UPDATE TASK --------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      startDate,
      endDate,
      assignedTo,
      priority,
      attachment,
      description,
      recurringType = "Not Recurring",
      status = "Pending"
    } = req.body;

    // 1️⃣ Convert emails → employee IDs
    let employeeIds = [];

    if (Array.isArray(assignedTo) && assignedTo.length > 0) {
      const placeholders = assignedTo.map((_, i) => `$${i + 1}`).join(",");

      const employeeQuery = `
        SELECT id
        FROM employees
        WHERE email IN (${placeholders})
      `;

      const employeeResult = await pool.query(employeeQuery, assignedTo);

      employeeIds = employeeResult.rows.map(r => r.id);

      if (employeeIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid employees found for assigned emails"
        });
      }
    }

    // 2️⃣ UPDATE QUERY (FIXED COLUMN CASE)
    const query = `
      UPDATE admintasks
      SET 
        title = $1,
        startdate = $2,
        duedate = $3,
        assignedto = $4,
        employeeids = $5,
        priority = $6,
        attachment = $7,
        description = $8,
        recurringtype = $9,
        status = $10,
        updatedat = NOW()
      WHERE id = $11
      RETURNING *;
    `;

    const values = [
      title,
      startDate,
      endDate,
      assignedTo || null,
      employeeIds.length ? employeeIds : null,
      priority || null,
      attachment || null,
      description || null,
      recurringType,
      status,
      id
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Error updating task:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// -------------------- GET TASKS BY EMPLOYEE ID --------------------
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT *
      FROM admintasks
      WHERE $1 = ANY(EmployeeIDs)
      ORDER BY id DESC
    `;

    const result = await pool.query(query, [employeeId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No tasks found for this employee"
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error("Error fetching tasks by employee:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});


// -------------------- DELETE TASK --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM admintasks WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Error deleting task:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});
router.post("/update-status", async (req, res) => {
  try {
    const { id, status, reject_reason = "", completed_time = null } = req.body;

    const query = `
      UPDATE admintasks
      SET status = $1,
          reject_reason = $2,
          completed_time = $3
      WHERE id = $4
      RETURNING *
    `;

    const result = await pool.query(query, [
      status,
      reject_reason,
      completed_time,
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin task not found",
      });
    }

    res.json({
      success: true,
      message: "Admin task updated successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Admin task update error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});
module.exports = router;
