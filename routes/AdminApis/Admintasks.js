const express = require("express");
const router = express.Router();
const pool = require("../../db"); // PostgreSQL connection pool

// -------------------- ADD TASK --------------------
router.post("/add", async (req, res) => {
  try {
    const {
      title,
      startDate,
      endDate,
      assignedTo,
      priority,
      collaborators,
      attachment,
      description,
      status = "Not Started",
      recurringType = "Not Recurring"
    } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Title, StartDate, and EndDate are required"
      });
    }

    const query = `
      INSERT INTO Admintasks
      (Title, StartDate, DueDate, AssignedTo, Priority, Collaborators, Attachment, Description, Status, RecurringType)
      VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const values = [
      title,
      startDate,
      endDate,
      Array.isArray(assignedTo) ? assignedTo : null,
      priority || null,
      Array.isArray(collaborators) ? collaborators : (collaborators ? [collaborators] : null),
      attachment || null,
      description || null,
      status,
      recurringType
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
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

// -------------------- GET SINGLE TASK --------------------
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
      collaborators,
      attachment,
      description,
      status,
      recurringType
    } = req.body;

    const query = `
      UPDATE Admintasks
      SET 
        Title = $1,
        StartDate = $2,
        DueDate = $3,
        AssignedTo = $4::text[],
        Priority = $5,
        Collaborators = $6,
        Attachment = $7,
        Description = $8,
        Status = $9,
        RecurringType = $10
      WHERE id = $11
      RETURNING *;
    `;

    const values = [
      title,
      startDate,
      endDate,
      Array.isArray(assignedTo) ? assignedTo : null,
      priority || null,
      collaborators || null,
      attachment || null,
      description || null,
      status || "Not Started",
      recurringType || "Not Recurring",
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

// -------------------- DELETE TASK --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM Admintasks WHERE TaskID = $1 RETURNING *", [id]);

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
