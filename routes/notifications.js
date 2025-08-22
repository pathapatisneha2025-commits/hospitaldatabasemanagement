// routes/notifications.js
const express = require("express");
const pool = require("../db"); // PostgreSQL pool connection
const router = express.Router();


// ✅ Get all notifications for an employee
router.get("/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE employee_id = $1
       ORDER BY created_at DESC`,
      [employeeId]
    );

    res.json({ notifications: result.rows });

  } catch (err) {
    console.error("Error fetching notifications:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});



// ✅ Delete a single notification
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ message: "Notification deleted successfully" });

  } catch (err) {
    console.error("Error deleting notification:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});
// ✅ Delete a single notification by employeeId + notificationId
router.delete("/:employeeId/notification/:id", async (req, res) => {
  try {
    const { employeeId, id } = req.params;

    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND employee_id = $2 RETURNING *`,
      [id, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found for this employee" });
    }

    res.json({ message: "Notification deleted successfully", notification: result.rows[0] });

  } catch (err) {
    console.error("Error deleting notification:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});




module.exports = router;
