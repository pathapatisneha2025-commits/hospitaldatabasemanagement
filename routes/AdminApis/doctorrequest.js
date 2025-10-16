const express = require("express");
const db = require("../../db"); // PostgreSQL connection
const router = express.Router();

/* ===========================
   CREATE NEW DOCTOR REQUEST
=========================== */
router.post("/add", async (req, res) => {
  try {
    const { name, department, query_reason } = req.body;

    if (!name || !department || !query_reason) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const result = await db.query(
      `INSERT INTO doctor_requests (name, department, query_reason, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, department, query_reason, "pending"]
    );

    res
      .status(201)
      .json({ message: "Doctor request submitted", data: result.rows[0] });
  } catch (err) {
    console.error("Error creating request:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===========================
   GET ALL REQUESTS
=========================== */
router.get("/all", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM doctor_requests ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching requests:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===========================
   GET REQUEST BY ID
=========================== */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "SELECT * FROM doctor_requests WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching request by ID:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===========================
   UPDATE REQUEST DETAILS
=========================== */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, department, query_reason } = req.body;

    const existing = await db.query(
      "SELECT * FROM doctor_requests WHERE id = $1",
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    const updated = await db.query(
      `UPDATE doctor_requests
       SET name = $1, department = $2, query_reason = $3
       WHERE id = $4
       RETURNING *`,
      [name || existing.rows[0].name, department || existing.rows[0].department, query_reason || existing.rows[0].query_reason, id]
    );

    res.json({ message: "Request updated successfully", data: updated.rows[0] });
  } catch (err) {
    console.error("Error updating request:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===========================
   UPDATE STATUS (Admin Only)
=========================== */
router.put("/status", async (req, res) => {
  try {
    
    const {id, status } = req.body;

    if (!["pending", "complete", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const updated = await db.query(
      "UPDATE doctor_requests SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ message: "Status updated successfully", data: updated.rows[0] });
  } catch (err) {
    console.error("Error updating status:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===========================
   DELETE REQUEST
=========================== */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await db.query(
      "SELECT * FROM doctor_requests WHERE id = $1",
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    await db.query("DELETE FROM doctor_requests WHERE id = $1", [id]);
    res.json({ message: "Request deleted successfully" });
  } catch (err) {
    console.error("Error deleting request:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
