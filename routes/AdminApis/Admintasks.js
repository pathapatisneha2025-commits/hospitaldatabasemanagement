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
      status = "Pending"   // ✅ Default status added
    } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Title, StartDate, and EndDate are required"
      });
    }

    // 1️⃣ Fetch employee IDs from emails
    let employeeIds = [];
    if (assignedTo && assignedTo.length > 0) {
      const placeholders = assignedTo.map((_, i) => `$${i + 1}`).join(",");
      const employeeQuery = `SELECT id, email FROM employees WHERE email IN (${placeholders})`;
      const employeeResult = await pool.query(employeeQuery, assignedTo);
      
      employeeIds = employeeResult.rows.map(row => row.id);

      if (employeeIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid employees found for assigned emails"
        });
      }
    }

    // 2️⃣ Insert task with status
    const query = `
      INSERT INTO Admintasks
      (Title, StartDate, DueDate, AssignedTo, EmployeeIDs, Priority, Attachment, Description, RecurringType, Status)
      VALUES ($1, $2, $3, $4::text[], $5::int[], $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const values = [
      title,
      startDate,
      endDate,
      Array.isArray(assignedTo) ? assignedTo : null,
      employeeIds.length ? employeeIds : null,
      priority || null,
      attachment || null,
      description || null,
      recurringType,
      status                   // ✅ inserted
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
    const result = await pool.query("SELECT * FROM Admintasks ORDER BY id DESC");
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
    const result = await pool.query("SELECT * FROM Admintasks WHERE id = $1", [id]);

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
      recurringType,
      status = "Pending"   // ✅ added status update
    } = req.body;

    // 1️⃣ Fetch employee IDs
    let employeeIds = [];
    if (assignedTo && assignedTo.length > 0) {
      const placeholders = assignedTo.map((_, i) => `$${i + 1}`).join(",");
      const employeeQuery = `SELECT id, email FROM Employees WHERE email IN (${placeholders})`;
      const employeeResult = await pool.query(employeeQuery, assignedTo);
      employeeIds = employeeResult.rows.map(row => row.id);

      if (employeeIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid employees found for assigned emails"
        });
      }
    }

    // 2️⃣ Update query including status
    const query = `
      UPDATE Admintasks
      SET 
        Title = $1,
        StartDate = $2,
        DueDate = $3,
        AssignedTo = $4::text[],
        EmployeeIDs = $5::int[],
        Priority = $6,
        Attachment = $7,
        Description = $8,
        RecurringType = $9,
        Status = $10
      WHERE id = $11
      RETURNING *;
    `;

    const values = [
      title,
      startDate,
      endDate,
      Array.isArray(assignedTo) ? assignedTo : null,
      employeeIds.length ? employeeIds : null,
      priority || null,
      attachment || null,
      description || null,
      recurringType || "Not Recurring",
      status,      // ✅ updated
      id
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    res.status(200).json({
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
      FROM Admintasks
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
      "DELETE FROM Admintasks WHERE id = $1 RETURNING *",
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

module.exports = router;
